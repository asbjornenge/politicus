(* PetitionDataStore — opaque persistence for petitions and their votes.

   Holds petitions, petition_votes, and a monotonic seq counter. Only the
   admin (PetitionLogic) may mutate. State transitions are atomic:
   admin_create_petition assigns the next pid + bumps seq, admin_apply_vote
   handles the quadratic reverse-and-reapply pattern, admin_resolve_petition
   flips the resolved flag.
*)

type petition_action =
  | Set_variable of string * nat
  | Mod_content_add of bytes
  | Mod_content_del of bytes
  | Mod_user_add of address
  | Mod_user_del of address
  | Migrate_logic of address * address

type petition = {
  creator       : address ;
  action        : petition_action ;
  creation_time : timestamp ;
  closes_at     : timestamp ;
  yay           : nat ;
  nay           : nat ;
  unique_voters : nat ;
  resolved      : bool ;
  passed        : bool ;
}

type petition_vote = {
  voter     : address ;
  direction : bool ;
  votes     : nat ;
  vote_time : timestamp ;
}

type storage = {
  petitions         : (bytes, petition) big_map ;
  votes             : (bytes, petition_vote) big_map ;
  next_petition_seq : nat ;
  admin             : address ;
}

let require_admin (admin : address) : unit =
  if Tezos.get_sender () <> admin then failwith "NOT_ADMIN"

let compute_pvid (pid : bytes) (voter : address) : bytes =
  Crypto.blake2b (Bytes.concat pid (Bytes.pack voter))

[@entry]
let set_admin (new_admin : address) (store : storage) : operation list * storage =
  let () = require_admin store.admin in
  ([] : operation list), { store with admin = new_admin }

[@entry]
let admin_create_petition (p : petition) (store : storage) : operation list * storage =
  let () = require_admin store.admin in
  let pid = Crypto.blake2b (Bytes.pack store.next_petition_seq) in
  ([] : operation list),
  { store with
    petitions         = Big_map.update pid (Some p) store.petitions ;
    next_petition_seq = store.next_petition_seq + 1n }

[@entry]
let admin_apply_vote (params : bytes * address * bool * nat * timestamp) (store : storage) : operation list * storage =
  let (pid, voter, direction, votes_n, vote_time) = params in
  let () = require_admin store.admin in

  let p : petition = match Big_map.find_opt pid store.petitions with
    | Some p -> p
    | None -> failwith "PETITION_NOT_FOUND" in
  let pvid = compute_pvid pid voter in

  let is_new = match Big_map.find_opt pvid store.votes with
    | None -> true
    | Some _ -> false in

  let p : petition = match Big_map.find_opt pvid store.votes with
    | None -> p
    | Some prev ->
      let new_yay = if prev.direction
        then (match is_nat (p.yay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_YAY")
        else p.yay in
      let new_nay = if prev.direction
        then p.nay
        else (match is_nat (p.nay - prev.votes) with Some n -> n | None -> failwith "INVARIANT_NAY") in
      { p with yay = new_yay ; nay = new_nay } in

  let p : petition =
    if direction
    then { p with yay = p.yay + votes_n }
    else { p with nay = p.nay + votes_n } in

  let p : petition = if is_new then { p with unique_voters = p.unique_voters + 1n } else p in

  let v : petition_vote = {
    voter = voter ; direction = direction ; votes = votes_n ; vote_time = vote_time
  } in

  ([] : operation list),
  { store with
    petitions = Big_map.update pid (Some p) store.petitions ;
    votes     = Big_map.update pvid (Some v) store.votes }

[@entry]
let admin_resolve_petition (params : bytes * bool) (store : storage) : operation list * storage =
  let (pid, passed) = params in
  let () = require_admin store.admin in
  let p : petition = match Big_map.find_opt pid store.petitions with
    | Some p -> p
    | None -> failwith "PETITION_NOT_FOUND" in
  let updated = { p with resolved = true ; passed = passed } in
  ([] : operation list),
  { store with petitions = Big_map.update pid (Some updated) store.petitions }

[@view]
let get_petition (pid : bytes) (store : storage) : petition option =
  Big_map.find_opt pid store.petitions

[@view]
let get_petition_vote (pvid : bytes) (store : storage) : petition_vote option =
  Big_map.find_opt pvid store.votes

[@view]
let next_pid (() : unit) (store : storage) : bytes =
  Crypto.blake2b (Bytes.pack store.next_petition_seq)

[@view]
let get_admin (() : unit) (store : storage) : address = store.admin
