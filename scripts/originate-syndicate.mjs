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

const artifactPath = join(repoRoot, 'artifacts/SyndicateRegistry.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/SyndicateRegistry.json missing. Run `npm run compile` first.');
  process.exit(1);
}

const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const network = process.env.POLITICUS_NETWORK ?? 'shadownet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

const net = deployments[network] ?? {};
const required = ['IdentityRegistry', 'Variables', 'Treasury'];
for (const r of required) {
  if (!net[r]) {
    console.error(`Missing prerequisite: ${r} not deployed on ${network}. Originate it first.`);
    process.exit(1);
  }
}

if (net.SyndicateRegistry) {
  console.log(`SyndicateRegistry already deployed at ${net.SyndicateRegistry}.`);
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

console.log(`Originating SyndicateRegistry to ${rpcUrl}`);
console.log(`  identity_registry = ${net.IdentityRegistry}`);
console.log(`  variables         = ${net.Variables}`);
console.log(`  treasury          = ${net.Treasury}`);

const op = await tezos.contract.originate({
  code,
  storage: {
    syndicates: new MichelsonMap(),
    variables: net.Variables,
    treasury: net.Treasury,
    identity_registry: net.IdentityRegistry,
    total_syndicates: 0,
  },
});

console.log(`Origination op: ${op.hash}`);
console.log(`Waiting for confirmation...`);
await op.confirmation();

const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), SyndicateRegistry: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
console.log(`\nNext: set kernel variable SyndicateCreationCost via the Variables contract`);
console.log(`(use bootstrap admin or a petition). Suggested value: 5000000 mutez (5 ꜩ).`);
