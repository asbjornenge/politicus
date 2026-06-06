// Adds image-laden bits + simulated voting to the testnet.
// Generates 5 new accounts that act as both authors (some posts) and
// voters (varied weighted random across all bits in the past 14 days).

import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const env = process.env;
const rpcUrl = env.POLITICUS_RPC_URL ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const ipfsUploadUrl = env.IPFS_UPLOAD_URL ?? 'http://internal.asbjornenge.com:5001';
const tzkt = env.TZKT_API ?? 'https://api.previewnet.tezosx.tzkt.io';
const deps = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).previewnet;

async function uploadIPFS(text) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(text, 'utf8')]), 'bit.txt');
  const r = await fetch(`${ipfsUploadUrl}/api/v0/add`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`ipfs ${r.status}`);
  const lines = (await r.text()).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]).Hash;
}
function cidToHex(cid) {
  return Array.from(new TextEncoder().encode(cid))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function brightIdFor(addr) {
  return crypto.createHash('sha256').update(`politicus-placeholder-${addr}`).digest('hex');
}
async function newSigner() {
  const seed = new Uint8Array(32); crypto.randomFillSync(seed);
  const sk = b58Encode(seed, PrefixV2.Ed25519Seed);
  const signer = await InMemorySigner.fromSecretKey(sk);
  return { sk, address: await signer.publicKeyHash(), signer };
}
async function readVar(_varContract, key, fallback) {
  try {
    const r = await fetch(`${tzkt}/v1/contracts/${deps.VariablesDataStore}/bigmaps/values/keys/${key}`);
    if (!r.ok) return fallback;
    const j = await r.json();
    const n = Number(j?.value);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

function bumped(est) {
  return {
    fee: Math.max(2000, Math.ceil(est.suggestedFeeMutez * 2)),
    gasLimit: Math.ceil(est.gasLimit * 1.3),
    storageLimit: Math.ceil(est.storageLimit * 1.3),
  };
}
async function sendBumped(tezos, methodCall, extra = {}) {
  const params = { ...methodCall.toTransferParams(), ...extra };
  const est = await tezos.estimate.transfer(params);
  return methodCall.send({ ...extra, ...bumped(est) });
}
async function transferBumped(tezos, transferParams) {
  const est = await tezos.estimate.transfer(transferParams);
  return tezos.contract.transfer({ ...transferParams, ...bumped(est) });
}
async function resolveBitLogic() {
  const r = await fetch(`${tzkt}/v1/contracts/${deps.BitDataStore}/storage`);
  return (await r.json()).admin;
}

const boot = new TezosToolkit(rpcUrl);
boot.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));
const varContract = await boot.contract.at(deps.VariablesLogic);
const bitLogicAddr = await resolveBitLogic();
const bitCost = await readVar(varContract, 'BitCost', 1000000);
const bitVoteCost = await readVar(varContract, 'BitVoteCost', 1000000);
console.log(`bit-logic: ${bitLogicAddr}, BitCost: ${bitCost}, BitVoteCost: ${bitVoteCost}`);

// --- 1. Five extra contributors ---

const NAMES = ['eira', 'sven', 'marta', 'jonas', 'henrik'];
console.log('\nGenerating contributors…');
const writers = {};
for (const name of NAMES) {
  const k = await newSigner();
  writers[name] = k;
  console.log(`  ${name}: ${k.address}`);
}

console.log('Funding (0.5 ꜩ each — Previewnet dev mode)…');
for (const [name, k] of Object.entries(writers)) {
  const op = await transferBumped(boot, { to: k.address, amount: 500000, mutez: true });
  await op.confirmation();
  console.log(`  ${name}: ${op.hash}`);
}

console.log('Registering…');
for (const [name, k] of Object.entries(writers)) {
  const t = new TezosToolkit(rpcUrl);
  t.setSignerProvider(k.signer);
  const c = await t.contract.at(deps.IdentityRegistry);
  try {
    const op = await sendBumped(t, c.methodsObject.register({
      0: brightIdFor(k.address), 1: name, 2: '',
    }));
    await op.confirmation();
    console.log(`  ${name}: ${op.hash}`);
    writers[name].tezos = t;
  } catch (e) {
    if (String(e).includes('ALREADY_REGISTERED')) { writers[name].tezos = t; console.log(`  ${name}: already registered`); }
    else throw e;
  }
}

// --- 2. Image-laden bits ---

function pic(seed) {
  return `https://picsum.photos/seed/${seed}/1200/720`;
}

const newBits = [
  { who: 'eira', content: `![](${pic('cathedral-restoration')})\n\n# Cathedral restoration in Bergen completes phase one\n\nThe long-running restoration of Bergen's wooden churches has finished its first phase, with the smallest of the trio reopened to visitors this week. The story isn't the woodwork — it's the apprentice programme that trained sixty craftspeople in techniques that were nearly lost. The local trade council is already in talks with three counties about repeating the model.` },
  { who: 'sven', content: `![](${pic('arctic-mooring')})\n\n# Mooring the Arctic: a quietly significant rig deal\n\nA Norwegian-Faroese consortium has agreed terms for shared infrastructure in the high-Arctic shipping lane that opened last autumn. The agreement is unusual in its insistence on public oversight: a joint commission with elected representation will sign off on routing decisions. A model worth watching as polar commerce expands.` },
  { who: 'marta', content: `![](${pic('youth-jury')})\n\n# A youth citizens' jury delivers its housing report\n\nThe first nationally-recognised youth citizens' jury in Spain handed its report to the housing ministry yesterday. The headline recommendation is a community land trust pilot in six cities; the structural finding is that the jury participants themselves want a permanent role in policy review, not a one-off consultation.` },
  { who: 'jonas', content: `![](${pic('peer-review')})\n\n# Open peer review reaches biology\n\nA major life-sciences journal has moved to fully open peer review, publishing reviewer comments alongside accepted papers. Early reaction is mixed: senior researchers welcome the transparency; junior researchers worry about retaliation risk. The journal has committed to a year-long evaluation with independent assessors.` },
  { who: 'henrik', content: `![](${pic('grid-cooperatives')})\n\n# Grid cooperatives are quietly winning\n\nAcross northern Europe, citizen-owned grid cooperatives now account for more than 18% of last-mile electricity distribution. The narrative used to be ideological; the reality is operational. Cooperative reliability metrics now outperform private operators in seven of nine surveyed regions.` },
  { who: 'asbjornenge', syndicate: true, content: `![](${pic('signed-record')})\n\n# What "the record" actually means\n\nWhen we say Politicus is built around durable signed authorship, we mean something specific. Every post is a Tezos transaction; every transaction is a signature; every signature is a verifiable chain of authorship. This is what makes the byline operationally distinct from a label. The record is the cryptography.` },
  { who: 'eira', syndicate: true, content: `![](${pic('bee-corridors')})\n\n# Pollinator corridors in Skåne show measurable returns\n\nA three-year study of the Skåne pollinator corridor programme shows yields up modestly in adjacent orchards and a significant rise in wild bee species counts. The cost-effectiveness comparison against pesticide reduction grants is striking. Local planning authorities elsewhere have started inviting the Skåne researchers to brief them.` },
  { who: 'sven', syndicate: true, content: `![](${pic('ferry-electrification')})\n\n# All-electric ferry routes hit a milestone in western Norway\n\nThree of the high-frequency ferry routes along the western coast now run entirely on battery-electric vessels. The transition's quieter story is shoreside: charging infrastructure built as community projects, with municipal ownership and a guaranteed public service requirement built into the contracts.` },
  { who: 'marta', syndicate: true, content: `![](${pic('library-co-design')})\n\n# Libraries quietly become civic infrastructure\n\nA wave of small Spanish municipalities have started running structured co-design sessions for public services through their library networks. The libraries are neutral, trusted, and physically distributed. The pattern is being mimicked in Italy and Portugal — and may be the most underrated civic-tech development of the year.` },
  { who: 'jonas', content: `![](${pic('community-foundry')})\n\n# A community foundry returns to a Welsh valley\n\nA cooperative-run small-scale foundry has opened in a Welsh valley town that lost its industry forty years ago. The economics are modest; the symbolism is heavy. The local employment story is real but small. The cultural story is larger.` },
  { who: 'henrik', syndicate: true, content: `![](${pic('rail-corridor')})\n\n# The new Nordic rail corridor reaches Trondheim\n\nThe long-promised high-speed rail link between Oslo and Trondheim reached operational status this week, with passenger services beginning Friday. Travel times are a quarter what they were; the freight implications, especially for fish exports, are still being measured.` },
  { who: 'eira', content: `![](${pic('coastal-erosion')})\n\n# Coastal erosion data goes public in Iceland\n\nIceland's environment ministry has released ten years of high-resolution coastal erosion data as a free, query-able dataset with an API. The geological community has been requesting this for a decade. The likely first beneficiaries are insurance assessors and the local press.` },
  { who: 'sven', content: `![](${pic('local-printing')})\n\n# A small revival of local-print weeklies\n\nThree weeks-old, three-page printed weeklies have launched in towns in Trøndelag this spring. They are not commercially viable on their own; they are sustained by subscription, civic ad space, and a small grant. The interesting bit is the editorial structure: rotating volunteer editorship, with stipends.` },
  { who: 'marta', syndicate: true, content: `![](${pic('audit-transparency')})\n\n# Public audit transparency in Portugal\n\nPortugal's national audit office has switched to publishing all reports — including the working papers and underlying data — alongside the audit summary. The expected friction with audited bodies has been modest. The unexpected benefit: investigative reporting picks up where the audit office leaves off.` },
  { who: 'jonas', syndicate: true, content: `![](${pic('vocational-training')})\n\n# Vocational-training pilots show large returns\n\nAn 18-month pilot of intensive vocational training in three small Danish towns has produced employment gains well above forecast. The replicable element is the apprenticeship-friendly tax credit; the harder-to-replicate part is the local employer network. Most of the lift comes from the second, not the first.` },
];

console.log(`\nPosting ${newBits.length} image-laden bits…`);
const sidPolitPress = await (async () => {
  const r = await fetch(`${tzkt}/v1/contracts/${deps.SyndicateRegistry}/bigmaps/syndicates/keys?active=true&sort.desc=lastLevel&limit=10`);
  const arr = await r.json();
  return arr.find(k => k.value?.name === 'The Politicus Press')?.key ?? null;
})();
console.log(`syndicate: ${sidPolitPress}`);

const writersWithBoot = { asbjornenge: { tezos: boot }, ...writers };

// Add syndicate members for the new writers' syndicate posts
if (sidPolitPress) {
  const syndContract = await boot.contract.at(deps.SyndicateRegistry);
  for (const name of NAMES) {
    try {
      const op = await sendBumped(boot, syndContract.methodsObject.add_member({ 0: sidPolitPress, 1: writers[name].address }));
      await op.confirmation();
      console.log(`  add_member ${name}: ${op.hash}`);
    } catch (e) {
      if (String(e).includes('ALREADY_MEMBER')) console.log(`  ${name} already member`);
      else console.error(`  add_member ${name} failed:`, e.message);
    }
  }
}

const postedBids = [];
let idx = 0;
for (const b of newBits) {
  idx++;
  try {
    const cid = await uploadIPFS(b.content);
    const tw = writersWithBoot[b.who].tezos;
    const c = await tw.contract.at(bitLogicAddr);
    const op = await sendBumped(
      tw,
      c.methodsObject.create_bit({ 0: cidToHex(cid), 1: null, 2: b.syndicate ? sidPolitPress : null }),
      { amount: bitCost, mutez: true },
    );
    await op.confirmation();
    const bidHex = crypto.createHash('blake2b512', {}).update(Buffer.concat([
      Buffer.from('05',  'hex'), // pack tag — placeholder; actual bid we'll resolve via TZKT
    ])).digest('hex');
    postedBids.push(op.hash);
    console.log(`  [${idx}/${newBits.length}] ${b.who}${b.syndicate ? ' @PolitPress' : ''}: ${op.hash}`);
    await new Promise(r => setTimeout(r, 800));
  } catch (e) {
    console.error(`  [${idx}/${newBits.length}] FAIL:`, e.message);
  }
}

// --- 3. Simulated voting ---

console.log('\nWaiting 20s for indexer to pick up bits…');
await new Promise(r => setTimeout(r, 20000));

const apiBase = 'http://politicus.coder.surflabs.no/api'; // dev API for fetching list — falls back to db if needed
async function fetchBits() {
  // Pull from TZKT bigmap directly; resilient regardless of indexer host.
  const r = await fetch(`${tzkt}/v1/contracts/${deps.BitDataStore}/bigmaps/bits/keys?active=true&sort.desc=firstLevel&limit=80`);
  const arr = await r.json();
  return arr.map(k => k.key);
}
const allBids = await fetchBits();
console.log(`Voting on ${allBids.length} bits…`);

// Probability distribution: most bits get moderate yay, a few get many yay, a couple get nay
function rollVote(rng) {
  const r = rng();
  if (r < 0.15) return { direction: false, votes: 1 };   // 15% nay-1
  if (r < 0.45) return { direction: true, votes: 1 };    // 30% yay-1
  if (r < 0.75) return { direction: true, votes: 2 };    // 30% yay-2
  if (r < 0.92) return { direction: true, votes: 3 };    // 17% yay-3
  return null;                                            // 8% no vote
}
function mkRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

let voted = 0, skipped = 0, failed = 0;
for (const name of NAMES) {
  const w = writers[name];
  const c = await w.tezos.contract.at(bitLogicAddr);
  const rng = mkRng(name.charCodeAt(0) * 1337);
  for (const bid of allBids) {
    const v = rollVote(rng);
    if (!v) { skipped++; continue; }
    try {
      const total = bitVoteCost * v.votes * v.votes;
      const op = await sendBumped(
        w.tezos,
        c.methodsObject.vote_bit({ 0: bid, 1: v.direction, 2: String(v.votes) }),
        { amount: total, mutez: true },
      );
      await op.confirmation();
      voted++;
      if (voted % 10 === 0) console.log(`  voted ${voted} so far…`);
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      failed++;
      if (failed < 5) console.error(`  ${name} vote ${bid.slice(0,8)} failed:`, e.message.slice(0, 100));
    }
  }
}
console.log(`Voting done. ${voted} cast, ${skipped} skipped, ${failed} failed.`);

console.log('\nDone. Wait ~30s for the indexer to sync. Then trigger a new default issue (or wait 24h TTL).');
