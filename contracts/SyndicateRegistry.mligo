(* SyndicateRegistry — group identities under which multiple registered
   users can co-publish bits.

   Membership model: closed. Any admin may add or remove members and
   promote or demote other admins. There is no self-apply flow in v1.

   Admin model: multi-admin. A syndicate is a set of admins (>= 1) and a
   set of members (admins are always members). The contract enforces that
   a syndicate cannot end up with zero admins — the last admin cannot be
   removed or demoted.

   The creator becomes the first admin and first member. Creating a
   syndicate costs `SyndicateCreationCost` mutez (kernel variable), paid
   to Treasury.

   BitRegistry calls `is_member` via Tezos.call_view when a bit is
   created with `syndicate = Some sid` to gate posting.
*)

type syndicate = {
  name          : string ;
  bio           : string ;
  admins        : address set ;
  members       : address set ;
  creation_time : timestamp ;
  creator       : address ;
}

type storage = {
  syndicates        : (bytes, syndicate) big_map ;
  variables         : address ;
  treasury          : address ;
  identity_registry : address ;
  total_syndicates  : nat ;
}

(* ---- helpers ---- *)

let require_registered (caller : address) (id_reg : address) : unit =
  let r : bool = match (Tezos.call_view "is_registered" caller id_reg : bool option) with
    | Some b -> b
    | None -> failwith "IDENTITY_VIEW_FAILED" in
  if not r then failwith "NOT_REGISTERED"

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

(* sid = blake2b(pack creator ++ pack name). Same creator cannot reuse a name,
   but different creators may share names — name is presentation, not identity. *)
let compute_sid (creator : address) (name : string) : bytes =
  Crypto.blake2b (Bytes.concat (Bytes.pack creator) (Bytes.pack name))

let load_or_fail (sid : bytes) (store : storage) : syndicate =
  match Big_map.find_opt sid store.syndicates with
  | Some s -> s
  | None -> failwith "SYNDICATE_NOT_FOUND"

let require_admin_of (s : syndicate) (caller : address) : unit =
  if not (Set.mem caller s.admins) then failwith "NOT_ADMIN"

(* ---- entrypoints ---- *)

[@entry]
let create_syndicate (params : string * string) (store : storage) : operation list * storage =
  let (name, bio) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let cost : tez = mutez_to_tez (get_variable_or_fail store.variables "SyndicateCreationCost") in
  let () = if Tezos.get_amount () <> cost then failwith "WRONG_AMOUNT" in
  let sid = compute_sid caller name in
  let () = if Big_map.mem sid store.syndicates then failwith "SYNDICATE_EXISTS" in
  let admins : address set = Set.add caller (Set.empty : address set) in
  let members : address set = Set.add caller (Set.empty : address set) in
  let s : syndicate = {
    name          = name ;
    bio           = bio ;
    admins        = admins ;
    members       = members ;
    creation_time = Tezos.get_now () ;
    creator       = caller ;
  } in
  let op = send_to_treasury store.treasury cost in
  [op],
  { store with
    syndicates       = Big_map.update sid (Some s) store.syndicates ;
    total_syndicates = store.total_syndicates + 1n }

[@entry]
let add_member (params : bytes * address) (store : storage) : operation list * storage =
  let (sid, who) = params in
  let caller = Tezos.get_sender () in
  let s = load_or_fail sid store in
  let () = require_admin_of s caller in
  let () = if Set.mem who s.members then failwith "ALREADY_MEMBER" in
  let () = require_registered who store.identity_registry in
  let s : syndicate = { s with members = Set.add who s.members } in
  ([] : operation list),
  { store with syndicates = Big_map.update sid (Some s) store.syndicates }

[@entry]
let remove_member (params : bytes * address) (store : storage) : operation list * storage =
  let (sid, who) = params in
  let caller = Tezos.get_sender () in
  let s = load_or_fail sid store in
  let () = require_admin_of s caller in
  let () = if not (Set.mem who s.members) then failwith "NOT_A_MEMBER" in
  let was_admin = Set.mem who s.admins in
  let () = if was_admin && Set.size s.admins = 1n then failwith "WOULD_LEAVE_NO_ADMIN" in
  let new_admins : address set = if was_admin then Set.remove who s.admins else s.admins in
  let s : syndicate = { s with
    members = Set.remove who s.members ;
    admins  = new_admins } in
  ([] : operation list),
  { store with syndicates = Big_map.update sid (Some s) store.syndicates }

[@entry]
let promote_admin (params : bytes * address) (store : storage) : operation list * storage =
  let (sid, who) = params in
  let caller = Tezos.get_sender () in
  let s = load_or_fail sid store in
  let () = require_admin_of s caller in
  let () = if not (Set.mem who s.members) then failwith "NOT_A_MEMBER" in
  let () = if Set.mem who s.admins then failwith "ALREADY_ADMIN" in
  let s : syndicate = { s with admins = Set.add who s.admins } in
  ([] : operation list),
  { store with syndicates = Big_map.update sid (Some s) store.syndicates }

[@entry]
let demote_admin (params : bytes * address) (store : storage) : operation list * storage =
  let (sid, who) = params in
  let caller = Tezos.get_sender () in
  let s = load_or_fail sid store in
  let () = require_admin_of s caller in
  let () = if not (Set.mem who s.admins) then failwith "NOT_AN_ADMIN" in
  let () = if Set.size s.admins = 1n then failwith "WOULD_LEAVE_NO_ADMIN" in
  let s : syndicate = { s with admins = Set.remove who s.admins } in
  ([] : operation list),
  { store with syndicates = Big_map.update sid (Some s) store.syndicates }

[@entry]
let update_metadata (params : bytes * string * string) (store : storage) : operation list * storage =
  let (sid, name, bio) = params in
  let caller = Tezos.get_sender () in
  let s = load_or_fail sid store in
  let () = require_admin_of s caller in
  let s : syndicate = { s with name = name ; bio = bio } in
  ([] : operation list),
  { store with syndicates = Big_map.update sid (Some s) store.syndicates }

(* ---- views ---- *)

[@view]
let is_member (params : bytes * address) (store : storage) : bool =
  let (sid, who) = params in
  match Big_map.find_opt sid store.syndicates with
  | Some s -> Set.mem who s.members
  | None -> false

[@view]
let is_admin (params : bytes * address) (store : storage) : bool =
  let (sid, who) = params in
  match Big_map.find_opt sid store.syndicates with
  | Some s -> Set.mem who s.admins
  | None -> false

[@view]
let count_syndicates (() : unit) (store : storage) : nat = store.total_syndicates
