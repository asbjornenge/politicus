(* PetitionLogic — community-controlled kernel mutation.

   Validates create / vote / resolve calls, computes quorum + majority
   thresholds, dispatches passing actions to the relevant downstream
   contract, and persists state through PetitionDataStore's atomic
   admin_* entrypoints.

   Action set extends the old PetitionRegistry with Migrate_logic, which
   passes the resolved governance vote to a target Logic contract's
   governance_migrate(new_logic) entrypoint. The target contract is
   responsible for forwarding the swap to its own data store.

   Upgrade story: deploy a new PetitionLogic, then governance migrates
   PetitionDataStore.admin to it. Petitions and votes carry over.
*)

type petition_action =
  | Set_variable of string * nat
  | Mod_content_add of bytes
  | Mod_content_del of bytes
  | Mod_user_add of address
  | Mod_user_del of address
  | Migrate_logic of address * address

type petition = {
  creator       : address ;
  action        : petition_action ;
  creation_time : timestamp ;
  closes_at     : timestamp ;
  yay           : nat ;
  nay           : nat ;
  unique_voters : nat ;
  resolved      : bool ;
  passed        : bool ;
}

type storage = {
  data_store          : address ;
  identity_registry   : address ;
  variables           : address ;
  treasury            : address ;
  moderation_registry : address ;
  governance          : address ;
}

(* ---- helpers ---- *)

let require_registered (caller : address) (identity_registry : address) : unit =
  let registered : bool = match (Tezos.call_view "is_registered" caller identity_registry : bool option) with
    | Some b -> b
    | None -> failwith "IDENTITY_VIEW_FAILED" in
  if not registered then failwith "NOT_REGISTERED"

let get_variable_or_fail (variables : address) (key : string) : nat =
  match (Tezos.call_view "get" key variables : nat option option) with
  | Some (Some n) -> n
  | _ -> failwith "VARIABLE_MISSING"

let get_total_users (identity_registry : address) : nat =
  match (Tezos.call_view "count_users" () identity_registry : nat option) with
  | Some n -> n
  | None -> failwith "USER_COUNT_VIEW_FAILED"

let send_to_treasury (treasury : address) (amount : tez) : operation =
  let c : unit contract = match (Tezos.get_contract_opt treasury : unit contract option) with
    | Some c -> c
    | None -> failwith "TREASURY_NOT_FOUND" in
  Tezos.Next.Operation.transaction () amount c

let mutez_to_tez (n : nat) : tez = n * 1mutez

let cost_var_for (action : petition_action) : string =
  match action with
  | Set_variable _ -> "PetitionUpdateVariableCost"
  | Mod_content_add _ -> "PetitionContentModerationAddCost"
  | Mod_content_del _ -> "PetitionContentModerationDelCost"
  | Mod_user_add _ -> "PetitionUserModerationAddCost"
  | Mod_user_del _ -> "PetitionUserModerationDelCost"
  | Migrate_logic _ -> "PetitionMigrateLogicCost"

let quorum_var_for (action : petition_action) : string =
  match action with
  | Set_variable _ -> "PetitionUpdateVariableQuorum"
  | Mod_content_add _ -> "PetitionContentModerationQuorum"
  | Mod_content_del _ -> "PetitionContentModerationQuorum"
  | Mod_user_add _ -> "PetitionUserModerationQuorum"
  | Mod_user_del _ -> "PetitionUserModerationQuorum"
  | Migrate_logic _ -> "PetitionMigrateLogicQuorum"

let majority_var_for (action : petition_action) : string =
  match action with
  | Set_variable _ -> "PetitionUpdateVariableMajority"
  | Mod_content_add _ -> "PetitionContentModerationMajority"
  | Mod_content_del _ -> "PetitionContentModerationMajority"
  | Mod_user_add _ -> "PetitionUserModerationMajority"
  | Mod_user_del _ -> "PetitionUserModerationMajority"
  | Migrate_logic _ -> "PetitionMigrateLogicMajority"

let call_admin_create (data_store : address) (p : petition) : operation =
  let c : petition contract =
    match (Tezos.get_entrypoint_opt "%admin_create_petition" data_store : petition contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_CREATE_NOT_FOUND" in
  Tezos.Next.Operation.transaction p 0mutez c

let call_admin_vote (data_store : address) (pid : bytes) (voter : address) (direction : bool) (votes : nat) (vote_time : timestamp) : operation =
  let c : (bytes * address * bool * nat * timestamp) contract =
    match (Tezos.get_entrypoint_opt "%admin_apply_vote" data_store : (bytes * address * bool * nat * timestamp) contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_VOTE_NOT_FOUND" in
  Tezos.Next.Operation.transaction (pid, voter, direction, votes, vote_time) 0mutez c

let call_admin_resolve (data_store : address) (pid : bytes) (passed : bool) : operation =
  let c : (bytes * bool) contract =
    match (Tezos.get_entrypoint_opt "%admin_resolve_petition" data_store : (bytes * bool) contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_RESOLVE_NOT_FOUND" in
  Tezos.Next.Operation.transaction (pid, passed) 0mutez c

let call_data_store_set_admin (data_store : address) (new_admin : address) : operation =
  let c : address contract =
    match (Tezos.get_entrypoint_opt "%set_admin" data_store : address contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_SET_ADMIN_NOT_FOUND" in
  Tezos.Next.Operation.transaction new_admin 0mutez c

(* ---- entrypoints ---- *)

[@entry]
let create_petition (action : petition_action) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in

  let cost : tez = mutez_to_tez (get_variable_or_fail store.variables (cost_var_for action)) in
  let () = if Tezos.get_amount () <> cost then failwith "WRONG_AMOUNT" in

  let duration_s : nat = get_variable_or_fail store.variables "PetitionDuration" in
  let now : timestamp = Tezos.get_now () in
  let closes_at : timestamp = now + int duration_s in

  let p : petition = {
    creator       = caller ;
    action        = action ;
    creation_time = now ;
    closes_at     = closes_at ;
    yay           = 0n ;
    nay           = 0n ;
    unique_voters = 0n ;
    resolved      = false ;
    passed        = false ;
  } in

  [call_admin_create store.data_store p ; send_to_treasury store.treasury cost], store

[@entry]
let vote_petition (params : bytes * bool * nat) (store : storage) : operation list * storage =
  let (pid, direction, votes) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let () = if votes = 0n then failwith "ZERO_VOTES" in

  let p : petition = match (Tezos.call_view "get_petition" pid store.data_store : petition option option) with
    | Some (Some p) -> p
    | _ -> failwith "PETITION_NOT_FOUND" in
  let () = if p.resolved then failwith "PETITION_RESOLVED" in
  let () = if Tezos.get_now () >= p.closes_at then failwith "PETITION_CLOSED" in

  let unit_cost : nat = get_variable_or_fail store.variables "PetitionVoteCost" in
  let total_cost : tez = mutez_to_tez (unit_cost * votes * votes) in
  let () = if Tezos.get_amount () <> total_cost then failwith "WRONG_AMOUNT" in

  [call_admin_vote store.data_store pid caller direction votes (Tezos.get_now ()) ;
   send_to_treasury store.treasury total_cost],
  store

[@entry]
let resolve_petition (pid : bytes) (store : storage) : operation list * storage =
  let p : petition = match (Tezos.call_view "get_petition" pid store.data_store : petition option option) with
    | Some (Some p) -> p
    | _ -> failwith "PETITION_NOT_FOUND" in
  let () = if p.resolved then failwith "ALREADY_RESOLVED" in
  let () = if Tezos.get_now () < p.closes_at then failwith "PETITION_OPEN" in

  let total_users : nat = get_total_users store.identity_registry in
  let quorum_bps : nat = get_variable_or_fail store.variables (quorum_var_for p.action) in
  let majority_bps : nat = get_variable_or_fail store.variables (majority_var_for p.action) in

  let total_votes = p.yay + p.nay in
  let quorum_met = p.unique_voters * 10000n >= total_users * quorum_bps in
  let majority_met = total_votes > 0n && p.yay * 10000n >= total_votes * majority_bps in
  let passed = quorum_met && majority_met in

  let action_ops : operation list = if passed then
    (match p.action with
     | Set_variable (k, v) ->
       let c : (string * nat) contract = match (Tezos.get_entrypoint_opt "%set" store.variables : (string * nat) contract option) with
         | Some c -> c | None -> failwith "VARIABLES_SET_NOT_FOUND" in
       [Tezos.Next.Operation.transaction (k, v) 0tez c]
     | Mod_content_add h ->
       let c : bytes contract = match (Tezos.get_entrypoint_opt "%add_content_mod" store.moderation_registry : bytes contract option) with
         | Some c -> c | None -> failwith "MOD_EP_NOT_FOUND" in
       [Tezos.Next.Operation.transaction h 0tez c]
     | Mod_content_del h ->
       let c : bytes contract = match (Tezos.get_entrypoint_opt "%del_content_mod" store.moderation_registry : bytes contract option) with
         | Some c -> c | None -> failwith "MOD_EP_NOT_FOUND" in
       [Tezos.Next.Operation.transaction h 0tez c]
     | Mod_user_add u ->
       let c : address contract = match (Tezos.get_entrypoint_opt "%add_user_mod" store.moderation_registry : address contract option) with
         | Some c -> c | None -> failwith "MOD_EP_NOT_FOUND" in
       [Tezos.Next.Operation.transaction u 0tez c]
     | Mod_user_del u ->
       let c : address contract = match (Tezos.get_entrypoint_opt "%del_user_mod" store.moderation_registry : address contract option) with
         | Some c -> c | None -> failwith "MOD_EP_NOT_FOUND" in
       [Tezos.Next.Operation.transaction u 0tez c]
     | Migrate_logic (target, new_logic) ->
       let c : address contract = match (Tezos.get_entrypoint_opt "%governance_migrate" target : address contract option) with
         | Some c -> c | None -> failwith "MIGRATE_EP_NOT_FOUND" in
       [Tezos.Next.Operation.transaction new_logic 0tez c])
  else
    ([] : operation list) in

  (call_admin_resolve store.data_store pid passed) :: action_ops, store

(* ---- governance ---- *)

[@entry]
let set_governance (new_gov : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.governance then failwith "NOT_GOVERNANCE" in
  ([] : operation list), { store with governance = new_gov }

[@entry]
let governance_migrate (new_logic : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.governance then failwith "NOT_GOVERNANCE" in
  [call_data_store_set_admin store.data_store new_logic], store

(* ---- views ---- *)

[@view]
let get_petition (pid : bytes) (store : storage) : petition option =
  match (Tezos.call_view "get_petition" pid store.data_store : petition option option) with
  | Some p -> p
  | None -> None

[@view]
let get_governance (() : unit) (store : storage) : address = store.governance
