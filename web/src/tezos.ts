import { TezosToolkit } from '@taquito/taquito';
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

export async function ensureRegistered(
  tezos: TezosToolkit,
  cfg: Config,
  address: string,
  onProgress?: (s: string) => void,
) {
  const r = await isUserRegistered(tezos, cfg, address);
  if (r) return;
  onProgress?.('registering anonymously…');
  const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
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
    .create_bit({ 0: contentHash, 1: parent, 2: syndicate })
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
    .create_petition({ mod_content_add: contentHash })
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
