import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const { POLITICUS_PRIVATE_KEY, POLITICUS_ADDRESS } = process.env;
const rpcUrl = process.env.POLITICUS_RPC_URL ?? 'https://rpc.shadownet.teztnets.com';

if (!POLITICUS_PRIVATE_KEY || !POLITICUS_ADDRESS) {
  console.error('Missing key/address in .env. Run `npm run generate-key` first.');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'artifacts/Variables.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/Variables.json missing. Run `npm run compile` first.');
  process.exit(1);
}

const code = JSON.parse(readFileSync(artifactPath, 'utf8'));
const initial = JSON.parse(readFileSync(join(repoRoot, 'config/initial-variables.json'), 'utf8'));

const entries = Object.entries(initial).filter(([k]) => !k.startsWith('_'));
const network = process.env.POLITICUS_NETWORK ?? 'shadownet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

let addr = deployments[network]?.Variables;

if (addr) {
  console.log(`Variables already deployed at ${addr} (from deployments.json). Skipping origination.`);
} else {
  console.log(`Originating Variables to ${rpcUrl}`);
  console.log(`  admin = ${POLITICUS_ADDRESS}`);
  const op = await tezos.contract.originate({
    code,
    storage: {
      values: new MichelsonMap(),
      admin: POLITICUS_ADDRESS,
    },
  });
  console.log(`Origination op: ${op.hash}`);
  console.log(`Waiting for confirmation...`);
  await op.confirmation();
  addr = op.contractAddress;
  console.log(`Originated at: ${addr}`);

  deployments[network] = { ...(deployments[network] ?? {}), Variables: addr };
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
  console.log(`Recorded in deployments.json under "${network}"`);
}

console.log(`Populating ${entries.length} variables via batch...`);
const contract = await tezos.contract.at(addr);
const batch = tezos.contract.batch();
for (const [k, v] of entries) {
  batch.withContractCall(contract.methodsObject.set({ 0: k, 1: v }));
}
const setOp = await batch.send();
console.log(`Batch op: ${setOp.hash}`);
await setOp.confirmation();
console.log(`All variables set.`);
