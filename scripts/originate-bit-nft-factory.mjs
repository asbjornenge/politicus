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
const network = process.env.POLITICUS_NETWORK ?? 'previewnet';

if (!POLITICUS_PRIVATE_KEY || !POLITICUS_ADDRESS) {
  console.error('Missing key/address in .env');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'artifacts/BitNFTFactory.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/BitNFTFactory.json missing. Run `npm run compile` first.');
  process.exit(1);
}

const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

const synd = deployments[network]?.SyndicateRegistry;
if (!synd) {
  console.error(`Missing SyndicateRegistry in deployments.${network} — run governance-reset first.`);
  process.exit(1);
}

if (deployments[network]?.BitNFTFactory) {
  console.log(`BitNFTFactory already deployed at ${deployments[network].BitNFTFactory}.`);
  process.exit(0);
}

const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

const storage = {
  collections: new MichelsonMap(),
  syndicate_registry: synd,
  total_collections: 0,
};

console.log(`Originating BitNFTFactory to ${rpcUrl}`);
console.log(`  syndicate_registry = ${synd}`);

const est = await tezos.estimate.originate({ code, storage });
const op = await tezos.contract.originate({
  code,
  storage,
  fee: Math.ceil(est.suggestedFeeMutez * 1.3),
  gasLimit: Math.ceil(est.gasLimit * 1.2),
  storageLimit: Math.ceil(est.storageLimit * 1.2),
});
console.log(`Origination op: ${op.hash}`);
await op.confirmation();
const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), BitNFTFactory: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json under "${network}"`);
