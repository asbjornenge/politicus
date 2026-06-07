// Register the PoC EVM user in IdentityRegistry via direct EVM-to-Michelson
// call (Pattern B). The user sends a tx to the NAC gateway from MetaMask;
// inside Michelson, Tezos.get_sender() is the user's KT1 alias (derived
// automatically by Tezos X), so the registration lands under the right
// identity without us having to pass any address explicitly.

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { encString, encBytes, encPair } from './micheline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const repoRoot = join(repo, '..', '..');
config({ path: join(repoRoot, '.env') });
config({ path: join(repo, '.env'), override: false });

const env = process.env;
const deps = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).previewnet;

const provider = new ethers.JsonRpcProvider(env.POC_EVM_RPC);
const wallet = new ethers.Wallet(env.POC_EVM_PRIVATE_KEY, provider);

const username = process.argv[2] ?? 'evmuser';
const bio = process.argv[3] ?? 'PoC user paying bits in USDC';

const userKT1 = await provider.send('tez_getEthereumTezosAddress', [ethers.getAddress(env.POC_EVM_ADDRESS)]);
console.log(`EVM EOA:    ${env.POC_EVM_ADDRESS}`);
console.log(`Derived KT1: ${userKT1}`);
console.log(`Username:   ${username}`);

const brightid = crypto.createHash('sha256').update(`politicus-placeholder-${userKT1}`).digest();

// IdentityRegistry.register signature: (bytes brightid, string username, string bio)
// Michelson value: Pair brightid (Pair username bio)
const payload = encPair(encBytes(brightid), encString(username), encString(bio));

const GATEWAY = '0xfF00000000000000000000000000000000000007';
const gateway = new ethers.Contract(GATEWAY, [
  'function callMichelson(string,string,bytes) payable',
], wallet);

console.log(`\nCalling gateway → IdentityRegistry.register…`);
const tx = await gateway.callMichelson(deps.IdentityRegistry, 'register', payload, {
  gasLimit: 5_000_000n,
});
console.log(`  tx ${tx.hash}`);
const rcpt = await tx.wait();
console.log(`  status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);

// Verify via TzKT
await new Promise(r => setTimeout(r, 3000));
const url = `${env.POC_TZKT_API}/v1/contracts/${deps.IdentityRegistry}/bigmaps/users/keys/${userKT1}`;
const r = await fetch(url);
if (r.ok) {
  const u = await r.json();
  console.log(`\nRegistered:`);
  console.log(`  username = ${u.value?.username}`);
  console.log(`  bio      = ${u.value?.bio}`);
} else {
  console.log(`\nWarning: ${url} → ${r.status} (may still be propagating)`);
}
