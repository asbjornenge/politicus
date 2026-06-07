// Redeploy just PoliticsPayments and re-point the existing receiver at
// the new forwarder's KT1 alias. Use this when only the forwarder
// bytecode changed (e.g. encoder fix).

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

function persist(key, value) {
  let body = readFileSync(envPath, 'utf8');
  body = body.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
  body += `${key}=${value}\n`;
  writeFileSync(envPath, body);
}

const provider = new ethers.JsonRpcProvider(env.POC_EVM_RPC);
const wallet = new ethers.Wallet(env.POC_EVM_PRIVATE_KEY, provider);
const tezos = new TezosToolkit(env.POC_TEZOS_RPC ?? env.POLITICUS_RPC_URL);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));

const ppArt = JSON.parse(readFileSync(join(repo, 'artifacts/PoliticsPayments.json'), 'utf8'));
console.log('Deploying new PoliticsPayments…');
const pp = await new ethers.ContractFactory(ppArt.abi, ppArt.bytecode, wallet).deploy(
  env.POC_USDC, env.POC_RECEIVER_KT1,
);
await pp.waitForDeployment();
const ppAddr = await pp.getAddress();
console.log(`  → ${ppAddr}`);
persist('POC_FORWARDER_USDC_EVM', ppAddr);

const forwarderAlias = await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(ppAddr)]);
console.log(`Setting expected_forwarder = ${forwarderAlias} on ${env.POC_RECEIVER_KT1}`);
const receiver = await tezos.contract.at(env.POC_RECEIVER_KT1);
const call = receiver.methodsObject.set_forwarder(forwarderAlias);
const est = await tezos.estimate.transfer(call.toTransferParams());
const op = await call.send({
  fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(est.gasLimit * 1.3),
  storageLimit: Math.ceil(est.storageLimit * 1.3),
});
await op.confirmation();
console.log(`  ${op.hash}`);
console.log('Done.');
