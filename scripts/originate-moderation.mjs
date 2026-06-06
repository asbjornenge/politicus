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
  console.error('Missing key/address in .env.');
  process.exit(1);
}

const artifactPath = join(repoRoot, 'artifacts/ModerationRegistry.json');
if (!existsSync(artifactPath)) {
  console.error('artifacts/ModerationRegistry.json missing. Run `npm run compile` first.');
  process.exit(1);
}
const code = JSON.parse(readFileSync(artifactPath, 'utf8'));

const network = process.env.POLITICUS_NETWORK ?? 'previewnet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

if (deployments[network]?.ModerationRegistry) {
  console.log(`ModerationRegistry already deployed at ${deployments[network].ModerationRegistry}.`);
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

console.log(`Originating ModerationRegistry`);
console.log(`  admin = ${POLITICUS_ADDRESS} (will transfer to PetitionRegistry later)`);

const op = await tezos.contract.originate({
  code,
  storage: {
    moderated_content: new MichelsonMap(),
    moderated_users: new MichelsonMap(),
    admin: POLITICUS_ADDRESS,
  },
});

console.log(`Origination op: ${op.hash}`);
await op.confirmation();
const addr = op.contractAddress;
console.log(`Originated at: ${addr}`);

deployments[network] = { ...(deployments[network] ?? {}), ModerationRegistry: addr };
writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
console.log(`Recorded in deployments.json`);
