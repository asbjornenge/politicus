(* PaymentReceiver — Michelson side of PoC #2.
   Accepts USDC-payment notifications from the Solidity forwarder via the
   NAC gateway. Stores each payment so the test script can inspect the
   end state, and emits an event-style log entry as a view too.

   Storage:
   - expected_forwarder : the KT1 alias of the EVM forwarder. Sender of
     record_payment must match — otherwise rejected. This is the trust
     anchor: only "our" forwarder can credit a payment.
   - payments           : payments by sequential id
   - by_payer           : index of payments by EVM bytes20 payer address
   - next_id            : counter
*)

type payment = {
  payer_evm : bytes ;     (* 20 bytes — the user's EVM address *)
  amount    : nat ;       (* USDC mutez (6 decimals) *)
  content   : bytes ;     (* opaque payload — e.g. CID, hash, etc. *)
  level     : nat ;       (* block level when recorded *)
}

type storage = {
  expected_forwarder : address ;
  payments           : (nat, payment) big_map ;
  by_payer           : (bytes, nat list) big_map ;
  next_id            : nat ;
  admin              : address ;
}

[@entry]
let record_payment (params : bytes * (nat * bytes)) (store : storage) : operation list * storage =
  let (payer_evm, (amount, content)) = params in
  let () = if Tezos.get_sender () <> store.expected_forwarder then
    failwith "UNAUTHORIZED_FORWARDER" else () in
  let () = if amount = 0n then failwith "ZERO_AMOUNT" else () in
  let p : payment = {
    payer_evm = payer_evm ;
    amount    = amount ;
    content   = content ;
    level     = Tezos.get_level () ;
  } in
  let id : nat = store.next_id in
  let prior : nat list = match Big_map.find_opt payer_evm store.by_payer with
    | Some xs -> xs
    | None -> ([] : nat list) in
  ([] : operation list),
  { store with
    payments  = Big_map.update id (Some p) store.payments ;
    by_payer  = Big_map.update payer_evm (Some (id :: prior)) store.by_payer ;
    next_id   = id + 1n ;
  }

[@entry]
let set_forwarder (new_forwarder : address) (store : storage) : operation list * storage =
  let () = if Tezos.get_sender () <> store.admin then failwith "NOT_ADMIN" else () in
  ([] : operation list), { store with expected_forwarder = new_forwarder }

[@view]
let get_count (() : unit) (store : storage) : nat = store.next_id

[@view]
let get_payment (id : nat) (store : storage) : payment option =
  Big_map.find_opt id store.payments

[@view]
let get_expected_forwarder (() : unit) (store : storage) : address = store.expected_forwarder
