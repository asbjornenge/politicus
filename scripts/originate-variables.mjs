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

const values = new MichelsonMap();
for (const [k, v] of Object.entries(initial)) {
  if (k.startsWith('_')) continue;
  values.set(k, v);
}

console.log(`Originating Variables to ${rpcUrl}`);
console.log(`  admin = ${POLITICUS_ADDRESS}`);
console.log(`  ${values.size} variables loaded from config/initial-variables.json`);

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

const op = await tezos.contract.originate({
  code,
  storage: {
    values,
    admin: POLITICUS_ADDRESS,
  },
});

console.log(`Origination op: ${op.hash}`);
console.log(`Waiting for confirmation...`);
await op.confirmation();

const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};
const network = process.env.POLITICUS_NETWORK ?? 'shadownet';
deployments[network] = { ...(deployments[network] ?? {}), Variables: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
