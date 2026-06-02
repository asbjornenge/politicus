(* BitNFTCollection — FA2-compatible NFT collection for one author or syndicate.

   One contract per creator (or per syndicate). The owner of the collection is
   either a single address (User) or a syndicate's admin set, looked up via
   call_view on SyndicateRegistry (Syndicate). The collection holds editions
   of Bits — each edition is its own FA2 token_id, with total_supply equal to
   `total_editions` (1..N for limited series, with current minted count
   tracked via `sold`).

   At mint time we snapshot the current treasury split from Variables into
   the edition record so future buyers see a fee that cannot retroactively
   change. Future governance updates to BitNFTPrimaryFee /
   BitNFTSecondaryFee only affect editions minted afterwards.

   We do not gate access to bit content here — owning a BitNFT confers
   provenance, not exclusivity. The bit body remains freely readable.
*)

type owner_kind =
  | User of address
  | Syndicate of address * bytes  (* (syndicate_registry, sid) *)

type edition = {
  bid                    : bytes ;
  total_editions         : nat ;
  mint_price             : nat ;       (* mutez *)
  royalty_bps            : nat ;       (* creator's secondary royalty *)
  treasury_primary_bps   : nat ;       (* snapshotted from Variables *)
  treasury_secondary_bps : nat ;       (* snapshotted from Variables *)
  sold                   : nat ;
  created_at             : timestamp ;
}

(* FA2 types *)
type transfer_item = {
  to_      : address ;
  token_id : nat ;
  amount   : nat ;
}

type transfer_arg = {
  from_ : address ;
  txs   : transfer_item list ;
}

type operator_update = {
  owner    : address ;
  operator : address ;
  token_id : nat ;
}

type update_operator =
  | Add_operator of operator_update
  | Remove_operator of operator_update

type balance_request = {
  owner    : address ;
  token_id : nat ;
}

type balance_response = {
  request : balance_request ;
  balance : nat ;
}

type balance_of_param = {
  requests : balance_request list ;
  callback : balance_response list contract ;
}

type storage = {
  owner             : owner_kind ;
  variables         : address ;
  treasury          : address ;
  bit_registry      : address ;
  identity_registry : address ;
  payout            : address option ;
  ledger            : (address * nat, nat) big_map ;
  operators         : (address * (address * nat), unit) big_map ;
  editions          : (nat, edition) big_map ;
  total_supply      : (nat, nat) big_map ;
  next_token_id     : nat ;
}

(* ---- helpers ---- *)

let get_variable_or_fail (variables : address) (key : string) : nat =
  match (Tezos.call_view "get" key variables : nat option option) with
  | Some (Some n) -> n
  | _ -> failwith "VARIABLE_MISSING"

let send_tez (to_ : address) (amount : tez) : operation =
  let c : unit contract = match (Tezos.get_contract_opt to_ : unit contract option) with
    | Some c -> c
    | None -> failwith "INVALID_PAYEE" in
  Tezos.Next.Operation.transaction () amount c

let mutez_to_tez (n : nat) : tez = n * 1mutez

let require_owner (store : storage) : unit =
  let caller = Tezos.get_sender () in
  match store.owner with
  | User addr ->
    if caller <> addr then failwith "NOT_OWNER"
  | Syndicate (synd_reg, sid) ->
    let is_admin : bool = match (Tezos.call_view "is_admin" (sid, caller) synd_reg : bool option) with
      | Some b -> b
      | None -> failwith "SYNDICATE_VIEW_FAILED" in
    if not is_admin then failwith "NOT_SYNDICATE_ADMIN"

let get_balance (key : address * nat) (ledger : (address * nat, nat) big_map) : nat =
  match Big_map.find_opt key ledger with
  | Some b -> b
  | None -> 0n

let is_authorized (owner : address) (token_id : nat) (operators : (address * (address * nat), unit) big_map) : bool =
  let sender = Tezos.get_sender () in
  sender = owner ||
  Big_map.mem (owner, (sender, token_id)) operators

(* ---- entrypoints ---- *)

[@entry]
let mint_edition (params : bytes * nat * nat * nat) (store : storage) : operation list * storage =
  let (bid, total_editions, mint_price, royalty_bps) = params in
  let () = require_owner store in
  let () = if total_editions = 0n then failwith "ZERO_EDITIONS" in
  let () = if royalty_bps > 2500n then failwith "ROYALTY_TOO_HIGH" in

  let treasury_primary_bps = get_variable_or_fail store.variables "BitNFTPrimaryFee" in
  let treasury_secondary_bps = get_variable_or_fail store.variables "BitNFTSecondaryFee" in

  let token_id = store.next_token_id in
  let e : edition = {
    bid                    = bid ;
    total_editions         = total_editions ;
    mint_price             = mint_price ;
    royalty_bps            = royalty_bps ;
    treasury_primary_bps   = treasury_primary_bps ;
    treasury_secondary_bps = treasury_secondary_bps ;
    sold                   = 0n ;
    created_at             = Tezos.get_now () ;
  } in

  ([] : operation list),
  { store with
    editions      = Big_map.update token_id (Some e) store.editions ;
    total_supply  = Big_map.update token_id (Some 0n) store.total_supply ;
    next_token_id = token_id + 1n }

[@entry]
let buy (token_id : nat) (store : storage) : operation list * storage =
  let e : edition = match Big_map.find_opt token_id store.editions with
    | Some e -> e
    | None -> failwith "TOKEN_NOT_FOUND" in
  let () = if e.sold >= e.total_editions then failwith "SOLD_OUT" in
  let price : tez = mutez_to_tez e.mint_price in
  let () = if Tezos.get_amount () <> price then failwith "WRONG_AMOUNT" in

  let buyer = Tezos.get_sender () in

  (* Split: treasury_primary_bps to Treasury, rest to creator(s). *)
  let treasury_share_mutez : nat = e.mint_price * e.treasury_primary_bps / 10000n in
  let creator_share_mutez : nat = match is_nat (e.mint_price - treasury_share_mutez) with
    | Some n -> n
    | None -> failwith "INVARIANT_SPLIT" in

  let pay_treasury_op = send_tez store.treasury (mutez_to_tez treasury_share_mutez) in
  let creator_addr : address = match store.payout with
    | Some addr -> addr
    | None ->
      (match store.owner with
       | User a -> a
       | Syndicate (_, _) -> store.treasury) in
  (* For user collections without an override the creator's own address
     gets paid. For syndicate collections an explicit payout MUST be set
     by an admin (set_payout); until then proceeds default to Treasury,
     which is intentionally a friction so syndicates wire up their share
     deliberately. *)
  let pay_creator_op =
    if creator_share_mutez > 0n
    then [send_tez creator_addr (mutez_to_tez creator_share_mutez)]
    else ([] : operation list) in

  let updated_e = { e with sold = e.sold + 1n } in
  let buyer_balance = get_balance (buyer, token_id) store.ledger in
  let new_supply : nat = match Big_map.find_opt token_id store.total_supply with
    | Some s -> s + 1n
    | None -> 1n in

  (pay_treasury_op :: pay_creator_op),
  { store with
    editions     = Big_map.update token_id (Some updated_e) store.editions ;
    ledger       = Big_map.update (buyer, token_id) (Some (buyer_balance + 1n)) store.ledger ;
    total_supply = Big_map.update token_id (Some new_supply) store.total_supply }

[@entry]
let transfer (params : transfer_arg list) (store : storage) : operation list * storage =
  let apply_one ((acc, arg) : storage * transfer_arg) : storage =
    let tx_fn ((acc2, tx) : storage * transfer_item) : storage =
      let () = if not (is_authorized arg.from_ tx.token_id acc2.operators) then failwith "FA2_NOT_OPERATOR" in
      let from_balance = get_balance (arg.from_, tx.token_id) acc2.ledger in
      let () = if from_balance < tx.amount then failwith "FA2_INSUFFICIENT_BALANCE" in
      let new_from = match is_nat (from_balance - tx.amount) with Some n -> n | None -> 0n in
      let to_balance = get_balance (tx.to_, tx.token_id) acc2.ledger in
      { acc2 with
        ledger = Big_map.update (arg.from_, tx.token_id) (Some new_from)
                   (Big_map.update (tx.to_, tx.token_id) (Some (to_balance + tx.amount)) acc2.ledger) } in
    List.fold_left tx_fn acc arg.txs in
  ([] : operation list),
  List.fold_left (fun (s, a) -> apply_one (s, a)) store params

[@entry]
let update_operators (params : update_operator list) (store : storage) : operation list * storage =
  let apply ((acc, u) : storage * update_operator) : storage =
    let (op_data, add) = match u with
      | Add_operator d -> (d, true)
      | Remove_operator d -> (d, false) in
    let () = if Tezos.get_sender () <> op_data.owner then failwith "FA2_NOT_OWNER" in
    let key = (op_data.owner, (op_data.operator, op_data.token_id)) in
    { acc with
      operators =
        if add
        then Big_map.update key (Some ()) acc.operators
        else Big_map.update key (None : unit option) acc.operators } in
  ([] : operation list),
  List.fold_left (fun (s, u) -> apply (s, u)) store params

[@entry]
let balance_of (param : balance_of_param) (store : storage) : operation list * storage =
  let respond (r : balance_request) : balance_response =
    { request = r ; balance = get_balance (r.owner, r.token_id) store.ledger } in
  let responses = List.map respond param.requests in
  [Tezos.Next.Operation.transaction responses 0tez param.callback], store

[@entry]
let set_payout (new_payout : address option) (store : storage) : operation list * storage =
  let () = require_owner store in
  ([] : operation list), { store with payout = new_payout }

(* ---- views ---- *)

[@view]
let get_edition (token_id : nat) (store : storage) : edition option =
  Big_map.find_opt token_id store.editions

[@view]
let get_balance (params : address * nat) (store : storage) : nat =
  get_balance params store.ledger

[@view]
let get_total_supply (token_id : nat) (store : storage) : nat =
  match Big_map.find_opt token_id store.total_supply with
  | Some s -> s
  | None -> 0n

[@view]
let get_owner_kind (() : unit) (store : storage) : owner_kind = store.owner

[@view]
let total_editions_minted (() : unit) (store : storage) : nat = store.next_token_id

[@view]
let get_payout (() : unit) (store : storage) : address option = store.payout
