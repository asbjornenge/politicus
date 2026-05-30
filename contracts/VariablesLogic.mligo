(* VariablesLogic — access control for kernel-parameter writes.

   Three principals:

   - `admin`: the post-bootstrap writer (initially the PetitionLogic
     contract). After bootstrap retires, only successful petitions can
     mutate kernel values.
   - `bootstrap_admin`: the platform creator during bootstrap. Has write
     access as long as total_users (read from IdentityRegistry) is
     strictly less than BootstrapUserThreshold. Also has set_admin
     privilege during the same window — this is what lets the bootstrap
     hand the kernel over to PetitionLogic for the first time.
   - `governance`: who may swap this Logic contract out via
     governance_migrate. Initially bootstrap_admin's tz1; flipped to
     PetitionLogic when the kernel transitions to community control.

   Reads (get) proxy the underlying data-store view, so the rest of the
   kernel can keep calling `Tezos.call_view "get" key variables_logic`.
*)

type storage = {
  data_store        : address ;
  admin             : address ;
  bootstrap_admin   : address option ;
  identity_registry : address ;
  governance        : address ;
}

(* ---- helpers ---- *)

let total_users (id_reg : address) : nat =
  match (Tezos.call_view "count_users" () id_reg : nat option) with
  | Some n -> n
  | None -> failwith "USER_COUNT_VIEW_FAILED"

let get_from_store (data_store : address) (key : string) : nat option =
  match (Tezos.call_view "get" key data_store : nat option option) with
  | Some inner -> inner
  | None -> failwith "DATASTORE_GET_NOT_FOUND"

let bootstrap_threshold (store : storage) : nat =
  match get_from_store store.data_store "BootstrapUserThreshold" with
  | Some n -> n
  | None -> 0n

let bootstrap_active (store : storage) : bool =
  total_users store.identity_registry < bootstrap_threshold store

let is_bootstrap_caller (store : storage) : bool =
  match store.bootstrap_admin with
  | Some ba -> Tezos.get_sender () = ba && bootstrap_active store
  | None -> false

let require_writer (store : storage) (key : string) (is_unset : bool) : unit =
  let caller = Tezos.get_sender () in
  let is_main = caller = store.admin in
  let is_boot = is_bootstrap_caller store in
  let () = if not is_main && not is_boot then failwith "NOT_AUTHORIZED" in
  if is_boot && not is_main && key = "BootstrapUserThreshold" then
    (if is_unset then failwith "THRESHOLD_LOCKED" else ())
  else ()

let call_admin_set (data_store : address) (key : string) (value : nat) : operation =
  let c : (string * nat) contract =
    match (Tezos.get_entrypoint_opt "%admin_set" data_store : (string * nat) contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_SET_NOT_FOUND" in
  Tezos.Next.Operation.transaction (key, value) 0mutez c

let call_admin_unset (data_store : address) (key : string) : operation =
  let c : string contract =
    match (Tezos.get_entrypoint_opt "%admin_unset" data_store : string contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_UNSET_NOT_FOUND" in
  Tezos.Next.Operation.transaction key 0mutez c

let call_data_store_set_admin (data_store : address) (new_admin : address) : operation =
  let c : address contract =
    match (Tezos.get_entrypoint_opt "%set_admin" data_store : address contract option) with
    | Some c -> c
    | None -> failwith "DATASTORE_SET_ADMIN_NOT_FOUND" in
  Tezos.Next.Operation.transaction new_admin 0mutez c

(* ---- entrypoints ---- *)

[@entry]
let set (params : string * nat) (store : storage) : operation list * storage =
  let (key, value) = params in
  let () = require_writer store key false in
  let () = if key = "BootstrapUserThreshold" then
    let is_main = Tezos.get_sender () = store.admin in
    (match get_from_store store.data_store "BootstrapUserThreshold" with
     | Some cur -> if not is_main && value >= cur then failwith "THRESHOLD_ONLY_DOWN"
     | None -> ())
  else () in
  [call_admin_set store.data_store key value], store

[@entry]
let unset (key : string) (store : storage) : operation list * storage =
  let () = require_writer store key true in
  [call_admin_unset store.data_store key], store

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let is_main = caller = store.admin in
  let is_boot = is_bootstrap_caller store in
  let () = if not is_main && not is_boot then failwith "NOT_AUTHORIZED" in
  ([] : operation list), { store with admin = new_admin }

[@entry]
let retire_bootstrap_admin (() : unit) (store : storage) : operation list * storage =
  let () = match store.bootstrap_admin with
    | Some ba -> if Tezos.get_sender () <> ba then failwith "NOT_BOOTSTRAP_ADMIN"
    | None -> failwith "NO_BOOTSTRAP_ADMIN" in
  ([] : operation list),
  { store with bootstrap_admin = (None : address option) }

[@entry]
let set_governance (new_gov : address) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let is_gov = caller = store.governance in
  let is_boot = is_bootstrap_caller store in
  let () = if not is_gov && not is_boot then failwith "NOT_AUTHORIZED" in
  ([] : operation list), { store with governance = new_gov }

[@entry]
let governance_migrate (new_logic : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.governance then failwith "NOT_GOVERNANCE" in
  [call_data_store_set_admin store.data_store new_logic], store

(* ---- views ---- *)

[@view]
let get (key : string) (store : storage) : nat option = get_from_store store.data_store key

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin

[@view]
let get_bootstrap_admin (() : unit) (store : storage) : address option =
  store.bootstrap_admin

[@view]
let is_bootstrap_active (() : unit) (store : storage) : bool =
  bootstrap_active store

[@view]
let get_governance (() : unit) (store : storage) : address = store.governance
