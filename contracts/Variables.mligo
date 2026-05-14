(* Variables — kernel parameter registry for Politicus.

   Stores all governance-tunable numeric parameters as nat.
   - tez amounts are stored in mutez (1 tez = 1_000_000 mutez)
   - percentages are stored in basis points (1% = 100, 100% = 10_000)
   - durations are stored in seconds

   Addresses (e.g. TreasuryAddress) are not stored here — they live in the
   contracts that own them, so updates are atomic with the relevant logic.

   admin is the only principal allowed to modify variables. Initially this is
   the deployer; later it will be migrated to the PetitionRegistry contract via
   set_admin, at which point only resolved petitions can change kernel state.
*)

type storage = {
  values : (string, nat) big_map ;
  admin  : address ;
}

[@entry]
let set (params : string * nat) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  let (key, value) = params in
  ([] : operation list),
  { store with values = Big_map.update key (Some value) store.values }

[@entry]
let unset (key : string) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  ([] : operation list),
  { store with values = Big_map.update key (None : nat option) store.values }

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  ([] : operation list),
  { store with admin = new_admin }

[@view]
let get (key : string) (store : storage) : nat option =
  Big_map.find_opt key store.values
