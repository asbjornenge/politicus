// Deploy EvmToMichelsonCounter on the Previewnet EVM runtime. Reads the
// Michelson KT1 from .env (POC_COUNTER_KT1) and stashes the EVM contract
// address back as POC_FORWARDER_EVM.

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
config({ path: join(repo, '.env') });

const { POC_EVM_RPC, POC_EVM_PRIVATE_KEY, POC_COUNTER_KT1 } = process.env;
if (!POC_EVM_RPC || !POC_EVM_PRIVATE_KEY) {
  console.error('Missing POC_EVM_RPC / POC_EVM_PRIVATE_KEY — run generate-evm-key first.');
  process.exit(1);
}
if (!POC_COUNTER_KT1) {
  console.error('Missing POC_COUNTER_KT1 — run deploy-michelson first.');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(POC_EVM_RPC);
const wallet = new ethers.Wallet(POC_EVM_PRIVATE_KEY, provider);
const balance = await provider.getBalance(wallet.address);
console.log(`Deployer: ${wallet.address}`);
console.log(`Balance:  ${ethers.formatEther(balance)} XTZ`);
if (balance === 0n) {
  console.error(`\nNo balance. Faucet ${wallet.address} at https://faucet.previewnet.tezosx.nomadic-labs.com`);
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(join(repo, 'artifacts/EvmToMichelsonCounter.json'), 'utf8'));
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

console.log(`\nDeploying EvmToMichelsonCounter(michelsonCounter="${POC_COUNTER_KT1}")…`);
const c = await factory.deploy(POC_COUNTER_KT1);
const tx = c.deploymentTransaction();
console.log(`  tx ${tx.hash}`);
await c.waitForDeployment();
const addr = await c.getAddress();
console.log(`  → ${addr}`);

const envPath = join(repo, '.env');
let body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
body = body.replace(/^POC_FORWARDER_EVM=.*\n?/m, '');
body += `\nPOC_FORWARDER_EVM=${addr}\n`;
writeFileSync(envPath, body);
console.log(`recorded POC_FORWARDER_EVM=${addr} in .env`);
