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

const artifactPath = join(repoRoot, 'artifacts/ProfileRegistry.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/ProfileRegistry.json missing. Run `npm run compile` first.');
  process.exit(1);
}

const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const network = process.env.POLITICUS_NETWORK ?? 'shadownet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

const net = deployments[network] ?? {};
const required = ['IdentityRegistry', 'SyndicateRegistry'];
for (const r of required) {
  if (!net[r]) {
    console.error(`Missing prerequisite: ${r} not deployed on ${network}. Originate it first.`);
    process.exit(1);
  }
}

if (net.ProfileRegistry) {
  console.log(`ProfileRegistry already deployed at ${net.ProfileRegistry}.`);
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

console.log(`Originating ProfileRegistry to ${rpcUrl}`);
console.log(`  identity_registry  = ${net.IdentityRegistry}`);
console.log(`  syndicate_registry = ${net.SyndicateRegistry}`);

const op = await tezos.contract.originate({
  code,
  storage: {
    profiles: new MichelsonMap(),
    identity_registry: net.IdentityRegistry,
    syndicate_registry: net.SyndicateRegistry,
  },
});

console.log(`Origination op: ${op.hash}`);
console.log(`Waiting for confirmation...`);
await op.confirmation();

const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), ProfileRegistry: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
