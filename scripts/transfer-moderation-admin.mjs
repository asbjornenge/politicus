/**
 * Hand admin of ModerationRegistry over to PetitionRegistry. After this,
 * only successful Mod_/Rem_ petitions can mutate the moderation state.
 *
 * Less ceremonial than the Variables transfer — there is no bootstrap_admin
 * fallback for ModerationRegistry — so this is required for the
 * petition-driven moderation loop to work at all.
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
const net = deployments[network];

if (!net?.ModerationRegistry || !net?.PetitionRegistry) {
  console.error('Need both ModerationRegistry and PetitionRegistry in deployments.json.');
  process.exit(1);
}

console.log('---- ModerationRegistry admin transfer ----');
console.log(`  ModerationRegistry: ${net.ModerationRegistry}`);
console.log(`  New admin (PR):     ${net.PetitionRegistry}`);

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(process.env.POLITICUS_PRIVATE_KEY));
const c = await tezos.contract.at(net.ModerationRegistry);
const op = await c.methodsObject.set_admin(net.PetitionRegistry).send();
console.log(`Op: ${op.hash}`);
await op.confirmation();
console.log('Done. Only resolved Mod_/Rem_ petitions can mutate moderation now.');
