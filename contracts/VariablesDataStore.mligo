(* VariablesDataStore — opaque key-value persistence for kernel parameters.

   Holds only the values bigmap and a single admin pointer. The admin is
   VariablesLogic; logic upgrades flip the admin via set_admin.
*)

type storage = {
  values : (string, nat) big_map ;
  admin  : address ;
}

let require_admin (admin : address) : unit =
  if Tezos.get_sender () <> admin then failwith "NOT_ADMIN"

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = require_admin store.admin in
  ([] : operation list), { store with admin = new_admin }

[@entry]
let admin_set (params : string * nat) (store : storage) : operation list * storage =
  let (key, value) = params in
  let () = require_admin store.admin in
  ([] : operation list),
  { store with values = Big_map.update key (Some value) store.values }

[@entry]
let admin_unset (key : string) (store : storage) : operation list * storage =
  let () = require_admin store.admin in
  ([] : operation list),
  { store with values = Big_map.update key (None : nat option) store.values }

[@view]
let get (key : string) (store : storage) : nat option =
  Big_map.find_opt key store.values

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin
