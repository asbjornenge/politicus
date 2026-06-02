import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import type { Config } from './api';

const SK_KEY = 'politicus_sk';

export function loadSecretKey(): string | null {
  return localStorage.getItem(SK_KEY);
}

export function saveSecretKey(sk: string) {
  localStorage.setItem(SK_KEY, sk);
}

export function clearSecretKey() {
  localStorage.removeItem(SK_KEY);
}

export async function buildToolkit(cfg: Config, sk: string) {
  const tezos = new TezosToolkit(cfg.rpcUrl);
  const signer = await InMemorySigner.fromSecretKey(sk);
  tezos.setSignerProvider(signer);
  const address = await signer.publicKeyHash();
  return { tezos, address };
}

export async function isUserRegistered(tezos: TezosToolkit, cfg: Config, address: string): Promise<boolean> {
  const c = await tezos.contract.at(cfg.contracts.IdentityRegistry);
  const result: any = await c.contractViews.is_registered(address).executeView({ viewCaller: address });
  return Boolean(result);
}

export async function registerUser(
  tezos: TezosToolkit,
  cfg: Config,
  opts: { brightidHash: string; username: string; bio: string },
) {
  const c = await tezos.contract.at(cfg.contracts.IdentityRegistry);
  const op = await c.methodsObject
    .register({ 0: opts.brightidHash, 1: opts.username, 2: opts.bio })
    .send();
  await op.confirmation();
  return op.hash;
}

// IPFS CIDs are base58/base32 strings, but Tezos `bytes` parameters require
// a hex string. We pack the CID as UTF-8 bytes and hex-encode that. Indexers
// reverse the process when reading from a bigmap.
export function cidToHexBytes(cid: string): string {
  return Array.from(new TextEncoder().encode(cid))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function placeholderBrightIdHash(address: string): Promise<string> {
  const data = new TextEncoder().encode(`politicus-placeholder-${address}`);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function ensureRegistered(
  tezos: TezosToolkit,
  cfg: Config,
  address: string,
  onProgress?: (s: string) => void,
) {
  const r = await isUserRegistered(tezos, cfg, address);
  if (r) return;
  onProgress?.('registering anonymously…');
  const placeholderHash = await placeholderBrightIdHash(address);
  const c = await tezos.contract.at(cfg.contracts.IdentityRegistry);
  const op = await c.methodsObject
    .register({ 0: placeholderHash, 1: address.slice(0, 8), 2: '' })
    .send();
  await op.confirmation();
}

export async function updateProfile(
  tezos: TezosToolkit,
  cfg: Config,
  opts: { username: string; bio: string },
) {
  const c = await tezos.contract.at(cfg.contracts.IdentityRegistry);
  const op = await c.methodsObject
    .update_profile({ 0: opts.username, 1: opts.bio })
    .send();
  await op.confirmation();
  return op.hash;
}

export async function readVariable(tezos: TezosToolkit, cfg: Config, key: string): Promise<bigint | null> {
  const c = await tezos.contract.at(cfg.contracts.Variables);
  const result: any = await c.contractViews.get(key).executeView({ viewCaller: cfg.contracts.Variables });
  if (result == null) return null;
  const unwrapped = result.Some !== undefined ? result.Some : result;
  return BigInt(unwrapped.toString());
}

// Send-only variants: return op without awaiting confirmation, so callers can
// report progress between mempool and confirmation.

export async function sendCreateBit(
  tezos: TezosToolkit,
  cfg: Config,
  contentHash: string,
  parent: string | null = null,
  syndicate: string | null = null,
) {
  const cost = await readVariable(tezos, cfg, 'BitCost');
  if (cost == null) throw new Error('BitCost not set');
  const c = await tezos.contract.at(cfg.contracts.BitRegistry);
  return await c.methodsObject
    .create_bit({ 0: cidToHexBytes(contentHash), 1: parent, 2: syndicate })
    .send({ amount: Number(cost), mutez: true });
}

export async function sendVoteBit(
  tezos: TezosToolkit,
  cfg: Config,
  bid: string,
  direction: boolean,
  votes: number,
) {
  const unitCost = await readVariable(tezos, cfg, 'BitVoteCost');
  if (unitCost == null) throw new Error('BitVoteCost not set');
  const total = Number(unitCost) * votes * votes;
  const c = await tezos.contract.at(cfg.contracts.BitRegistry);
  return await c.methodsObject
    .vote_bit({ 0: bid, 1: direction, 2: String(votes) })
    .send({ amount: total, mutez: true });
}

export async function sendCreateSetVariablePetition(
  tezos: TezosToolkit,
  cfg: Config,
  key: string,
  value: number,
) {
  const cost = await readVariable(tezos, cfg, 'PetitionUpdateVariableCost');
  if (cost == null) throw new Error('PetitionUpdateVariableCost not set');
  const c = await tezos.contract.at(cfg.contracts.PetitionRegistry);
  return await c.methodsObject
    .create_petition({ set_variable: { 0: key, 1: String(value) } })
    .send({ amount: Number(cost), mutez: true });
}

export async function sendCreateModContentAddPetition(
  tezos: TezosToolkit,
  cfg: Config,
  contentHash: string,
) {
  const cost = await readVariable(tezos, cfg, 'PetitionContentModerationAddCost');
  if (cost == null) throw new Error('PetitionContentModerationAddCost not set');
  const c = await tezos.contract.at(cfg.contracts.PetitionRegistry);
  return await c.methodsObject
    .create_petition({ mod_content_add: cidToHexBytes(contentHash) })
    .send({ amount: Number(cost), mutez: true });
}

export async function sendCreateMigrateLogicPetition(
  tezos: TezosToolkit,
  cfg: Config,
  targetLogic: string,
  newLogic: string,
) {
  const cost = await readVariable(tezos, cfg, 'PetitionMigrateLogicCost');
  if (cost == null) throw new Error('PetitionMigrateLogicCost not set');
  const c = await tezos.contract.at(cfg.contracts.PetitionRegistry);
  return await c.methodsObject
    .create_petition({ migrate_logic: { 0: targetLogic, 1: newLogic } })
    .send({ amount: Number(cost), mutez: true });
}

export async function sendVotePetition(
  tezos: TezosToolkit,
  cfg: Config,
  pid: string,
  direction: boolean,
  votes: number,
) {
  const unitCost = await readVariable(tezos, cfg, 'PetitionVoteCost');
  if (unitCost == null) throw new Error('PetitionVoteCost not set');
  const total = Number(unitCost) * votes * votes;
  const c = await tezos.contract.at(cfg.contracts.PetitionRegistry);
  return await c.methodsObject
    .vote_petition({ 0: pid, 1: direction, 2: String(votes) })
    .send({ amount: total, mutez: true });
}

export async function sendResolvePetition(
  tezos: TezosToolkit,
  cfg: Config,
  pid: string,
) {
  const c = await tezos.contract.at(cfg.contracts.PetitionRegistry);
  return await c.methodsObject.resolve_petition(pid).send();
}

export async function sendCreateSyndicate(
  tezos: TezosToolkit,
  cfg: Config,
  name: string,
  bio: string,
) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const cost = await readVariable(tezos, cfg, 'SyndicateCreationCost');
  if (cost == null) throw new Error('SyndicateCreationCost not set');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject
    .create_syndicate({ 0: name, 1: bio })
    .send({ amount: Number(cost), mutez: true });
}

export async function sendAddMember(tezos: TezosToolkit, cfg: Config, sid: string, who: string) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject.add_member({ 0: sid, 1: who }).send();
}

export async function sendRemoveMember(tezos: TezosToolkit, cfg: Config, sid: string, who: string) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject.remove_member({ 0: sid, 1: who }).send();
}

export async function sendPromoteAdmin(tezos: TezosToolkit, cfg: Config, sid: string, who: string) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject.promote_admin({ 0: sid, 1: who }).send();
}

export async function sendDemoteAdmin(tezos: TezosToolkit, cfg: Config, sid: string, who: string) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject.demote_admin({ 0: sid, 1: who }).send();
}

export async function sendUpdateSyndicateMetadata(tezos: TezosToolkit, cfg: Config, sid: string, name: string, bio: string) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.SyndicateRegistry);
  return await c.methodsObject.update_metadata({ 0: sid, 1: name, 2: bio }).send();
}

export async function sendUpdateUserProfile(tezos: TezosToolkit, cfg: Config, profileHash: string) {
  if (!cfg.contracts.ProfileRegistry) throw new Error('ProfileRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.ProfileRegistry);
  return await c.methodsObject.update_user_profile(cidToHexBytes(profileHash)).send();
}

export async function sendClearUserProfile(tezos: TezosToolkit, cfg: Config) {
  if (!cfg.contracts.ProfileRegistry) throw new Error('ProfileRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.ProfileRegistry);
  return await c.methodsObject.clear_user_profile().send();
}

export async function sendUpdateSyndicateProfile(tezos: TezosToolkit, cfg: Config, sid: string, profileHash: string) {
  if (!cfg.contracts.ProfileRegistry) throw new Error('ProfileRegistry not deployed');
  const c = await tezos.contract.at(cfg.contracts.ProfileRegistry);
  return await c.methodsObject.update_syndicate_profile({ 0: sid, 1: cidToHexBytes(profileHash) }).send();
}

// --- BitNFT ---

import bitNFTCollectionCode from './contracts/BitNFTCollection.json';

export type OwnerKind =
  | { kind: 'user'; address: string }
  | { kind: 'syndicate'; syndicateRegistry: string; sid: string };

export async function originateBitNFTCollection(
  tezos: TezosToolkit,
  cfg: Config,
  owner: OwnerKind,
) {
  if (!cfg.contracts.SyndicateRegistry) throw new Error('SyndicateRegistry not deployed');
  if (!cfg.contracts.BitRegistry) throw new Error('BitRegistry not deployed');
  const storageOwner = owner.kind === 'user'
    ? { user: owner.address }
    : { syndicate: { 0: owner.syndicateRegistry, 1: owner.sid } };
  const op = await tezos.contract.originate({
    code: bitNFTCollectionCode as any,
    storage: {
      owner: storageOwner,
      variables: cfg.contracts.Variables,
      treasury: cfg.contracts.Treasury,
      bit_registry: cfg.contracts.BitRegistry,
      identity_registry: cfg.contracts.IdentityRegistry,
      ledger: new MichelsonMap(),
      operators: new MichelsonMap(),
      editions: new MichelsonMap(),
      total_supply: new MichelsonMap(),
      next_token_id: 0,
    },
  });
  return op;
}

export async function sendRegisterCollection(
  tezos: TezosToolkit,
  cfg: Config,
  collectionAddr: string,
  owner: OwnerKind,
) {
  if (!cfg.contracts.BitNFTFactory) throw new Error('BitNFTFactory not deployed');
  const factory = await tezos.contract.at(cfg.contracts.BitNFTFactory);
  const ownerKind = owner.kind === 'user'
    ? { user: owner.address }
    : { syndicate: { 0: owner.syndicateRegistry, 1: owner.sid } };
  // The factory has a single entrypoint, so Taquito exposes it as `default`.
  return await factory.methodsObject.default({ 0: collectionAddr, 1: ownerKind }).send();
}

export async function sendMintEdition(
  tezos: TezosToolkit,
  collectionAddr: string,
  bid: string,
  totalEditions: number,
  mintPriceMutez: number,
  royaltyBps: number,
) {
  const c = await tezos.contract.at(collectionAddr);
  return await c.methodsObject.mint_edition({
    0: bid, 1: String(totalEditions), 2: String(mintPriceMutez), 3: String(royaltyBps),
  }).send();
}

export async function sendBuyEdition(
  tezos: TezosToolkit,
  collectionAddr: string,
  tokenId: number,
  priceMutez: number,
) {
  const c = await tezos.contract.at(collectionAddr);
  return await c.methodsObject.buy(String(tokenId)).send({ amount: priceMutez, mutez: true });
}

// Legacy wrappers that fully await confirmation. Kept for the few callers that
// don't need granular progress (vote/resolve buttons).

export async function voteBit(
  tezos: TezosToolkit,
  cfg: Config,
  bid: string,
  direction: boolean,
  votes: number,
) {
  const op = await sendVoteBit(tezos, cfg, bid, direction, votes);
  await op.confirmation();
  return op.hash;
}

export async function votePetition(
  tezos: TezosToolkit,
  cfg: Config,
  pid: string,
  direction: boolean,
  votes: number,
) {
  const op = await sendVotePetition(tezos, cfg, pid, direction, votes);
  await op.confirmation();
  return op.hash;
}

export async function resolvePetition(
  tezos: TezosToolkit,
  cfg: Config,
  pid: string,
) {
  const op = await sendResolvePetition(tezos, cfg, pid);
  await op.confirmation();
  return op.hash;
}
