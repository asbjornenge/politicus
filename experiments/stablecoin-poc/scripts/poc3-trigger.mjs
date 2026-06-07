// End-to-end test of PoC #3:
//   - Upload a markdown bit to IPFS
//   - Approve USDC to PoliticsBitForwarder (idempotent)
//   - Call payAndCreateBit(amount, contentHash, payerKT1)
//   - Wait for indexer
//   - Verify the bit shows up in /api/bits, attributed to "evmuser"
//   - Print the user-visible URL on the Politicus feed

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addressToBytes22 } from './micheline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const repoRoot = join(repo, '..', '..');
config({ path: join(repoRoot, '.env') });
config({ path: join(repo, '.env'), override: false });

const env = process.env;

const provider = new ethers.JsonRpcProvider(env.POC_EVM_RPC);
const wallet = new ethers.Wallet(env.POC_EVM_PRIVATE_KEY, provider);

const ipfsUploadUrl = env.IPFS_UPLOAD_URL ?? 'http://internal.asbjornenge.com:5001';
const apiBase = 'https://politicus.coder.surflabs.no/api';

async function uploadIPFS(text) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(text, 'utf8')]), 'bit.md');
  const r = await fetch(`${ipfsUploadUrl}/api/v0/add`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`ipfs ${r.status}`);
  const lines = (await r.text()).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]).Hash;
}
function cidToBytes(cid) {
  return Buffer.from(cid, 'utf8');
}

// ---- Prepare ----
const userKT1 = await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(env.POC_EVM_ADDRESS)]);
const payerKT1Bytes = addressToBytes22(userKT1);
console.log(`User: ${env.POC_EVM_ADDRESS} ↦ ${userKT1}`);
console.log(`payerKT1Bytes: 0x${payerKT1Bytes.toString('hex')} (${payerKT1Bytes.length} bytes)`);

const content = `# Posted via cross-runtime USDC payment

This bit was created by an EVM user paying in mock USDC through a
Solidity escrow forwarder. The forwarder pulled the USDC and called
\`BitRegistryLogic.create_bit_via_forwarder\` via the Tezos X Native
Atomic Composability gateway.

The whole flow is atomic: if the Michelson side had reverted, the
USDC transfer would have been rolled back on the EVM side too.

PoC #3 — bit-payment-with-USDC integration.`;

console.log('\nUploading bit content to IPFS…');
const cid = await uploadIPFS(content);
console.log(`  CID: ${cid}`);

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const BF_ABI = [
  'function payAndCreateBit(uint256, bytes, bytes)',
  'function bitsForwarded() view returns (uint64)',
];
const usdc = new ethers.Contract(env.POC_USDC, USDC_ABI, wallet);
const bf = new ethers.Contract(env.POC_BIT_FORWARDER_EVM, BF_ABI, wallet);

const allowance = await usdc.allowance(env.POC_EVM_ADDRESS, env.POC_BIT_FORWARDER_EVM);
if (allowance < 10_000_000n) {
  console.log(`\nApproving forwarder for 10 USDC…`);
  await (await usdc.approve(env.POC_BIT_FORWARDER_EVM, 10_000_000n)).wait();
}

const usdcBefore = await usdc.balanceOf(env.POC_EVM_ADDRESS);
const fwdBefore = await usdc.balanceOf(env.POC_BIT_FORWARDER_EVM);
console.log(`\nPre-state: user ${ethers.formatUnits(usdcBefore, 6)} mUSDC, forwarder ${ethers.formatUnits(fwdBefore, 6)} mUSDC`);

// ---- Pay + create bit ----
const amount = 1_000_000n; // 1 USDC
const contentBytes = cidToBytes(cid);
console.log(`\nCalling payAndCreateBit(1 USDC, CID, payerKT1)…`);
const tx = await bf.payAndCreateBit(amount, contentBytes, payerKT1Bytes, { gasLimit: 5_000_000n });
console.log(`  tx ${tx.hash}`);
const rcpt = await tx.wait();
console.log(`  status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);

const usdcAfter = await usdc.balanceOf(env.POC_EVM_ADDRESS);
const fwdAfter = await usdc.balanceOf(env.POC_BIT_FORWARDER_EVM);
console.log(`Post-state: user ${ethers.formatUnits(usdcAfter, 6)} mUSDC, forwarder ${ethers.formatUnits(fwdAfter, 6)} mUSDC`);

// ---- Wait for indexer ----
console.log('\nWaiting up to 30s for indexer…');
let bit = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const r = await fetch(`${apiBase}/bits?limit=5`);
  const j = await r.json();
  bit = j.bits.find(b => b.content_hash === cid);
  if (bit) break;
  process.stdout.write('.');
}
console.log();

if (!bit) { console.error('Bit not found via API.'); process.exit(1); }
console.log('\nBit appeared in feed:');
console.log(`  bid             ${bit.bid}`);
console.log(`  creator         ${bit.creator}`);
console.log(`  creator_username ${bit.creator_username}`);
console.log(`  content_hash    ${bit.content_hash}`);
console.log(`  creation_time   ${bit.creation_time}`);

console.log(`\nVisit:`);
console.log(`  https://politicus.coder.surflabs.no/#/bit/${bit.bid}`);

const ok = bit.creator === userKT1 && bit.creator_username === 'evmuser';
console.log(`\n${ok ? '🎉 PoC #3 SUCCESS' : 'FAILED'} — USDC payment from EVM produced a Politicus bit attributed to ${bit.creator_username}.`);
process.exit(ok ? 0 : 1);
