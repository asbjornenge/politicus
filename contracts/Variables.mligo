(* Variables — kernel parameter registry with bootstrap-admin sunset clause.

   Two principals can write to the values map:

   - admin: the "permanent" administrator. After the initial setup, this is
     the PetitionRegistry contract, meaning successful petitions are the only
     way to mutate the kernel post-bootstrap.

   - bootstrap_admin: the platform creator during the bootstrap phase. Has
     write access as long as total_users (read live from IdentityRegistry) is
     strictly less than the BootstrapUserThreshold variable.

   Bootstrap admin can ratchet BootstrapUserThreshold *down* (e.g., lower it
   if growth is faster than expected), but never *up* — they cannot extend
   their own mandate. The bootstrap admin can also voluntarily retire via
   retire_bootstrap_admin.

   Once total_users hits the threshold, bootstrap_admin's writes silently
   stop working (the precondition fails). No explicit sunset action is
   required — the contract enforces it automatically.
*)

type storage = {
  values             : (string, nat) big_map ;
  admin              : address ;
  bootstrap_admin    : address option ;
  identity_registry  : address ;
}

let total_users (id_reg : address) : nat =
  match (Tezos.call_view "count_users" () id_reg : nat option) with
  | Some n -> n
  | None -> failwith "USER_COUNT_VIEW_FAILED"

let get_threshold (store : storage) : nat =
  match Big_map.find_opt "BootstrapUserThreshold" store.values with
  | Some n -> n
  | None -> 0n

let bootstrap_active (store : storage) : bool =
  total_users store.identity_registry < get_threshold store

let check_caller (store : storage) (key : string) (is_unset : bool) : unit =
  let caller = Tezos.get_sender () in
  let is_main = caller = store.admin in
  let is_boot = match store.bootstrap_admin with
    | Some ba -> caller = ba && bootstrap_active store
    | None -> false in
  let () = if not is_main && not is_boot then failwith "NOT_AUTHORIZED" in
  (* Bootstrap admin can only ratchet BootstrapUserThreshold downward, never up,
     and never unset it. Main admin (post-bootstrap petitions) has no such limit. *)
  if is_boot && not is_main && key = "BootstrapUserThreshold" then
    (if is_unset then failwith "THRESHOLD_LOCKED" else ())
  else ()

[@entry]
let set (params : string * nat) (store : storage) : operation list * storage =
  let (key, value) = params in
  let () = check_caller store key false in
  let () = if key = "BootstrapUserThreshold" then
    let is_main = Tezos.get_sender () = store.admin in
    if not is_main && value >= get_threshold store then failwith "THRESHOLD_ONLY_DOWN" else ()
  else () in
  ([] : operation list),
  { store with values = Big_map.update key (Some value) store.values }

[@entry]
let unset (key : string) (store : storage) : operation list * storage =
  let () = check_caller store key true in
  ([] : operation list),
  { store with values = Big_map.update key (None : nat option) store.values }

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  ([] : operation list),
  { store with admin = new_admin }

[@entry]
let retire_bootstrap_admin (() : unit) (store : storage) : operation list * storage =
  let () = match store.bootstrap_admin with
    | Some ba -> if Tezos.get_sender () <> ba then failwith "NOT_BOOTSTRAP_ADMIN"
    | None -> failwith "NO_BOOTSTRAP_ADMIN" in
  ([] : operation list),
  { store with bootstrap_admin = (None : address option) }

[@view]
let get (key : string) (store : storage) : nat option =
  Big_map.find_opt key store.values

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin

[@view]
let get_bootstrap_admin (() : unit) (store : storage) : address option =
  store.bootstrap_admin

[@view]
let is_bootstrap_active (() : unit) (store : storage) : bool =
  bootstrap_active store
