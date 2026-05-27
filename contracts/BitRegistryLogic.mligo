(* BitRegistryLogic — business rules for creating Bits and casting BitVotes.

   Stateless apart from references to its surrounding contracts. All
   persistence happens through BitDataStore via its atomic
   admin_create_bit / admin_apply_vote entrypoints; this contract owns
   the validation and the fee-routing to Treasury.

   When a Bit is created with `syndicate = Some sid`, the contract
   verifies via SyndicateRegistry's is_member view that the caller is
   currently a member of that syndicate. Bits without a syndicate
   require only IdentityRegistry registration.

   Upgrade story: deploy a new BitRegistryLogic, then call
   BitDataStore.set_admin to transfer write authority. Existing bits
   and votes carry over since the data store is untouched.
*)

type bit = {
  creator       : address ;
  content_hash  : bytes ;
  parent        : bytes option ;
  syndicate     : bytes option ;
  creation_time : timestamp ;
  yay           : nat ;
  nay           : nat ;
}

type storage = {
  data_store         : address ;
  identity_registry  : address ;
  syndicate_registry : address ;
  variables          : address ;
  treasury           : address ;
}

(* ---- helpers ---- *)

let require_registered (caller : address) (id_reg : address) : unit =
  let r : bool = match (Tezos.call_view "is_registered" caller id_reg : bool option) with
    | Some b -> b
    | None -> failwith "IDENTITY_VIEW_FAILED" in
  if not r then failwith "NOT_REGISTERED"

let require_member (caller : address) (sid : bytes) (synd_reg : address) : unit =
  let r : bool = match (Tezos.call_view "is_member" (sid, caller) synd_reg : bool option) with
    | Some b -> b
    | None -> failwith "SYNDICATE_VIEW_FAILED" in
  if not r then failwith "NOT_A_MEMBER"

let get_variable_or_fail (variables : address) (key : string) : nat =
  match (Tezos.call_view "get" key variables : nat option option) with
  | Some (Some n) -> n
  | _ -> failwith "VARIABLE_MISSING"

let send_to_treasury (treasury : address) (amount : tez) : operation =
  let c : unit contract = match (Tezos.get_contract_opt treasury : unit contract option) with
    | Some c -> c
    | None -> failwith "TREASURY_NOT_FOUND" in
  Tezos.Next.Operation.transaction () amount c

let mutez_to_tez (n : nat) : tez = n * 1mutez

let compute_bid (creator : address) (content_hash : bytes) : bytes =
  Crypto.blake2b (Bytes.concat (Bytes.pack creator) content_hash)

let call_create_bit (data_store : address) (bid : bytes) (b : bit) : operation =
  let c : (bytes * bit) contract =
    match (Tezos.get_entrypoint_opt "%admin_create_bit" data_store : (bytes * bit) contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_CREATE_BIT_NOT_FOUND" in
  Tezos.Next.Operation.transaction (bid, b) 0mutez c

let call_apply_vote (data_store : address) (bid : bytes) (voter : address) (direction : bool) (votes_n : nat) (vote_time : timestamp) : operation =
  let c : (bytes * address * bool * nat * timestamp) contract =
    match (Tezos.get_entrypoint_opt "%admin_apply_vote" data_store : (bytes * address * bool * nat * timestamp) contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_APPLY_VOTE_NOT_FOUND" in
  Tezos.Next.Operation.transaction (bid, voter, direction, votes_n, vote_time) 0mutez c

(* ---- entrypoints ---- *)

[@entry]
let create_bit (params : bytes * bytes option * bytes option) (store : storage) : operation list * storage =
  let (content_hash, parent, syndicate) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let () = match syndicate with
    | None -> ()
    | Some sid -> require_member caller sid store.syndicate_registry in

  let cost : tez = mutez_to_tez (get_variable_or_fail store.variables "BitCost") in
  let () = if Tezos.get_amount () <> cost then failwith "WRONG_AMOUNT" in

  let bid = compute_bid caller content_hash in
  let b : bit = {
    creator       = caller ;
    content_hash  = content_hash ;
    parent        = parent ;
    syndicate     = syndicate ;
    creation_time = Tezos.get_now () ;
    yay           = 0n ;
    nay           = 0n ;
  } in

  let put_op = call_create_bit store.data_store bid b in
  let pay_op = send_to_treasury store.treasury cost in
  [put_op ; pay_op], store

[@entry]
let vote_bit (params : bytes * bool * nat) (store : storage) : operation list * storage =
  let (bid, direction, votes_n) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let () = if votes_n = 0n then failwith "ZERO_VOTES" in

  let unit_cost : nat = get_variable_or_fail store.variables "BitVoteCost" in
  let total_cost : tez = mutez_to_tez (unit_cost * votes_n * votes_n) in
  let () = if Tezos.get_amount () <> total_cost then failwith "WRONG_AMOUNT" in

  let vote_op = call_apply_vote store.data_store bid caller direction votes_n (Tezos.get_now ()) in
  let pay_op = send_to_treasury store.treasury total_cost in
  [vote_op ; pay_op], store
