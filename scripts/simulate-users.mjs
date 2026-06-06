/**
 * Multi-user simulation. Generates N fresh keypairs, funds them from the
 * faucet, registers them in IdentityRegistry, then runs a petition with a
 * deliberate split vote so we can observe the majority-fail path.
 */
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import getTez from '@tacoinfra/get-tez';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const dep = JSON.parse(readFileSync(join(repoRoot, 'deployments.json'), 'utf8')).previewnet;
const RPC = process.env.POLITICUS_RPC_URL ?? 'https://michelson.previewnet.tezosx.nomadic-labs.com';
const FAUCET = process.env.POLITICUS_FAUCET_URL ?? 'https://faucet.previewnet.tezosx.nomadic-labs.com';

const NUM_USERS = 3;

async function generateUser(label) {
  const seed = randomBytes(32);
  const sk = b58Encode(seed, PrefixV2.Ed25519Seed);
  const signer = await InMemorySigner.fromSecretKey(sk);
  return { label, sk, pkh: await signer.publicKeyHash() };
}

async function tk(sk) {
  const t = new TezosToolkit(RPC);
  t.setSignerProvider(await InMemorySigner.fromSecretKey(sk));
  return t;
}

async function fund(pkh) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await getTez({ address: pkh, amount: 50, faucetUrl: FAUCET });
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = attempt * 15;
      process.stdout.write(`(retry in ${wait}s) `);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
}

async function register(user) {
  const tezos = await tk(user.sk);
  const c = await tezos.contract.at(dep.IdentityRegistry);
  const brightid = createHash('sha256').update(`placeholder-${user.label}-${user.pkh}`).digest('hex');
  const op = await c.methodsObject.register({ 0: brightid, 1: user.label, 2: `simulated ${user.label}` }).send();
  await op.confirmation();
}

async function createPetition(user, key, value) {
  const tezos = await tk(user.sk);
  const c = await tezos.contract.at(dep.PetitionRegistry);
  const op = await c.methodsObject.create_petition({ 0: key, 1: String(value) }).send({ amount: 1000000, mutez: true });
  await op.confirmation();
  for (let attempt = 1; attempt <= 12; attempt++) {
    await new Promise(r => setTimeout(r, 2500));
    const r = await fetch(`https://api.previewnet.tezosx.tzkt.io/v1/contracts/${dep.PetitionRegistry}/bigmaps/petitions/keys?sort.desc=id&limit=1`);
    const keys = await r.json();
    if (keys.length > 0 && keys[0]?.key) return keys[0].key;
  }
  throw new Error('TzKT did not index new petition within 30s');
}

async function votePetition(user, pid, direction, votes) {
  const tezos = await tk(user.sk);
  const c = await tezos.contract.at(dep.PetitionRegistry);
  const cost = 10000 * votes * votes;
  const op = await c.methodsObject.vote_petition({ 0: pid, 1: direction, 2: String(votes) }).send({ amount: cost, mutez: true });
  await op.confirmation();
}

async function resolve(user, pid) {
  const tezos = await tk(user.sk);
  const c = await tezos.contract.at(dep.PetitionRegistry);
  const op = await c.methodsObject.resolve_petition(pid).send();
  await op.confirmation();
}

async function readVar(key) {
  const tezos = await tk(process.env.POLITICUS_PRIVATE_KEY);
  const c = await tezos.contract.at(dep.Variables);
  const result = await c.contractViews.get(key).executeView({ viewCaller: process.env.POLITICUS_ADDRESS });
  return result?.Some;
}

async function readPetition(pid) {
  const tezos = await tk(process.env.POLITICUS_PRIVATE_KEY);
  const c = await tezos.contract.at(dep.PetitionRegistry);
  const result = await c.contractViews.get_petition(pid).executeView({ viewCaller: process.env.POLITICUS_ADDRESS });
  return result?.Some;
}

async function countUsers() {
  const tezos = await tk(process.env.POLITICUS_PRIVATE_KEY);
  const c = await tezos.contract.at(dep.IdentityRegistry);
  return await c.contractViews.count_users().executeView({ viewCaller: process.env.POLITICUS_ADDRESS });
}

const asbjorn = {
  label: 'asbjorn',
  sk: process.env.POLITICUS_PRIVATE_KEY,
  pkh: process.env.POLITICUS_ADDRESS,
};

async function main() {
  console.log(`\n=== Step 1: generate ${NUM_USERS} keypairs ===`);
  const users = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const u = await generateUser(`user${i}`);
    users.push(u);
    console.log(`  ${u.label}: ${u.pkh}`);
  }

  console.log(`\n=== Step 2: fund from faucet (sequential, with 5s spacing) ===`);
  for (const u of users) {
    process.stdout.write(`  ${u.label}... `);
    await fund(u.pkh);
    console.log('✓');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\n=== Step 3: register each in IdentityRegistry ===`);
  for (const u of users) {
    process.stdout.write(`  ${u.label}... `);
    await register(u);
    console.log('✓');
  }

  const total = await countUsers();
  console.log(`  total_users = ${total}`);

  console.log(`\n=== Step 4: user1 creates petition Set_variable("BitCost", 75000) ===`);
  const before = await readVar('BitCost');
  console.log(`  BitCost before: ${before}`);
  const pid = await createPetition(users[0], 'BitCost', 75000);
  console.log(`  pid: ${pid}`);

  console.log(`\n=== Step 5: split vote (2 yay vs 2 nay) ===`);
  await votePetition(asbjorn, pid, true, 1);   console.log('  asbjorn  yay 1');
  await votePetition(users[0], pid, true, 1);  console.log('  user1    yay 1');
  await votePetition(users[1], pid, false, 1); console.log('  user2    nay 1');
  await votePetition(users[2], pid, false, 1); console.log('  user3    nay 1');

  const open = await readPetition(pid);
  console.log(`  yay=${open.yay}, nay=${open.nay}, unique_voters=${open.unique_voters}`);

  console.log(`\n=== Step 6: wait 70s for window to close ===`);
  for (let i = 70; i > 0; i -= 10) {
    process.stdout.write(`  ${i}s `);
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log('');

  console.log(`\n=== Step 7: resolve ===`);
  await resolve(asbjorn, pid);
  const resolved = await readPetition(pid);
  console.log(`  resolved=${resolved.resolved}, passed=${resolved.passed}`);

  const after = await readVar('BitCost');
  console.log(`  BitCost after: ${after}`);
  console.log('');
  console.log(`  Expected: passed=false (50% < 80% majority), BitCost unchanged.`);
  console.log(`  Result:   ${resolved.passed === false && String(before) === String(after) ? '✓ as expected' : '✗ unexpected'}`);
}

main().catch(e => { console.error('\nFatal:', e); process.exit(1); });
