(* Treasury — receives action fees and BitNFT cuts, releases to admin.

   The Treasury address is stable across admin changes — this is the whole
   point of making it a contract rather than just an account: when control
   migrates to a DAO, all the senders keep pointing at the same address.

   admin is initially the deployer. It is expected to be migrated to a
   community-controlled contract (DAO, multisig, or PetitionRegistry) via
   set_admin once the governance layer is in place.

   On-chain history (via TzKT etc.) is the source of truth for per-source
   accounting; we keep storage minimal.
*)

type storage = {
  admin : address ;
}

[@entry]
let default (() : unit) (store : storage) : operation list * storage =
  ([] : operation list), store

[@entry]
let withdraw (params : tez * address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  let (amount, recipient) = params in
  let recipient_contract : unit contract =
    match (Tezos.get_contract_opt recipient : unit contract option) with
    | Some c -> c
    | None -> failwith "INVALID_RECIPIENT" in
  let op = Tezos.Next.Operation.transaction () amount recipient_contract in
  [op], store

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" in
  ([] : operation list), { store with admin = new_admin }

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin
