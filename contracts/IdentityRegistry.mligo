(* IdentityRegistry — binds Tezos keys to verified-unique-human attestations.

   For the MVP this is a *placeholder* for BrightID. The contract takes an
   opaque `brightid_hash : bytes` and enforces uniqueness via a reverse index:
   the same hash cannot be registered twice. In production, the contract will
   additionally verify a signature from BrightID's well-known public key over
   the attestation payload — that verification step is intentionally omitted
   for now so we can develop the rest of the stack without an external
   dependency.

   No admin. Users self-register, self-update, self-deregister. Emergency
   moderation belongs in the future PetitionRegistry layer.

   Deregister frees the brightid_hash for reuse. This is a deliberate MVP
   choice: real BrightID attestations are time-bound, so the freeing
   semantics will look different in production.
*)

type user = {
  username      : string ;
  bio           : string ;
  brightid_hash : bytes ;
}

type storage = {
  users         : (address, user) big_map ;
  brightid_used : (bytes, address) big_map ;
  total_users   : nat ;
}

[@entry]
let register (params : bytes * string * string) (store : storage) : operation list * storage =
  let (brightid_hash, username, bio) = params in
  let caller = Tezos.get_sender () in
  let () = if Big_map.mem caller store.users then failwith "ALREADY_REGISTERED" in
  let () = if Big_map.mem brightid_hash store.brightid_used then failwith "BRIGHTID_ALREADY_USED" in
  let u : user = { username = username ; bio = bio ; brightid_hash = brightid_hash } in
  ([] : operation list),
  { users = Big_map.update caller (Some u) store.users ;
    brightid_used = Big_map.update brightid_hash (Some caller) store.brightid_used ;
    total_users = store.total_users + 1n }

[@entry]
let update_profile (params : string * string) (store : storage) : operation list * storage =
  let (username, bio) = params in
  let caller = Tezos.get_sender () in
  let u : user = match Big_map.find_opt caller store.users with
    | Some existing -> existing
    | None -> failwith "NOT_REGISTERED" in
  let updated : user = { u with username = username ; bio = bio } in
  ([] : operation list),
  { store with users = Big_map.update caller (Some updated) store.users }

[@entry]
let deregister (() : unit) (store : storage) : operation list * storage =
  let caller = Tezos.get_sender () in
  let u : user = match Big_map.find_opt caller store.users with
    | Some existing -> existing
    | None -> failwith "NOT_REGISTERED" in
  let new_total = match is_nat (store.total_users - 1n) with
    | Some n -> n
    | None -> 0n in
  ([] : operation list),
  { users = Big_map.update caller (None : user option) store.users ;
    brightid_used = Big_map.update u.brightid_hash (None : address option) store.brightid_used ;
    total_users = new_total }

[@view]
let count_users (() : unit) (store : storage) : nat = store.total_users

[@view]
let is_registered (addr : address) (store : storage) : bool =
  Big_map.mem addr store.users

[@view]
let get_user (addr : address) (store : storage) : user option =
  Big_map.find_opt addr store.users

[@view]
let lookup_by_brightid (h : bytes) (store : storage) : address option =
  Big_map.find_opt h store.brightid_used
