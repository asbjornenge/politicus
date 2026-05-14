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
const network = process.env.POLITICUS_NETWORK ?? 'shadownet';

if (!POLITICUS_PRIVATE_KEY || !POLITICUS_ADDRESS) {
  console.error('Missing key/address in .env.');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'artifacts/PetitionRegistry.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/PetitionRegistry.json missing. Run `npm run compile` first.');
  process.exit(1);
}
const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};
const net = deployments[network] ?? {};

for (const r of ['IdentityRegistry', 'Variables', 'Treasury']) {
  if (!net[r]) { console.error(`Missing prerequisite: ${r}`); process.exit(1); }
}

if (net.PetitionRegistry) {
  console.log(`PetitionRegistry already deployed at ${net.PetitionRegistry}.`);
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

console.log(`Originating PetitionRegistry`);
console.log(`  identity_registry = ${net.IdentityRegistry}`);
console.log(`  variables         = ${net.Variables}`);
console.log(`  treasury          = ${net.Treasury}`);

const op = await tezos.contract.originate({
  code,
  storage: {
    petitions: new MichelsonMap(),
    votes: new MichelsonMap(),
    next_petition_seq: 0,
    identity_registry: net.IdentityRegistry,
    variables: net.Variables,
    treasury: net.Treasury,
  },
});

console.log(`Origination op: ${op.hash}`);
await op.confirmation();
const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), PetitionRegistry: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
console.log();
console.log('Next: lower test thresholds (npm run setup-petition-test),');
console.log('then transfer Variables admin (npm run transfer-admin) — irreversible.');
