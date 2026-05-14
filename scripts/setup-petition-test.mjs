/**
 * Lower a few kernel variables to test-friendly values BEFORE handing
 * Variables admin over to PetitionRegistry. Once admin is transferred,
 * the only way to change these is via a successful petition.
 */
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const rpcUrl = process.env.POLITICUS_RPC_URL ?? 'https://rpc.shadownet.teztnets.com';
const network = process.env.POLITICUS_NETWORK ?? 'shadownet';
const deployments = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8'));
const VARIABLES = deployments[network].Variables;

const overrides = [
  ['PetitionDuration', '60'],                  // 60 seconds (was 30 days)
  ['PetitionUpdateVariableCost', '1000000'],   // 1 tez (was 500 tez)
  ['PetitionVoteCost', '10000'],               // 0.01 tez (was 0.25 tez)
  ['PetitionUpdateVariableQuorum', '100'],     // 1% (was 40%)  — testable with 1 user
];

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(process.env.POLITICUS_PRIVATE_KEY));

const c = await tezos.contract.at(VARIABLES);
console.log(`Updating ${overrides.length} variables on ${VARIABLES}`);

const batch = tezos.contract.batch();
for (const [k, v] of overrides) {
  console.log(`  ${k} = ${v}`);
  batch.withContractCall(c.methodsObject.set({ 0: k, 1: v }));
}

const op = await batch.send();
console.log(`Batch op: ${op.hash}`);
await op.confirmation();
console.log('Done.');
