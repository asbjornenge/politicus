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

export async function readVariable(tezos: TezosToolkit, cfg: Config, key: string): Promise<bigint | null> {
  const c = await tezos.contract.at(cfg.contracts.Variables);
  const result: any = await c.contractViews.get(key).executeView({ viewCaller: cfg.contracts.Variables });
  if (result == null) return null;
  const unwrapped = result.Some !== undefined ? result.Some : result;
  return BigInt(unwrapped.toString());
}

export async function createBit(
  tezos: TezosToolkit,
  cfg: Config,
  contentHash: string,
  parent: string | null = null,
  syndicate: string | null = null,
) {
  const cost = await readVariable(tezos, cfg, 'BitCost');
  if (cost == null) throw new Error('BitCost not set');

  const c = await tezos.contract.at(cfg.contracts.BitRegistry);
  const op = await c.methodsObject
    .create_bit({ 0: contentHash, 1: parent, 2: syndicate })
    .send({ amount: Number(cost), mutez: true });
  await op.confirmation();
  return op.hash;
}

export async function voteBit(
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
  const op = await c.methodsObject
    .vote_bit({ 0: bid, 1: direction, 2: String(votes) })
    .send({ amount: total, mutez: true });
  await op.confirmation();
  return op.hash;
}
