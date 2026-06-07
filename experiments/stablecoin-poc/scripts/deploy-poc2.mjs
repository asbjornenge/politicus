// Deploys PoC #2:
//   1. MockUSDC on EVM (admin = POC_EVM_ADDRESS)
//   2. PaymentReceiver on Michelson (admin = POLITICUS, forwarder = POLITICUS for now)
//   3. PoliticsPayments on EVM (constructor takes USDC + receiver KT1)
//   4. PaymentReceiver.set_forwarder(forwarder_kt1_alias)
//
// All addresses persist into the same .env the PoC #1 deploy writes to.

import { ethers } from 'ethers';
import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
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
  let body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  body = body.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
  body += `${key}=${value}\n`;
  writeFileSync(envPath, body);
}

// ---- Init providers ----
const provider = new ethers.JsonRpcProvider(env.POC_EVM_RPC);
const wallet = new ethers.Wallet(env.POC_EVM_PRIVATE_KEY, provider);
const tezos = new TezosToolkit(env.POC_TEZOS_RPC ?? env.POLITICUS_RPC_URL);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));

console.log(`EVM deployer: ${wallet.address} — ${ethers.formatEther(await provider.getBalance(wallet.address))} XTZ`);
console.log(`Tezos signer: ${env.POLITICUS_ADDRESS}`);

// ---- 1. Deploy MockUSDC ----
const usdcArt = JSON.parse(readFileSync(join(repo, 'artifacts/MockUSDC.json'), 'utf8'));
console.log('\n[1/4] Deploying MockUSDC…');
const usdc = await new ethers.ContractFactory(usdcArt.abi, usdcArt.bytecode, wallet).deploy();
await usdc.waitForDeployment();
const usdcAddr = await usdc.getAddress();
console.log(`  → ${usdcAddr}`);
persist('POC_USDC', usdcAddr);

// ---- 2. Originate PaymentReceiver ----
const receiverCode = JSON.parse(readFileSync(join(repo, 'artifacts/PaymentReceiver.json'), 'utf8'));
const code = Array.isArray(receiverCode) ? receiverCode : receiverCode.michelson ?? receiverCode;
const initStorage = {
  expected_forwarder: env.POLITICUS_ADDRESS, // placeholder; updated below
  payments: new MichelsonMap(),
  by_payer: new MichelsonMap(),
  next_id: 0,
  admin: env.POLITICUS_ADDRESS,
};
console.log('\n[2/4] Originating PaymentReceiver…');
const est = await tezos.estimate.originate({ code, storage: initStorage });
const op = await tezos.contract.originate({
  code,
  storage: initStorage,
  fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(est.gasLimit * 1.3),
  storageLimit: Math.ceil(est.storageLimit * 1.3),
});
await op.confirmation();
const receiverKT1 = op.contractAddress;
console.log(`  → ${receiverKT1}`);
persist('POC_RECEIVER_KT1', receiverKT1);

// ---- 3. Deploy PoliticsPayments ----
const ppArt = JSON.parse(readFileSync(join(repo, 'artifacts/PoliticsPayments.json'), 'utf8'));
console.log('\n[3/4] Deploying PoliticsPayments…');
const pp = await new ethers.ContractFactory(ppArt.abi, ppArt.bytecode, wallet).deploy(usdcAddr, receiverKT1);
await pp.waitForDeployment();
const ppAddr = await pp.getAddress();
console.log(`  → ${ppAddr}`);
persist('POC_FORWARDER_USDC_EVM', ppAddr);

// ---- 4. Derive forwarder KT1 alias and set on receiver ----
const forwarderAlias = await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(ppAddr)]);
console.log(`\n[4/4] Setting expected_forwarder = ${forwarderAlias}`);
const receiver = await tezos.contract.at(receiverKT1);
const setOpParams = receiver.methodsObject.set_forwarder(forwarderAlias).toTransferParams();
const setEst = await tezos.estimate.transfer(setOpParams);
const setOp = await receiver.methodsObject.set_forwarder(forwarderAlias).send({
  fee: Math.max(2000, Math.ceil(setEst.suggestedFeeMutez * 2)),
  gasLimit: Math.ceil(setEst.gasLimit * 1.3),
  storageLimit: Math.ceil(setEst.storageLimit * 1.3),
});
await setOp.confirmation();
console.log(`  set_forwarder: ${setOp.hash}`);

console.log('\nDone:');
console.log(`  USDC (EVM)             ${usdcAddr}`);
console.log(`  PaymentReceiver (KT1)  ${receiverKT1}`);
console.log(`  PoliticsPayments (EVM) ${ppAddr}`);
console.log(`  Forwarder KT1 alias    ${forwarderAlias}`);
