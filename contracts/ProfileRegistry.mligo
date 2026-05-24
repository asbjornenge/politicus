(* ProfileRegistry — generic map from opaque keys to profile content hashes.

   Keys are bytes:
   - For user profiles: key = Bytes.pack(address). Caller proves ownership
     by being that address (Tezos.get_sender ()).
   - For syndicate profiles: key = sid. Caller proves ownership by being
     an admin of the syndicate (verified via SyndicateRegistry.is_admin view).

   The value is opaque bytes — by convention a UTF-8 IPFS CID for a JSON
   document. The contract doesn't validate the JSON; that's the trust-
   boundary job of the off-chain API and clients.

   Two entrypoints keep the per-key-type ownership rules explicit. The
   underlying bigmap is shared — collisions are impossible because
   Bytes.pack(address) produces a distinct prefix from a blake2b sid.
*)

type storage = {
  profiles           : (bytes, bytes) big_map ;
  identity_registry  : address ;
  syndicate_registry : address ;
}

(* ---- entrypoints ---- *)

[@entry]
let update_user_profile (profile_hash : bytes) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let key = Bytes.pack caller in
  ([] : operation list),
  { store with profiles = Big_map.update key (Some profile_hash) store.profiles }

[@entry]
let clear_user_profile (() : unit) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let key = Bytes.pack caller in
  ([] : operation list),
  { store with profiles = Big_map.update key (None : bytes option) store.profiles }

[@entry]
let update_syndicate_profile (params : bytes * bytes) (store : storage) : operation list * storage =
  let (sid, profile_hash) = params in
  let caller = Tezos.get_sender () in
  let is_admin : bool = match (Tezos.call_view "is_admin" (sid, caller) store.syndicate_registry : bool option) with
    | Some b -> b
    | None -> failwith "SYNDICATE_VIEW_FAILED" in
  let () = if not is_admin then failwith "NOT_ADMIN" in
  ([] : operation list),
  { store with profiles = Big_map.update sid (Some profile_hash) store.profiles }

[@entry]
let clear_syndicate_profile (sid : bytes) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let is_admin : bool = match (Tezos.call_view "is_admin" (sid, caller) store.syndicate_registry : bool option) with
    | Some b -> b
    | None -> failwith "SYNDICATE_VIEW_FAILED" in
  let () = if not is_admin then failwith "NOT_ADMIN" in
  ([] : operation list),
  { store with profiles = Big_map.update sid (None : bytes option) store.profiles }

(* ---- views ---- *)

[@view]
let get_user_profile (addr : address) (store : storage) : bytes option =
  Big_map.find_opt (Bytes.pack addr) store.profiles

[@view]
let get_syndicate_profile (sid : bytes) (store : storage) : bytes option =
  Big_map.find_opt sid store.profiles

[@view]
let get_raw (key : bytes) (store : storage) : bytes option =
  Big_map.find_opt key store.profiles
