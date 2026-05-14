(* PetitionRegistry — community-controlled kernel mutation.

   For Phase B MVP, only the Set_variable action is implemented. Other action
   types (moderation, removal, kernel replacement) will be added as the
   respective registries come online.

   Resolution is pull-based: anyone can call resolve_petition once the voting
   window has closed. The contract checks quorum + majority and either applies
   the action (via an inter-contract call) or marks the petition as failed.

   Quorum semantics: unique_voters / total_users >= quorum_bps / 10000, where
   total_users is read from IdentityRegistry's count_users view.

   This contract is expected to hold the admin role on Variables after the
   bootstrap transfer. From that point, only successful petitions can change
   kernel parameters.
*)

type petition_action =
  | Set_variable of string * nat
  | Mod_content_add of bytes
  | Mod_content_del of bytes
  | Mod_user_add of address
  | Mod_user_del of address

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

type petition_vote = {
  voter     : address ;
  direction : bool ;
  votes     : nat ;
  vote_time : timestamp ;
}

type storage = {
  petitions           : (bytes, petition) big_map ;
  votes               : (bytes, petition_vote) big_map ;
  next_petition_seq   : nat ;
  identity_registry   : address ;
  variables           : address ;
  treasury            : address ;
  moderation_registry : address ;
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

let quorum_var_for (action : petition_action) : string =
  match action with
  | Set_variable _ -> "PetitionUpdateVariableQuorum"
  | Mod_content_add _ -> "PetitionContentModerationQuorum"
  | Mod_content_del _ -> "PetitionContentModerationQuorum"
  | Mod_user_add _ -> "PetitionUserModerationQuorum"
  | Mod_user_del _ -> "PetitionUserModerationQuorum"

let majority_var_for (action : petition_action) : string =
  match action with
  | Set_variable _ -> "PetitionUpdateVariableMajority"
  | Mod_content_add _ -> "PetitionContentModerationMajority"
  | Mod_content_del _ -> "PetitionContentModerationMajority"
  | Mod_user_add _ -> "PetitionUserModerationMajority"
  | Mod_user_del _ -> "PetitionUserModerationMajority"

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

  let pid = Crypto.blake2b (Bytes.pack store.next_petition_seq) in

  let p : petition = {
    creator = caller ;
    action = action ;
    creation_time = now ;
    closes_at = closes_at ;
    yay = 0n ;
    nay = 0n ;
    unique_voters = 0n ;
    resolved = false ;
    passed = false ;
  } in

  let op = send_to_treasury store.treasury cost in
  [op],
  { store with
    petitions = Big_map.update pid (Some p) store.petitions ;
    next_petition_seq = store.next_petition_seq + 1n }

[@entry]
let vote_petition (params : bytes * bool * nat) (store : storage) : operation list * storage =
  let (pid, direction, votes) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let () = if votes = 0n then failwith "ZERO_VOTES" in

  let p : petition = match Big_map.find_opt pid store.petitions with
    | Some p -> p
    | None -> failwith "PETITION_NOT_FOUND" in
  let () = if p.resolved then failwith "PETITION_RESOLVED" in
  let () = if Tezos.get_now () >= p.closes_at then failwith "PETITION_CLOSED" in

  let unit_cost : nat = get_variable_or_fail store.variables "PetitionVoteCost" in
  let total_cost : tez = mutez_to_tez (unit_cost * votes * votes) in
  let () = if Tezos.get_amount () <> total_cost then failwith "WRONG_AMOUNT" in

  let pvid = Crypto.blake2b (Bytes.concat pid (Bytes.pack caller)) in

  let is_new_voter = match Big_map.find_opt pvid store.votes with
    | None -> true
    | Some _ -> false in

  (* Subtract previous vote contribution if any *)
  let p = match Big_map.find_opt pvid store.votes with
    | None -> p
    | Some prev ->
      let new_yay = if prev.direction
        then (match is_nat (p.yay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_YAY")
        else p.yay in
      let new_nay = if prev.direction
        then p.nay
        else (match is_nat (p.nay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_NAY") in
      { p with yay = new_yay ; nay = new_nay } in

  let p = if direction
    then { p with yay = p.yay + votes }
    else { p with nay = p.nay + votes } in

  let p = if is_new_voter
    then { p with unique_voters = p.unique_voters + 1n }
    else p in

  let v : petition_vote = {
    voter = caller ;
    direction = direction ;
    votes = votes ;
    vote_time = Tezos.get_now () ;
  } in

  let op = send_to_treasury store.treasury total_cost in
  [op],
  { store with
    petitions = Big_map.update pid (Some p) store.petitions ;
    votes = Big_map.update pvid (Some v) store.votes }

[@entry]
let resolve_petition (pid : bytes) (store : storage) : operation list * storage =
  let p : petition = match Big_map.find_opt pid store.petitions with
    | Some p -> p
    | None -> failwith "PETITION_NOT_FOUND" in
  let () = if p.resolved then failwith "ALREADY_RESOLVED" in
  let () = if Tezos.get_now () < p.closes_at then failwith "PETITION_OPEN" in

  let total_users : nat = get_total_users store.identity_registry in
  let quorum_bps : nat = get_variable_or_fail store.variables (quorum_var_for p.action) in
  let majority_bps : nat = get_variable_or_fail store.variables (majority_var_for p.action) in

  let total_votes = p.yay + p.nay in
  let quorum_met = p.unique_voters * 10000n >= total_users * quorum_bps in
  let majority_met = total_votes > 0n && p.yay * 10000n >= total_votes * majority_bps in
  let passed = quorum_met && majority_met in

  let ops : operation list = if passed then
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
       [Tezos.Next.Operation.transaction u 0tez c])
  else
    ([] : operation list) in

  let updated = { p with resolved = true ; passed = passed } in
  ops,
  { store with petitions = Big_map.update pid (Some updated) store.petitions }

(* ---- views ---- *)

[@view]
let get_petition (pid : bytes) (store : storage) : petition option =
  Big_map.find_opt pid store.petitions

[@view]
let get_petition_vote (pvid : bytes) (store : storage) : petition_vote option =
  Big_map.find_opt pvid store.votes

[@view]
let compute_pvid (params : bytes * address) (store : storage) : bytes =
  let _ = store in
  let (pid, voter) = params in
  Crypto.blake2b (Bytes.concat pid (Bytes.pack voter))
