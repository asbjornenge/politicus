(* Minimal Michelson counter — PoC receiver for cross-runtime calls
   from the Solidity forwarder. The forwarder invokes increment via the
   Tezos X NAC gateway precompile (0xff…07).

   Verifies:
   - cross-runtime call lands and mutates state atomically
   - Tezos.get_sender() returns the forwarder's KT1 alias (we expose
     last_sender via a view so the test script can read it out) *)

type storage = {
  counter     : int ;
  last_sender : address option ;
}

[@entry]
let increment (() : unit) (store : storage) : operation list * storage =
  ([] : operation list),
  { counter = store.counter + 1 ; last_sender = Some (Tezos.get_sender ()) }

[@entry]
let decrement (() : unit) (store : storage) : operation list * storage =
  let () = if store.counter <= 0 then failwith "AT_ZERO" else () in
  ([] : operation list),
  { counter = store.counter - 1 ; last_sender = Some (Tezos.get_sender ()) }

[@entry]
let reset (() : unit) (store : storage) : operation list * storage =
  ([] : operation list),
  { counter = 0 ; last_sender = Some (Tezos.get_sender ()) }

[@view]
let get_counter (() : unit) (store : storage) : int = store.counter

[@view]
let get_last_sender (() : unit) (store : storage) : address option = store.last_sender
