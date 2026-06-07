// Surgical redeploy of BitDataStore + BitRegistryLogic only.
// Used to swap in the USDC-aware BRL (with payment_forwarders set)
// without going through a full Migrate_logic petition cycle.
//
// Leaves intact: VariablesLogic, PetitionLogic, ModerationRegistry,
// SyndicateRegistry, ProfileRegistry, IdentityRegistry, Treasury,
// BitNFTFactory. Only the bit-storage pair gets replaced.
//
// After this:
//   new BDS.admin     = new BRL
//   new BRL.governance = POLITICUS (kept here so add_payment_forwarder
//                        is callable without a petition. Migrate to
//                        PetitionLogic via set_governance when we want
//                        the kernel under community control again.)

import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const { POLITICUS_PRIVATE_KEY, POLITICUS_ADDRESS } = process.env;
const rpcUrl = process.env.POLITICUS_RPC_URL;
const network = process.env.POLITICUS_NETWORK ?? 'previewnet';

const deploymentsPath = join(repoRoot, 'deployments.json');
const deployments = JSON.parse(readFileSync(deploymentsPath, 'utf8'));
const net = deployments[network];

for (const r of ['IdentityRegistry', 'Treasury', 'VariablesLogic', 'SyndicateRegistry']) {
  if (!net[r]) { console.error(`Missing prerequisite: ${r}`); process.exit(1); }
}

const tezos = new TezosToolkit(rpcUrl);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(POLITICUS_PRIVATE_KEY));

function art(name) {
  return JSON.parse(readFileSync(join(repoRoot, `artifacts/${name}.json`), 'utf8'));
}

function persist(key, addr) {
  net[key] = addr;
  writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + '\n');
}

async function originate(label, code, storage) {
  console.log(`\n=== Originate ${label} ===`);
  const est = await tezos.estimate.originate({ code, storage });
  const op = await tezos.contract.originate({
    code, storage,
    fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
    gasLimit: Math.ceil(est.gasLimit * 1.3),
    storageLimit: Math.ceil(est.storageLimit * 1.3),
  });
  console.log(`  op ${op.hash}`);
  await op.confirmation();
  console.log(`  → ${op.contractAddress}`);
  return op.contractAddress;
}

// ---- 1. Fresh BitDataStore (POLITICUS as initial admin) ----
const BDS = await originate('BitDataStore', art('BitDataStore'), {
  bits: new MichelsonMap(),
  votes: new MichelsonMap(),
  admin: POLITICUS_ADDRESS,
});
persist('BitDataStore', BDS);

// ---- 2. Fresh BitRegistryLogic with payment_forwarders=[] ----
const BRL = await originate('BitRegistryLogic', art('BitRegistryLogic'), {
  data_store: BDS,
  identity_registry: net.IdentityRegistry,
  syndicate_registry: net.SyndicateRegistry,
  variables: net.VariablesLogic,
  treasury: net.Treasury,
  governance: POLITICUS_ADDRESS,
  payment_forwarders: [],
});
persist('BitRegistryLogic', BRL);

// ---- 3. BDS.set_admin(BRL) ----
console.log(`\n-- BDS.set_admin(BRL) --`);
const bds = await tezos.contract.at(BDS);
const call = bds.methodsObject.set_admin(BRL);
const est = await tezos.estimate.transfer(call.toTransferParams());
const op = await call.send({
  fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(est.gasLimit * 1.3),
  storageLimit: Math.ceil(est.storageLimit * 1.3),
});
console.log(`  op ${op.hash}`);
await op.confirmation();

console.log(`\nDone — update .env then restart api/indexer:`);
console.log(`BIT_DATA_STORE=${BDS}`);
console.log(`BIT_REGISTRY=${BRL}`);
