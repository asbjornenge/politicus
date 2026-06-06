import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const { POLITICUS_PRIVATE_KEY, POLITICUS_ADDRESS } = process.env;
const rpcUrl = process.env.POLITICUS_RPC_URL ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com';

if (!POLITICUS_PRIVATE_KEY || !POLITICUS_ADDRESS) {
  console.error('Missing key/address in .env. Run `npm run generate-key` first.');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'artifacts/IdentityRegistry.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/IdentityRegistry.json missing. Run `npm run compile` first.');
  process.exit(1);
}

const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const network = process.env.POLITICUS_NETWORK ?? 'previewnet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

if (deployments[network]?.IdentityRegistry) {
  console.log(`IdentityRegistry already deployed at ${deployments[network].IdentityRegistry}.`);
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

console.log(`Originating IdentityRegistry to ${rpcUrl}`);

const storage = {
  users: new MichelsonMap(),
  brightid_used: new MichelsonMap(),
  total_users: 0,
};

const est = await tezos.estimate.originate({ code, storage });
const op = await tezos.contract.originate({
  code,
  storage,
  fee: Math.ceil(est.suggestedFeeMutez * 1.3),
  gasLimit: Math.ceil(est.gasLimit * 1.2),
  storageLimit: Math.ceil(est.storageLimit * 1.2),
});

console.log(`Origination op: ${op.hash}`);
console.log(`Waiting for confirmation...`);
await op.confirmation();

const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), IdentityRegistry: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
