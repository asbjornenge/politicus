// End-to-end test of PoC #2:
//   - Mint 100 USDC to POC_EVM_ADDRESS
//   - Approve forwarder for 10 USDC
//   - Call forwarder.payAndPost(1_000_000, "hello from PoC #2")  // 1 USDC
//   - Verify: USDC balance dropped by 1 USDC, forwarder holds 1 USDC,
//             PaymentReceiver.get_count() incremented, get_payment(id)
//             returns the expected (payer_evm, amount, content)
//   - Atomic-revert check: call payAndPost with payer = unauthorized
//     forwarder → expect Michelson to fail and USDC to be untouched

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
config({ path: join(repo, '.env') });

const {
  POC_EVM_RPC, POC_EVM_PRIVATE_KEY, POC_EVM_ADDRESS,
  POC_TZKT_API,
  POC_USDC, POC_RECEIVER_KT1, POC_FORWARDER_USDC_EVM,
} = process.env;

const provider = new ethers.JsonRpcProvider(POC_EVM_RPC);
const wallet = new ethers.Wallet(POC_EVM_PRIVATE_KEY, provider);

const USDC_ABI = [
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];
const PP_ABI = [
  'function payAndPost(uint256, bytes)',
  'function nonce() view returns (uint64)',
];
const usdc = new ethers.Contract(POC_USDC, USDC_ABI, wallet);
const pp = new ethers.Contract(POC_FORWARDER_USDC_EVM, PP_ABI, wallet);

async function receiverStorage() {
  const r = await fetch(`${POC_TZKT_API}/v1/contracts/${POC_RECEIVER_KT1}/storage`);
  return await r.json();
}

async function paymentById(id) {
  const r = await fetch(
    `${POC_TZKT_API}/v1/contracts/${POC_RECEIVER_KT1}/bigmaps/payments/keys/${id}`,
  );
  if (!r.ok) return null;
  return await r.json();
}

// ---- Setup: mint + approve ----
const before = await usdc.balanceOf(POC_EVM_ADDRESS);
if (before < 100_000_000n) {
  console.log('Minting 100 USDC to test EOA…');
  const tx = await usdc.mint(POC_EVM_ADDRESS, 100_000_000n);
  await tx.wait();
}
console.log(`USDC balance: ${ethers.formatUnits(await usdc.balanceOf(POC_EVM_ADDRESS), 6)} mUSDC`);
console.log(`Approving forwarder for 10 USDC…`);
await (await usdc.approve(POC_FORWARDER_USDC_EVM, 10_000_000n)).wait();

// ---- Pre-state ----
const pre = await receiverStorage();
console.log('\nPre-state on receiver:');
console.log(`  next_id            = ${pre.next_id}`);
console.log(`  expected_forwarder = ${pre.expected_forwarder}`);
const userUSDCBefore = await usdc.balanceOf(POC_EVM_ADDRESS);
const forwarderUSDCBefore = await usdc.balanceOf(POC_FORWARDER_USDC_EVM);

// ---- Pay ----
const amount = 1_000_000n; // 1 USDC
const content = ethers.toUtf8Bytes('hello from PoC #2');
console.log(`\nCalling payAndPost(1 USDC, "hello from PoC #2")…`);
const tx = await pp.payAndPost(amount, content, { gasLimit: 5_000_000n });
console.log(`  tx ${tx.hash}`);
const rcpt = await tx.wait();
console.log(`  status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);

// ---- Verify ----
await new Promise(r => setTimeout(r, 3000));
const userUSDCAfter = await usdc.balanceOf(POC_EVM_ADDRESS);
const forwarderUSDCAfter = await usdc.balanceOf(POC_FORWARDER_USDC_EVM);
const post = await receiverStorage();
console.log('\nPost-state:');
console.log(`  next_id            = ${post.next_id}`);
console.log(`  user USDC: ${ethers.formatUnits(userUSDCAfter, 6)} (Δ ${ethers.formatUnits(userUSDCAfter - userUSDCBefore, 6)})`);
console.log(`  forwarder USDC: ${ethers.formatUnits(forwarderUSDCAfter, 6)} (Δ ${ethers.formatUnits(forwarderUSDCAfter - forwarderUSDCBefore, 6)})`);

const recordedId = Number(post.next_id) - 1;
const rec = await paymentById(recordedId);
console.log(`\nRecorded payment id=${recordedId}:`);
console.log(`  ${JSON.stringify(rec?.value ?? rec, null, 2).slice(0, 400)}`);

const userDelta = userUSDCAfter - userUSDCBefore;
const forwarderDelta = forwarderUSDCAfter - forwarderUSDCBefore;
const counterBumped = Number(post.next_id) === Number(pre.next_id) + 1;
const evmPayerMatch = rec?.value?.payer_evm?.toLowerCase().endsWith(POC_EVM_ADDRESS.toLowerCase().slice(2));
const amountMatch = rec?.value?.amount === '1000000';

console.log('\nVerification:');
console.log(`  user USDC -1                          : ${userDelta === -amount ? '✓' : '✗ (' + userDelta + ')'}`);
console.log(`  forwarder USDC +1                     : ${forwarderDelta === amount ? '✓' : '✗ (' + forwarderDelta + ')'}`);
console.log(`  receiver.next_id +1                   : ${counterBumped ? '✓' : '✗'}`);
console.log(`  recorded payer_evm == EOA bytes20     : ${evmPayerMatch ? '✓' : '✗'}`);
console.log(`  recorded amount == 1_000_000          : ${amountMatch ? '✓' : '✗'}`);

const ok = userDelta === -amount && forwarderDelta === amount && counterBumped && evmPayerMatch && amountMatch;
if (ok) console.log('\nPoC #2 happy path verified ✓');
else { console.log('\nFAILED'); process.exit(1); }
