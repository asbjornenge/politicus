(* BitRegistry — stores Bits (signed content) and BitVotes.

   This is the first contract that talks to others:
   - Reads `is_registered` from IdentityRegistry to gate authorship.
   - Reads kernel parameters from Variables via its `get` view.
   - Routes the fee tez to the Treasury contract via its default entrypoint.

   Inter-contract reads use `Tezos.call_view`, which is synchronous (no
   operations emitted). The treasury transfer is asynchronous — the operation
   is queued and runs after this entrypoint returns.

   MVP simplifications (each will be revisited):
   - Single creator per Bit (no multi-author yet).
   - 100% of the fee goes to Treasury. The README's `TreasuryFee` split into
     creator/voter rewards is deferred until the incentive layer is designed.
   - Caller must send the exact fee amount (Tezos.get_amount() = cost).
   - Re-voting overwrites the previous vote on the tally side, and is paid
     again — no refund, no discount.
*)

type bit = {
  creator       : address ;
  content_hash  : bytes ;
  parent        : bytes option ;
  syndicate     : string option ;
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
  bits              : (bytes, bit) big_map ;
  votes             : (bytes, vote) big_map ;
  identity_registry : address ;
  variables         : address ;
  treasury          : address ;
}

(* ---- helpers ---- *)

let require_registered (caller : address) (identity_registry : address) : unit =
  let registered : bool = match (Tezos.call_view "is_registered" caller identity_registry : bool option) with
    | Some b -> b
    | None -> failwith "IDENTITY_VIEW_FAILED" in
  if not registered then failwith "NOT_REGISTERED"

let get_variable_or_fail (variables : address) (key : string) : nat =
  match (Tezos.call_view "get" key variables : nat option option) with
  | Some (Some n) -> n
  | _ -> failwith "VARIABLE_MISSING"

let send_to_treasury (treasury : address) (amount : tez) : operation =
  let c : unit contract = match (Tezos.get_contract_opt treasury : unit contract option) with
    | Some c -> c
    | None -> failwith "TREASURY_NOT_FOUND" in
  Tezos.Next.Operation.transaction () amount c

let compute_bid (creator : address) (content_hash : bytes) : bytes =
  Crypto.blake2b (Bytes.concat (Bytes.pack creator) content_hash)

let compute_vid (bid : bytes) (voter : address) : bytes =
  Crypto.blake2b (Bytes.concat bid (Bytes.pack voter))

let mutez_to_tez (n : nat) : tez = n * 1mutez

(* ---- entrypoints ---- *)

[@entry]
let create_bit (params : bytes * bytes option * string option) (store : storage) : operation list * storage =
  let (content_hash, parent, syndicate) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in

  let cost : tez = mutez_to_tez (get_variable_or_fail store.variables "BitCost") in
  let () = if Tezos.get_amount () <> cost then failwith "WRONG_AMOUNT" in

  let bid = compute_bid caller content_hash in
  let () = if Big_map.mem bid store.bits then failwith "BIT_EXISTS" in

  let b : bit = {
    creator = caller ;
    content_hash = content_hash ;
    parent = parent ;
    syndicate = syndicate ;
    creation_time = Tezos.get_now () ;
    yay = 0n ;
    nay = 0n ;
  } in

  let op = send_to_treasury store.treasury cost in
  [op], { store with bits = Big_map.update bid (Some b) store.bits }

[@entry]
let vote_bit (params : bytes * bool * nat) (store : storage) : operation list * storage =
  let (bid, direction, votes) = params in
  let caller = Tezos.get_sender () in
  let () = require_registered caller store.identity_registry in
  let () = if votes = 0n then failwith "ZERO_VOTES" in

  let unit_cost : nat = get_variable_or_fail store.variables "BitVoteCost" in
  let total_cost : tez = mutez_to_tez (unit_cost * votes * votes) in
  let () = if Tezos.get_amount () <> total_cost then failwith "WRONG_AMOUNT" in

  let target : bit = match Big_map.find_opt bid store.bits with
    | Some b -> b
    | None -> failwith "BIT_NOT_FOUND" in

  let vid = compute_vid bid caller in

  (* If voter previously voted on this Bit, subtract their old contribution. *)
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
    then { target with yay = target.yay + votes }
    else { target with nay = target.nay + votes } in

  let v : vote = {
    voter = caller ;
    direction = direction ;
    votes = votes ;
    vote_time = Tezos.get_now () ;
  } in

  let op = send_to_treasury store.treasury total_cost in
  [op],
  { store with
    bits = Big_map.update bid (Some target) store.bits ;
    votes = Big_map.update vid (Some v) store.votes }

(* ---- views ---- *)

[@view]
let get_bit (bid : bytes) (store : storage) : bit option =
  Big_map.find_opt bid store.bits

[@view]
let get_vote (vid : bytes) (store : storage) : vote option =
  Big_map.find_opt vid store.votes

[@view]
let compute_bid_view (params : address * bytes) (store : storage) : bytes =
  let _ = store in
  let (creator, content_hash) = params in
  compute_bid creator content_hash

[@view]
let compute_vid_view (params : bytes * address) (store : storage) : bytes =
  let _ = store in
  let (bid, voter) = params in
  compute_vid bid voter
