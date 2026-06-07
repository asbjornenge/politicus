// Originate the Michelson Counter on Previewnet using the main project's
// POLITICUS key. Stashes COUNTER_KT1 into the PoC .env.

import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const repoRoot = join(repo, '..', '..');

config({ path: join(repoRoot, '.env') });
config({ path: join(repo, '.env'), override: false });

const env = process.env;
const tezos = new TezosToolkit(env.POC_TEZOS_RPC ?? env.POLITICUS_RPC_URL);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));

const codeJson = JSON.parse(readFileSync(join(repo, 'artifacts/Counter.json'), 'utf8'));
const code = Array.isArray(codeJson) ? codeJson : codeJson.michelson ?? codeJson;

const storage = { counter: 0, last_sender: null };

console.log('Originating Counter on Previewnet…');
const est = await tezos.estimate.originate({ code, storage });
const op = await tezos.contract.originate({
  code,
  storage,
  fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(est.gasLimit * 1.3),
  storageLimit: Math.ceil(est.storageLimit * 1.3),
});
console.log(`  op ${op.hash}`);
await op.confirmation();
console.log(`  → ${op.contractAddress}`);

// Persist
const envPath = join(repo, '.env');
let body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
body = body.replace(/^POC_COUNTER_KT1=.*\n?/m, '');
body += `\nPOC_COUNTER_KT1=${op.contractAddress}\n`;
writeFileSync(envPath, body);
console.log(`recorded POC_COUNTER_KT1=${op.contractAddress} in ${envPath}`);
