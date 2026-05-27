(* BitDataStore — opaque persistent storage for Bits and BitVotes.

   Holds the bigmaps. Only the registered admin (initially the
   BitRegistryLogic contract) may mutate. All business validation
   (registration, syndicate membership, fee gating) is the logic
   contract's responsibility.

   To upgrade the business rules: deploy a new BitRegistryLogic,
   call set_admin to point this contract at the new logic. Bits and
   votes persist across upgrades because they live here.

   The entrypoints expose atomic state transitions
   (admin_create_bit, admin_apply_vote) rather than raw put_bit /
   put_vote so the data store guarantees vote-tally consistency
   regardless of how many logic versions write through it.
*)

type bit = {
  creator       : address ;
  content_hash  : bytes ;
  parent        : bytes option ;
  syndicate     : bytes option ;
  creation_time : timestamp ;
  yay           : nat ;
  nay           : nat ;
}

type vote = {
  voter     : address ;
  direction : bool ;
  votes     : nat ;
  vote_time : timestamp ;
}

type storage = {
  bits  : (bytes, bit) big_map ;
  votes : (bytes, vote) big_map ;
  admin : address ;
}

let require_admin (admin : address) : unit =
  if Tezos.get_sender () <> admin then failwith "NOT_ADMIN"

let compute_vid (bid : bytes) (voter : address) : bytes =
  Crypto.blake2b (Bytes.concat bid (Bytes.pack voter))

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = require_admin store.admin in
  ([] : operation list), { store with admin = new_admin }

[@entry]
let admin_create_bit (params : bytes * bit) (store : storage) : operation list * storage =
  let (bid, b) = params in
  let () = require_admin store.admin in
  let () = if Big_map.mem bid store.bits then failwith "BIT_EXISTS" in
  ([] : operation list), { store with bits = Big_map.update bid (Some b) store.bits }

[@entry]
let admin_apply_vote (params : bytes * address * bool * nat * timestamp) (store : storage) : operation list * storage =
  let (bid, voter, direction, votes_n, vote_time) = params in
  let () = require_admin store.admin in

  let target : bit = match Big_map.find_opt bid store.bits with
    | Some b -> b
    | None -> failwith "BIT_NOT_FOUND" in
  let vid = compute_vid bid voter in

  (* Reverse the voter's previous contribution (if any). *)
  let target : bit = match Big_map.find_opt vid store.votes with
    | None -> target
    | Some prev ->
      let new_yay = if prev.direction
        then (match is_nat (target.yay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_YAY")
        else target.yay in
      let new_nay = if prev.direction
        then target.nay
        else (match is_nat (target.nay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_NAY") in
      { target with yay = new_yay ; nay = new_nay } in

  let target : bit =
    if direction
    then { target with yay = target.yay + votes_n }
    else { target with nay = target.nay + votes_n } in

  let v : vote = {
    voter = voter ;
    direction = direction ;
    votes = votes_n ;
    vote_time = vote_time ;
  } in

  ([] : operation list),
  { store with
    bits  = Big_map.update bid (Some target) store.bits ;
    votes = Big_map.update vid (Some v) store.votes }

(* ---- views ---- *)

[@view]
let get_bit (bid : bytes) (store : storage) : bit option = Big_map.find_opt bid store.bits

[@view]
let get_vote (vid : bytes) (store : storage) : vote option = Big_map.find_opt vid store.votes

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin
