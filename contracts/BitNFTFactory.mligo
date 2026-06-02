(* BitNFTFactory — registry that maps creators (users or syndicates) to
   their per-creator BitNFTCollection contract addresses.

   The factory itself does not deploy collections — that is done client-side
   so the creator pays the origination cost directly. After a collection is
   originated the creator calls register_collection here, and the factory
   verifies they are the legitimate owner of the claimed owner_kind by
   reading get_owner_kind on the collection and matching it against the
   caller's identity (User caller, or admin of the syndicate).

   Once registered, anyone can look up a creator's collection address
   through the views. The mapping is permanent — a creator cannot
   re-register a different collection. This stops people from rug-pulling
   their followers by switching collection mid-stream. To replace the
   collection, governance would migrate it (future work).
*)

type owner_kind =
  | User of address
  | Syndicate of address * bytes  (* (syndicate_registry, sid) *)

type owner_key = bytes

type storage = {
  collections        : (owner_key, address) big_map ;
  syndicate_registry : address ;
  total_collections  : nat ;
}

let owner_key_of (k : owner_kind) : owner_key =
  match k with
  | User addr -> Crypto.blake2b (Bytes.concat (Bytes.pack "u") (Bytes.pack addr))
  | Syndicate (_, sid) -> Crypto.blake2b (Bytes.concat (Bytes.pack "s") sid)

let require_owner_of (k : owner_kind) (caller : address) : unit =
  match k with
  | User addr ->
    if caller <> addr then failwith "NOT_OWNER"
  | Syndicate (synd_reg, sid) ->
    let is_admin : bool = match (Tezos.call_view "is_admin" (sid, caller) synd_reg : bool option) with
      | Some b -> b
      | None -> failwith "SYNDICATE_VIEW_FAILED" in
    if not is_admin then failwith "NOT_SYNDICATE_ADMIN"

[@entry]
let register_collection (params : address * owner_kind) (store : storage) : operation list * storage =
  let (collection_addr, claimed_kind) = params in
  let caller = Tezos.get_sender () in
  let () = require_owner_of claimed_kind caller in

  (* Verify the collection's own get_owner_kind view matches the claimed kind. *)
  let collection_kind : owner_kind = match (Tezos.call_view "get_owner_kind" () collection_addr : owner_kind option) with
    | Some k -> k
    | None -> failwith "COLLECTION_VIEW_FAILED" in
  let () = if claimed_kind <> collection_kind then failwith "OWNER_MISMATCH" in

  let key = owner_key_of claimed_kind in
  let () = if Big_map.mem key store.collections then failwith "ALREADY_REGISTERED" in

  ([] : operation list),
  { store with
    collections       = Big_map.update key (Some collection_addr) store.collections ;
    total_collections = store.total_collections + 1n }

[@view]
let get_user_collection (addr : address) (store : storage) : address option =
  let key = Crypto.blake2b (Bytes.concat (Bytes.pack "u") (Bytes.pack addr)) in
  Big_map.find_opt key store.collections

[@view]
let get_syndicate_collection (sid : bytes) (store : storage) : address option =
  let key = Crypto.blake2b (Bytes.concat (Bytes.pack "s") sid) in
  Big_map.find_opt key store.collections

[@view]
let count_collections (() : unit) (store : storage) : nat = store.total_collections
