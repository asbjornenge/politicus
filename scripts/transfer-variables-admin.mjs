/**
 * IRREVERSIBLE: hand admin of Variables over to PetitionRegistry.
 *
 * After running this, the deployer can no longer call Variables.set or
 * Variables.set_admin directly. The only way for a kernel parameter to
 * change is for a petition to pass through PetitionRegistry.
 *
 * This is intentionally a separate, ceremonial step. Run with the flag
 * --i-understand-this-is-irreversible to actually execute.
 */
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const rpcUrl = process.env.POLITICUS_RPC_URL ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const network = process.env.POLITICUS_NETWORK ?? 'previewnet';
const deployments = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8'));
const net = deployments[network];

if (!net?.Variables || !net?.PetitionRegistry) {
  console.error('Need both Variables and PetitionRegistry in deployments.json.');
  process.exit(1);
}

const confirmed = process.argv.includes('--i-understand-this-is-irreversible');

console.log('---- Variables admin transfer ----');
console.log(`  Variables:        ${net.Variables}`);
console.log(`  Current admin:    you (${process.env.POLITICUS_ADDRESS})`);
console.log(`  New admin:        PetitionRegistry (${net.PetitionRegistry})`);
console.log();
console.log('After this completes, the "main" admin role moves to PetitionRegistry.');
console.log('You retain bootstrap_admin powers as long as total_users < BootstrapUserThreshold.');
console.log('Once the threshold is reached, only successful petitions can change kernel vars.');
console.log();

if (!confirmed) {
  console.log('To execute, re-run with: --i-understand-this-is-irreversible');
  process.exit(0);
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(process.env.POLITICUS_PRIVATE_KEY));
const c = await tezos.contract.at(net.Variables);
const op = await c.methodsObject.set_admin(net.PetitionRegistry).send();
console.log(`Op: ${op.hash}`);
await op.confirmation();
console.log('Admin transferred. Kernel is now community-controlled.');
