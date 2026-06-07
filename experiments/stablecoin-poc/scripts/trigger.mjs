// Trigger forwarder.increment() from the EVM side and verify:
//   - Michelson Counter.counter incremented
//   - Counter.last_sender = the forwarder's KT1 alias (NOT the EVM EOA's)
//   - The KT1 alias matches what tez_getEthereumTezosAddress derives
//     from the forwarder's 0x address
//
// This is the punchline of the PoC: it confirms the identity model the
// Tezos devs described — get_sender() returns the immediate caller's
// Tezos alias, so any forwarder pattern must pass user identity as an
// explicit parameter.

import { ethers } from 'ethers';
import { TezosToolkit } from '@taquito/taquito';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
config({ path: join(repo, '.env') });

const {
  POC_EVM_RPC, POC_EVM_PRIVATE_KEY, POC_EVM_ADDRESS,
  POC_TEZOS_RPC, POC_TZKT_API,
  POC_FORWARDER_EVM, POC_COUNTER_KT1,
} = process.env;

if (!POC_FORWARDER_EVM || !POC_COUNTER_KT1) {
  console.error('Missing POC_FORWARDER_EVM / POC_COUNTER_KT1 — run deploy scripts first.');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(POC_EVM_RPC);
const wallet = new ethers.Wallet(POC_EVM_PRIVATE_KEY, provider);
const tezos = new TezosToolkit(POC_TEZOS_RPC);

async function counterStorage() {
  const r = await fetch(`${POC_TZKT_API}/v1/contracts/${POC_COUNTER_KT1}/storage`);
  return await r.json();
}

async function aliasOf(evmAddr) {
  return await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(evmAddr)]);
}

// ---- 1. Snapshot pre-state ----
const before = await counterStorage();
const userAlias = await aliasOf(POC_EVM_ADDRESS);
const forwarderAlias = await aliasOf(POC_FORWARDER_EVM);
console.log('Pre-state:');
console.log(`  counter            = ${before.counter}`);
console.log(`  last_sender        = ${before.last_sender ?? '<none>'}`);
console.log(`  EOA  ${POC_EVM_ADDRESS} ↦ ${userAlias}`);
console.log(`  forw ${POC_FORWARDER_EVM} ↦ ${forwarderAlias}`);

// ---- 2. Send forwarder.increment() ----
const ABI = ['function increment() external', 'function callCount() view returns (uint256)'];
const forwarder = new ethers.Contract(POC_FORWARDER_EVM, ABI, wallet);

console.log('\nSending forwarder.increment()…');
const tx = await forwarder.increment({ gasLimit: 5_000_000n });
console.log(`  tx ${tx.hash}`);
const rcpt = await tx.wait();
console.log(`  status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);

// ---- 3. Verify post-state ----
await new Promise(r => setTimeout(r, 3000));
const after = await counterStorage();
const callCount = await forwarder.callCount();
console.log('\nPost-state:');
console.log(`  counter            = ${after.counter}`);
console.log(`  last_sender        = ${after.last_sender ?? '<none>'}`);
console.log(`  forwarder.callCount = ${callCount}`);

// ---- 4. Punchline ----
console.log('\nVerification:');
const counterBumped = Number(after.counter) === Number(before.counter) + 1;
const senderIsForwarder = after.last_sender === forwarderAlias;
const senderIsNotUser = after.last_sender !== userAlias;
console.log(`  counter +1                            : ${counterBumped ? '✓' : '✗'}`);
console.log(`  last_sender == forwarder KT1 alias    : ${senderIsForwarder ? '✓' : '✗'}`);
console.log(`  last_sender != EOA KT1 alias          : ${senderIsNotUser ? '✓' : '✗'}`);

if (counterBumped && senderIsForwarder && senderIsNotUser) {
  console.log('\nPoC succeeded — atomic cross-runtime call landed and identity model behaves as documented.');
  process.exit(0);
} else {
  console.log('\nPoC FAILED — see above.');
  process.exit(1);
}
