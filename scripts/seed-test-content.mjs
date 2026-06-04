// One-shot seeder: a "Politicus Press" syndicate + 30 bits spread across
// three voices and recent topics. Existing user (asbjornenge / POLITICUS)
// is one author; two new sub-journalists are generated, registered, and
// added to the syndicate.

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
const rpcUrl = env.POLITICUS_RPC_URL ?? 'https://rpc.shadownet.teztnets.com';
const ipfsUploadUrl = env.IPFS_UPLOAD_URL ?? 'http://internal.asbjornenge.com:5001';

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

async function placeholderBrightId(addr) {
  const hash = crypto.createHash('sha256').update(`politicus-placeholder-${addr}`).digest('hex');
  return hash;
}

async function newSigner() {
  const seed = new Uint8Array(32); crypto.randomFillSync(seed);
  const sk = b58Encode(seed, PrefixV2.Ed25519Seed);
  const signer = await InMemorySigner.fromSecretKey(sk);
  return { sk, address: await signer.publicKeyHash(), signer };
}

const bootAdmin = new TezosToolkit(rpcUrl);
bootAdmin.setSignerProvider(await InMemorySigner.fromSecretKey(env.POLITICUS_PRIVATE_KEY));

const deps = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).shadownet;

// --- 1. Generate two extra authors ---

console.log('Generating two sub-journalists…');
const alma = await newSigner();
const linnea = await newSigner();
console.log(`  alma:   ${alma.address}`);
console.log(`  linnea: ${linnea.address}`);

console.log('Funding from POLITICUS…');
for (const sub of [alma, linnea]) {
  const op = await bootAdmin.contract.transfer({ to: sub.address, amount: 12 });
  await op.confirmation();
  console.log(`  → ${sub.address}: ${op.hash}`);
}

// --- 2. Register all three ---

async function registerIfNeeded(label, signer, username) {
  const tezos = new TezosToolkit(rpcUrl);
  tezos.setSignerProvider(signer);
  const c = await tezos.contract.at(deps.IdentityRegistry);
  try {
    const op = await c.methodsObject.register({
      0: await placeholderBrightId(await signer.publicKeyHash()),
      1: username,
      2: '',
    }).send();
    console.log(`  register ${label} (${username}): ${op.hash}`);
    await op.confirmation();
  } catch (e) {
    if (String(e).includes('ALREADY_REGISTERED')) console.log(`  ${label} already registered`);
    else throw e;
  }
  return tezos;
}

console.log('\nRegistering users…');
const tAlma = await registerIfNeeded('alma', alma.signer, 'alma');
const tLinnea = await registerIfNeeded('linnea', linnea.signer, 'linnea');
// Asbjørn (POLITICUS_ADDRESS) is already registered as 'asbjornenge'.

// --- 3. Create syndicate "The Politicus Press" ---

console.log('\nCreating syndicate "The Politicus Press" …');
const syndContract = await bootAdmin.contract.at(deps.SyndicateRegistry);
const varContract = await bootAdmin.contract.at(deps.VariablesLogic);
async function readVar(key, fallback) {
  try {
    const v = await varContract.contractViews.get(key).executeView({ viewCaller: deps.VariablesLogic });
    if (v == null) return fallback;
    const s = v.toString?.();
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
const synCost = await readVar('SyndicateCreationCost', 5000000);
console.log(`  SyndicateCreationCost: ${synCost}`);
const synOp = await syndContract.methodsObject
  .create_syndicate({ 0: 'The Politicus Press', 1: 'A small editorial collective covering signal-over-noise current affairs.' })
  .send({ amount: synCost, mutez: true });
console.log(`  create: ${synOp.hash}`);
await synOp.confirmation();

// blake2b(pack creator || pack name) — let TZKT tell us
await new Promise(r => setTimeout(r, 4000));
const tzkt = env.TZKT_API ?? 'https://api.shadownet.tzkt.io';
const syndKeys = await (await fetch(`${tzkt}/v1/contracts/${deps.SyndicateRegistry}/bigmaps/syndicates/keys?active=true&sort.desc=lastLevel&limit=5`)).json();
const ourSid = syndKeys.find(k => k.value?.name === 'The Politicus Press')?.key;
if (!ourSid) throw new Error('could not find new syndicate sid');
console.log(`  sid: ${ourSid}`);

// Add alma and linnea as members
for (const [label, addr] of [['alma', alma.address], ['linnea', linnea.address]]) {
  const op = await syndContract.methodsObject.add_member({ 0: ourSid, 1: addr }).send();
  console.log(`  add_member ${label}: ${op.hash}`);
  await op.confirmation();
}

// --- 4. Post bits ---

const bits = [
  // Asbjørn — solo + syndicate
  { who: 'asbjornenge', syndicate: ourSid, content: `# AI act phase-2 enforcement begins\n\nThe second phase of the EU AI Act took effect this week, bringing systemic-risk models under disclosure obligations. The interesting wrinkle: the criterion for "systemic risk" is now compute, not capability — a measure several research labs have spent a year warning would lock in incumbents. Enforcement begins quietly with audit notifications; the test will be the first refusal.` },
  { who: 'asbjornenge', syndicate: ourSid, content: `# Open kernel, slow change\n\nPolicy is a kernel. Most platforms run a closed one and ask you to trust the operators. A few — Politicus is one — try to make the kernel readable, amendable, and accountable to the community that runs on top of it. The hardest problem isn't the tech; it's getting people to vote on plumbing.` },
  { who: 'asbjornenge', syndicate: null, content: `## A short note on signed bylines\n\nIn an environment where any image, voice, or paragraph can be fabricated, the byline is no longer a label — it is a proof. Politicus' bet is that the publishing surfaces of the next decade will need signed authorship the way the early web needed HTTPS.` },
  // Alma — health, urban
  { who: 'alma', syndicate: ourSid, content: `# Hospitals quietly adopt ambient transcription\n\nA quiet revolution in clinical workflow: a handful of large hospital networks now route patient encounters through ambient transcription pipelines. The win isn't speed — it's that physicians stop typing. Concerns remain around storage, consent revocation, and what happens to the transcripts in five years.` },
  { who: 'alma', syndicate: ourSid, content: `# Oslo unveils tiered congestion fee\n\nOslo's transport authority announced a tiered congestion-fee model differentiating commercial, single-occupant, and electric traffic. The headline is the structure; the substance is how the data will be made public. Open API by default, says the press release. We will see.` },
  { who: 'alma', syndicate: null, content: `# On medical AI second-opinions\n\nThe argument for AI second-opinions in radiology used to be cost. It is now coverage — small clinics in remote regions getting reads that a year ago took weeks. The risk register is well understood; what's evolving is the auditing protocol.` },
  { who: 'alma', syndicate: ourSid, content: `# Reading: Patrick Wyman on civic infrastructure\n\nA week-long thread by historian Patrick Wyman on what counts as civic infrastructure — and why "civic" should be more than a budget line. Worth the slow scroll. The point about libraries as last-mile civic terminals lands.` },
  { who: 'alma', syndicate: ourSid, content: `# Air-quality sensor mesh in Athens\n\nA cooperative-built air-quality sensor mesh in Athens now covers most central neighbourhoods. The data goes both to the municipality and a public dashboard, with deliberate redundancy so neither alone holds the truth. Quiet, useful, and copyable.` },
  // Linnea — culture, climate
  { who: 'linnea', syndicate: ourSid, content: `# Berlin's late-spring streaming wars\n\nIndie publishers in Berlin have started syndicating long-form essays through small reader-owned platforms. The model is patron-funded, not ad-driven, and the writing is — perhaps for that reason — slower and stranger. There is, of course, a Politicus-shaped surface for this.` },
  { who: 'linnea', syndicate: ourSid, content: `# The slow accord on climate finance\n\nThe spring summit on climate finance ended without the bridge funding many had expected, but with a clearer division of who shoulders adaptation costs. Quiet wins: a standardised insurance framework for low-income coastal nations.` },
  { who: 'linnea', syndicate: null, content: `# Notes on small-press economies\n\nA modest observation from a week reading small press output: the most sustainable publishers right now are the ones who never tried to scale. The economics of a 400-reader essay newsletter are surprisingly resilient. Scale was always the trap, not the goal.` },
  { who: 'linnea', syndicate: ourSid, content: `# A heat-resilient cooling cooperative\n\nIn Andalusia, a cooperative of small towns has pooled funds to build a shared cooling infrastructure ahead of the predicted summer heat. The model is unglamorous public works — but it ships, and it works, and it costs less than any single municipality bid would have.` },
  // Asbjørn again
  { who: 'asbjornenge', syndicate: null, content: `# A short reflection on quorum design\n\nQuorum thresholds are deceptively political. Set them too high and the platform calcifies; too low and a motivated minority can flip the kernel. The Politicus default — 40% for variable changes, 50% for kernel — is a guess. We expect the community to tune it. That is the point.` },
  { who: 'asbjornenge', syndicate: ourSid, content: `# The case for syndicates\n\nA syndicate is a credible signal that this byline reflects an editorial process — an editor, fact-checkers, or at minimum a culture. On Politicus, a syndicate is also an on-chain contract, which means the signal is unforgeable. That is something the open web has lacked for a long time.` },
  // Alma
  { who: 'alma', syndicate: ourSid, content: `# Public-health data and consent\n\nA Norwegian working group has published a draft framework for public-health data sharing built around revocable consent at the data-package level, not the dataset level. The detail matters: it lets people withdraw specific years of records without nuking the cohort. Big if it scales.` },
  { who: 'alma', syndicate: ourSid, content: `# What walkability actually buys you\n\nThree years of post-pedestrianisation data from Madrid central districts is finally in. Air quality and small-business revenues both improved; what's underreported is the drop in childhood asthma admissions to clinics within five blocks of the conversion. That number is bigger than expected.` },
  // Linnea
  { who: 'linnea', syndicate: ourSid, content: `# Streaming-rights wars come for archive radio\n\nA Spanish public-radio archive went behind a paywall this week after a streaming-rights settlement. The archive — fifty years of cultural memory — is now subscription-only. Public-funded, privately gated. A predictable trajectory, badly handled.` },
  { who: 'linnea', syndicate: null, content: `# The persistent good of physical newsstands\n\nA short defence of physical newsstands: they are slow editorial decisions made visible. What is on the rack, where, in what order — these are choices that someone made on behalf of a city. The internet has never quite replicated this layer of editorial weather.` },
  // Asbjørn
  { who: 'asbjornenge', syndicate: ourSid, content: `# Notes on petition fatigue\n\nIf every action is a petition, no action is meaningful. Politicus runs a fee on petition creation precisely so that proposals stay scarce. Most platforms find a way to make the friction back-load (after you've drained users' attention); we've front-loaded it. We will see if that survives contact with the audience.` },
  { who: 'asbjornenge', syndicate: null, content: `# Small UI choice, big consequence\n\nThe smallest UI choice with the biggest behavioural consequence on this platform is the cost being shown on the vote button. The vote isn't "free with a tiny invisible fee" — the fee is the button. People weigh it. The fee acts like a UX element, not just an economic one.` },
  // Alma
  { who: 'alma', syndicate: ourSid, content: `# Quiet progress on cataract surgery cost\n\nA WHO-coordinated rollout has dropped the per-case cost of cataract surgery in twelve countries by roughly 40% over two years. The story is in supply chains, not new tech. A reminder that boring infrastructure work — procurement, logistics, training — saves the most years of sight.` },
  { who: 'alma', syndicate: ourSid, content: `# On the politics of hospital APIs\n\nThe most fought-over surface in healthcare right now is the hospital API. Whoever defines it controls the secondary markets — insurance, devices, software. The current discourse pretends this is a technical conversation. It is not.` },
  // Linnea
  { who: 'linnea', syndicate: ourSid, content: `# Literary translation in the age of in-context models\n\nA quiet shift in literary publishing: in-context models now produce first-pass translations good enough that human translators have moved upstream into editorial judgment. The work hasn't disappeared. It has matured.` },
  { who: 'linnea', syndicate: null, content: `# Reflection on slowness as policy\n\nThere is a school of policy design that treats slowness as a feature: extending decision windows, mandating delays, building in time for reflection. It is unfashionable. It also tends to produce better decisions. The fashion will return.` },
  // Asbjørn
  { who: 'asbjornenge', syndicate: ourSid, content: `# On testing in public\n\nPolicy and software both benefit from being tested where the consequences are real. Politicus runs on a testnet that gets reset; the substance is the same: try things in the open, with the people who would actually use them, and accept that some attempts will not survive.` },
  // Alma
  { who: 'alma', syndicate: ourSid, content: `# Pedestrian deaths and design\n\nUrban planners have known for decades that lower speed limits prevent more pedestrian deaths than any other intervention. Implementation lags because the politics is hard. Recent shifts in Seoul and Lisbon have proved the speed-limit-versus-redesign debate is a false binary; both work, and they work better together.` },
  // Linnea
  { who: 'linnea', syndicate: null, content: `# A note on archives as commons\n\nNational archives — text, image, audio — are commons in the strict economic sense. Treat them as private property and they erode; treat them as commons and they flourish. The recent trend toward public-API access at modest cost is the right shape, and it is happening in too few countries.` },
  // Asbjørn
  { who: 'asbjornenge', syndicate: null, content: `# Why the platform is named after a newsbook\n\nMercurius Politicus, the 17th-century English newsbook, was one of the first weekly publications carrying the imprint of editorial responsibility. The name was chosen as a reminder that this is what the platform is for — not engagement metrics, but the record.` },
  // Alma
  { who: 'alma', syndicate: ourSid, content: `# Mental health peer-support nets in schools\n\nFour Norwegian counties have rolled out school-based peer-support networks for adolescent mental health. Early outcome measures are positive. The interesting governance choice: the networks are co-designed with students, not implemented for them. That distinction is doing a lot of the lift.` },
  // Linnea
  { who: 'linnea', syndicate: ourSid, content: `# Quiet weeks make the best newsletters\n\nThere is a recurring pattern in independent publishing: the best issues come out of quiet weeks. Nothing dramatic to chase, so the writers settle into ideas. Politicus' issue this week, as it happens, reads exactly that way.` },
];

console.log(`\nPosting ${bits.length} bits…`);
const VARIABLES = deps.VariablesLogic;
const BIT_REGISTRY = await (async () => {
  // Resolve current logic via DataStore.admin
  const r = await fetch(`${tzkt}/v1/contracts/${deps.BitDataStore}/storage`);
  const s = await r.json();
  return s.admin;
})();
const bitCost = await readVar('BitCost', 1000000);
console.log(`  bit-logic: ${BIT_REGISTRY}, bitcost: ${bitCost} mutez`);

const writers = {
  asbjornenge: { tezos: bootAdmin },
  alma: { tezos: tAlma },
  linnea: { tezos: tLinnea },
};

let i = 0;
for (const bit of bits) {
  i++;
  try {
    const cid = await uploadIPFS(bit.content);
    const t = writers[bit.who].tezos;
    const c = await t.contract.at(BIT_REGISTRY);
    const op = await c.methodsObject.create_bit({
      0: cidToHex(cid),
      1: null,
      2: bit.syndicate ?? null,
    }).send({ amount: bitCost, mutez: true });
    await op.confirmation();
    console.log(`  [${i}/${bits.length}] ${bit.who}${bit.syndicate ? ' @PolitPress' : ''}: ${op.hash}`);
    await new Promise(r => setTimeout(r, 800));
  } catch (e) {
    console.error(`  [${i}/${bits.length}] FAIL:`, e.message);
  }
}

console.log('\nDone. Wait ~30s for the indexer to catch up.');
