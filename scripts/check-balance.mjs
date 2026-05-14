import { TezosToolkit } from '@taquito/taquito';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const { POLITICUS_ADDRESS } = process.env;
const rpcUrl = process.env.POLITICUS_RPC_URL ?? 'https://rpc.shadownet.teztnets.com';

if (!POLITICUS_ADDRESS) {
  console.error('POLITICUS_ADDRESS missing from .env. Run `npm run generate-key` first.');
  process.exit(1);
}

const tezos = new TezosToolkit(rpcUrl);
const mutez = await tezos.tz.getBalance(POLITICUS_ADDRESS);
const tez = mutez.dividedBy(1_000_000).toFixed(6);

console.log(`Address: ${POLITICUS_ADDRESS}`);
console.log(`RPC:     ${rpcUrl}`);
console.log(`Balance: ${tez} tez (${mutez.toString()} mutez)`);
