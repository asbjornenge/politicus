// Deploys PoliticsBitForwarder (reuses MockUSDC from PoC #2) and adds
// its KT1 alias to the new BitRegistryLogic's payment_forwarders set.

import { ethers } from 'ethers';
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const repoRoot = join(repo, '..', '..');
config({ path: join(repoRoot, '.env') });
config({ path: join(repo, '.env'), override: false });

const env = process.env;
const envPath = join(repo, '.env');
const deps = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).previewnet;

function persist(key, value) {
  let body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  body = body.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
  body += `${key}=${value}\n`;
  writeFileSync(envPath, body);
}

const provider = new ethers.JsonRpcProvider(env.POC_EVM_RPC);
const wallet = new ethers.Wallet(env.POC_EVM_PRIVATE_KEY, provider);
const tezos = new TezosToolkit(env.POC_TEZOS_RPC ?? env.POLITICUS_RPC_URL);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));

// ---- Deploy PoliticsBitForwarder ----
const bfArt = JSON.parse(readFileSync(join(repo, 'artifacts/PoliticsBitForwarder.json'), 'utf8'));
console.log(`Deploying PoliticsBitForwarder(USDC=${env.POC_USDC}, BRL=${deps.BitRegistryLogic})…`);
const bf = await new ethers.ContractFactory(bfArt.abi, bfArt.bytecode, wallet).deploy(env.POC_USDC, deps.BitRegistryLogic);
await bf.waitForDeployment();
const bfAddr = await bf.getAddress();
console.log(`  → ${bfAddr}`);
persist('POC_BIT_FORWARDER_EVM', bfAddr);

// ---- Add to BRL.payment_forwarders ----
const forwarderAlias = await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(bfAddr)]);
console.log(`Forwarder KT1 alias: ${forwarderAlias}`);
persist('POC_BIT_FORWARDER_KT1', forwarderAlias);

const brl = await tezos.contract.at(deps.BitRegistryLogic);
const call = brl.methodsObject.add_payment_forwarder(forwarderAlias);
const est = await tezos.estimate.transfer(call.toTransferParams());
const op = await call.send({
  fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(est.gasLimit * 1.3),
  storageLimit: Math.ceil(est.storageLimit * 1.3),
});
console.log(`  add_payment_forwarder: ${op.hash}`);
await op.confirmation();

console.log(`\nDone. Forwarder ${bfAddr} (${forwarderAlias}) is allowlisted on BRL ${deps.BitRegistryLogic}.`);
