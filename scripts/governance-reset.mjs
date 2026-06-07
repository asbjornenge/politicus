// One-shot orchestrator that brings the kernel up on the new
// storage/logic + governance architecture.
//
// Preserves: IdentityRegistry, Treasury (data + balance).
// Replaces: Variables, PetitionRegistry, BitRegistry, SyndicateRegistry,
// ProfileRegistry, ModerationRegistry.
//
// After this script:
//   - VariablesDataStore.admin = VariablesLogic
//   - PetitionDataStore.admin = PetitionLogic
//   - BitDataStore.admin = BitRegistryLogic
//   - ModerationRegistry.admin = PetitionLogic
//   - VariablesLogic.admin = PetitionLogic (Set_variable petitions can write)
//   - bootstrap_admin on VariablesLogic still POLITICUS (until total_users >= threshold)
//   - governance on all three Logic contracts = PetitionLogic
//
// From here, every future Logic-contract upgrade goes through a
// Migrate_logic petition.

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
  console.error('Missing key/address in .env');
  process.exit(1);
}

const network = process.env.POLITICUS_NETWORK ?? 'previewnet';
const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, 'utf8'))
  : {};

const net = deployments[network] ?? {};
for (const r of ['IdentityRegistry', 'Treasury']) {
  if (!net[r]) { console.error(`Missing prerequisite: ${r}`); process.exit(1); }
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

function art(name) {
  const p = join(repoRoot, `artifacts/${name}.json`);
  if (!existsSync(p)) { console.error(`Missing ${p}; run npm run compile`); process.exit(1); }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function persist(key, addr) {
  deployments[network] = { ...(deployments[network] ?? {}), [key]: addr };
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
}

async function originate(label, code, storage) {
  console.log(`\n=== Originate ${label} ===`);
  const est = await tezos.estimate.originate({ code, storage });
  const op = await tezos.contract.originate({
    code,
    storage,
    fee: Math.ceil(est.suggestedFeeMutez * 1.3),
    gasLimit: Math.ceil(est.gasLimit * 1.2),
    storageLimit: Math.ceil(est.storageLimit * 1.2),
  });
  console.log(`  op ${op.hash}`);
  await op.confirmation();
  console.log(`  → ${op.contractAddress}`);
  return op.contractAddress;
}

async function call(label, target, method, args) {
  console.log(`-- ${label}`);
  const c = await tezos.contract.at(target);
  const params = args === undefined
    ? c.methodsObject[method]().toTransferParams()
    : c.methodsObject[method](args).toTransferParams();
  const est = await tezos.estimate.transfer(params);
  const send = args === undefined
    ? c.methodsObject[method]().send({
        fee: Math.ceil(est.suggestedFeeMutez * 1.3),
        gasLimit: Math.ceil(est.gasLimit * 1.2),
        storageLimit: Math.ceil(est.storageLimit * 1.2),
      })
    : c.methodsObject[method](args).send({
        fee: Math.ceil(est.suggestedFeeMutez * 1.3),
        gasLimit: Math.ceil(est.gasLimit * 1.2),
        storageLimit: Math.ceil(est.storageLimit * 1.2),
      });
  const op = await send;
  console.log(`  op ${op.hash}`);
  await op.confirmation();
}

// 1. VariablesDataStore
const VDS = await originate('VariablesDataStore', art('VariablesDataStore'), {
  values: new MichelsonMap(),
  admin: POLITICUS_ADDRESS,
});
persist('VariablesDataStore', VDS);

// 2. VariablesLogic
const VLogic = await originate('VariablesLogic', art('VariablesLogic'), {
  data_store: VDS,
  admin: POLITICUS_ADDRESS,
  bootstrap_admin: POLITICUS_ADDRESS,
  identity_registry: net.IdentityRegistry,
  governance: POLITICUS_ADDRESS,
});
persist('VariablesLogic', VLogic);

// 3. Transfer VDS admin to VLogic
await call('VDS.set_admin(VLogic)', VDS, 'set_admin', VLogic);

// 4. Seed kernel variables
const initial = JSON.parse(readFileSync(join(repoRoot, 'config/initial-variables.json'), 'utf8'));
const entries = Object.entries(initial).filter(([k]) => !k.startsWith('_'));
console.log(`\n-- Seeding ${entries.length} kernel variables via VariablesLogic`);
const vlContract = await tezos.contract.at(VLogic);
const batch = tezos.contract.batch();
for (const [k, v] of entries) batch.withContractCall(vlContract.methodsObject.set({ 0: k, 1: v }));
const seedOp = await batch.send();
console.log(`  op ${seedOp.hash}`);
await seedOp.confirmation();
console.log(`  ${entries.length} variables set`);

// 5. ModerationRegistry (fresh)
const Mod = await originate('ModerationRegistry', art('ModerationRegistry'), {
  moderated_content: new MichelsonMap(),
  moderated_users: new MichelsonMap(),
  admin: POLITICUS_ADDRESS,
});
persist('ModerationRegistry', Mod);

// 6. PetitionDataStore
const PDS = await originate('PetitionDataStore', art('PetitionDataStore'), {
  petitions: new MichelsonMap(),
  votes: new MichelsonMap(),
  next_petition_seq: 0,
  admin: POLITICUS_ADDRESS,
});
persist('PetitionDataStore', PDS);

// 7. PetitionLogic
const PLogic = await originate('PetitionLogic', art('PetitionLogic'), {
  data_store: PDS,
  identity_registry: net.IdentityRegistry,
  variables: VLogic,
  treasury: net.Treasury,
  moderation_registry: Mod,
  governance: POLITICUS_ADDRESS,
});
persist('PetitionLogic', PLogic);

// 8. PDS admin → PLogic
await call('PDS.set_admin(PLogic)', PDS, 'set_admin', PLogic);

// 9. Mod admin → PLogic
await call('Mod.set_admin(PLogic)', Mod, 'set_admin', PLogic);

// 10. VLogic admin → PLogic (Set_variable petitions can now write)
await call('VLogic.set_admin(PLogic)', VLogic, 'set_admin', PLogic);

// 11. SyndicateRegistry (fresh)
const Synd = await originate('SyndicateRegistry', art('SyndicateRegistry'), {
  syndicates: new MichelsonMap(),
  variables: VLogic,
  treasury: net.Treasury,
  identity_registry: net.IdentityRegistry,
  total_syndicates: 0,
});
persist('SyndicateRegistry', Synd);

// 12. BitDataStore (fresh)
const BDS = await originate('BitDataStore', art('BitDataStore'), {
  bits: new MichelsonMap(),
  votes: new MichelsonMap(),
  admin: POLITICUS_ADDRESS,
});
persist('BitDataStore', BDS);

// 13. BitRegistryLogic
const BitLogic = await originate('BitRegistryLogic', art('BitRegistryLogic'), {
  data_store: BDS,
  identity_registry: net.IdentityRegistry,
  syndicate_registry: Synd,
  variables: VLogic,
  treasury: net.Treasury,
  governance: POLITICUS_ADDRESS,
  payment_forwarders: [],
});
persist('BitRegistryLogic', BitLogic);

// 14. BDS admin → BitLogic
await call('BDS.set_admin(BitLogic)', BDS, 'set_admin', BitLogic);

// 15. ProfileRegistry (fresh)
const Prof = await originate('ProfileRegistry', art('ProfileRegistry'), {
  profiles: new MichelsonMap(),
  identity_registry: net.IdentityRegistry,
  syndicate_registry: Synd,
});
persist('ProfileRegistry', Prof);

// 16. Set governance = PLogic on all three Logic contracts
await call('VLogic.set_governance(PLogic)', VLogic, 'set_governance', PLogic);
await call('BitLogic.set_governance(PLogic)', BitLogic, 'set_governance', BitLogic === PLogic ? BitLogic : PLogic);
// For PLogic, governance starts as POLITICUS. Transfer to self so future
// migrations are community-driven via Migrate_logic petitions.
await call('PLogic.set_governance(PLogic)', PLogic, 'set_governance', PLogic);

console.log(`\n=== Done. Update .env: ===`);
console.log(`VARIABLES_ADDRESS=${VLogic}          # was: VariablesLogic`);
console.log(`VARIABLES_DATA_STORE=${VDS}`);
console.log(`PETITION_REGISTRY=${PLogic}          # was: PetitionLogic`);
console.log(`PETITION_DATA_STORE=${PDS}`);
console.log(`BIT_REGISTRY=${BitLogic}             # was: BitRegistryLogic`);
console.log(`BIT_DATA_STORE=${BDS}`);
console.log(`MODERATION_REGISTRY=${Mod}`);
console.log(`SYNDICATE_REGISTRY=${Synd}`);
console.log(`PROFILE_REGISTRY=${Prof}`);
console.log(`\nThen rebuild api + indexer and clear bits/petitions/votes/syndicates/profiles/moderation tables.`);
