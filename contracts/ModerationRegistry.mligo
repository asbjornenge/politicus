(* ModerationRegistry — tracks which content hashes and users are moderated.

   Only the admin can mutate. After bootstrap, admin = PetitionRegistry,
   meaning only successful moderation petitions can add or remove entries.

   Indexers and clients query the is_content_moderated and is_user_moderated
   views to decide what to serve / accept. The on-chain Bit and signature
   records are never deleted — moderation is enforced at the
   indexer/gateway layer, not by destroying chain history.

   Each entry stores a timestamp (when it was added). This lets clients show
   "moderated since X" if useful, and is cheaper than storing nothing.
*)

type storage = {
  moderated_content : (bytes, timestamp) big_map ;
  moderated_users   : (address, timestamp) big_map ;
  admin             : address ;
}

let require_admin (store : storage) : unit =
  if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN"

[@entry]
let add_content_mod (content_hash : bytes) (store : storage) : operation list * storage =
  let () = require_admin store in
  ([] : operation list),
  { store with moderated_content = Big_map.update content_hash (Some (Tezos.get_now ())) store.moderated_content }

[@entry]
let del_content_mod (content_hash : bytes) (store : storage) : operation list * storage =
  let () = require_admin store in
  ([] : operation list),
  { store with moderated_content = Big_map.update content_hash (None : timestamp option) store.moderated_content }

[@entry]
let add_user_mod (user : address) (store : storage) : operation list * storage =
  let () = require_admin store in
  ([] : operation list),
  { store with moderated_users = Big_map.update user (Some (Tezos.get_now ())) store.moderated_users }

[@entry]
let del_user_mod (user : address) (store : storage) : operation list * storage =
  let () = require_admin store in
  ([] : operation list),
  { store with moderated_users = Big_map.update user (None : timestamp option) store.moderated_users }

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = require_admin store in
  ([] : operation list),
  { store with admin = new_admin }

[@view]
let is_content_moderated (content_hash : bytes) (store : storage) : bool =
  Big_map.mem content_hash store.moderated_content

[@view]
let is_user_moderated (user : address) (store : storage) : bool =
  Big_map.mem user store.moderated_users

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin
