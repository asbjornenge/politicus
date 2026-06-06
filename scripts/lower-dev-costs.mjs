// One-shot: lower kernel costs while POLITICUS is still bootstrap_admin
// (total_users < BootstrapUserThreshold). Makes Previewnet dev iteration
// cheap so we don't burn the limited 10-XTZ-per-captcha faucet budget.
//
// Reverse to realistic values via Set_variable petitions when ready.

import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const deps = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).previewnet;
const tezos = new TezosToolkit(process.env.POLITICUS_RPC_URL);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(process.env.POLITICUS_PRIVATE_KEY));

const overrides = {
  BitCost: 1000,
  BitVoteCost: 1000,
  SyndicateCreationCost: 1000,
  PetitionVoteCost: 1000,
};

const vl = await tezos.contract.at(deps.VariablesLogic);
for (const [k, v] of Object.entries(overrides)) {
  const call = vl.methodsObject.set({ 0: k, 1: v });
  const est = await tezos.estimate.transfer(call.toTransferParams());
  const op = await call.send({
    fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
    gasLimit: Math.ceil(est.gasLimit * 1.3),
    storageLimit: Math.ceil(est.storageLimit * 1.3),
  });
  console.log(`set ${k}=${v}: ${op.hash}`);
  await op.confirmation();
}

console.log('done.');
