import postgres from 'postgres';

const {
  DATABASE_URL,
  TZKT_API = 'https://api.shadownet.tzkt.io',
  IDENTITY_REGISTRY,
  BIT_REGISTRY,
  PETITION_REGISTRY,
  MODERATION_REGISTRY,
  POLL_INTERVAL_MS = '10000',
} = process.env;

if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
if (!IDENTITY_REGISTRY || !BIT_REGISTRY || !PETITION_REGISTRY || !MODERATION_REGISTRY) {
  console.error('One of the *_REGISTRY env vars is missing');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);
const pollMs = Number(POLL_INTERVAL_MS);

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TzKT ${r.status} on ${url}: ${await r.text()}`);
  return r.json();
}

async function getBigmapPtrs(contract) {
  const arr = await fetchJson(`${TZKT_API}/v1/contracts/${contract}/bigmaps`);
  return Object.fromEntries(arr.map(b => [b.path, b.ptr]));
}

async function getCursor(source) {
  const rows = await sql`SELECT last_id FROM indexer_state WHERE source = ${source}`;
  if (rows.length === 0) {
    await sql`INSERT INTO indexer_state (source, last_id) VALUES (${source}, 0)`;
    return 0;
  }
  return Number(rows[0].last_id);
}

async function setCursor(source, lastId) {
  await sql`UPDATE indexer_state SET last_id = ${lastId}, updated_at = now() WHERE source = ${source}`;
}

async function applyBigmapUpdate(u, ptrs) {
  const { bigmap, action, content } = u;
  if (action === 'allocate' || action === 'remove') return;

  const key = content?.key;
  const value = content?.value;
  if (!key) return;

  if (bigmap === ptrs.bits) {
    if (action === 'remove_key') {
      await sql`DELETE FROM bits WHERE bid = ${key}`;
      return;
    }
    if (!value) return;
    await sql`
      INSERT INTO bits (bid, creator, content_hash, parent, syndicate, creation_time, yay, nay)
      VALUES (
        ${key}, ${value.creator}, ${value.content_hash},
        ${value.parent ?? null}, ${value.syndicate ?? null},
        ${value.creation_time}, ${value.yay}, ${value.nay}
      )
      ON CONFLICT (bid) DO UPDATE SET
        yay = EXCLUDED.yay,
        nay = EXCLUDED.nay,
        updated_at = now()
    `;
  } else if (bigmap === ptrs.users) {
    if (action === 'remove_key') {
      await sql`DELETE FROM users WHERE address = ${key}`;
      return;
    }
    if (!value) return;
    await sql`
      INSERT INTO users (address, username, bio, brightid_hash)
      VALUES (${key}, ${value.username}, ${value.bio}, ${value.brightid_hash})
      ON CONFLICT (address) DO UPDATE SET
        username = EXCLUDED.username,
        bio = EXCLUDED.bio,
        brightid_hash = EXCLUDED.brightid_hash,
        updated_at = now()
    `;
  } else if (bigmap === ptrs.mod_content) {
    if (action === 'remove_key') {
      await sql`DELETE FROM moderated_content WHERE content_hash = ${key}`;
      return;
    }
    if (!value) return;
    await sql`
      INSERT INTO moderated_content (content_hash, moderated_at)
      VALUES (${key}, ${value})
      ON CONFLICT (content_hash) DO UPDATE SET moderated_at = EXCLUDED.moderated_at, updated_at = now()
    `;
  } else if (bigmap === ptrs.mod_users) {
    if (action === 'remove_key') {
      await sql`DELETE FROM moderated_users WHERE address = ${key}`;
      return;
    }
    if (!value) return;
    await sql`
      INSERT INTO moderated_users (address, moderated_at)
      VALUES (${key}, ${value})
      ON CONFLICT (address) DO UPDATE SET moderated_at = EXCLUDED.moderated_at, updated_at = now()
    `;
  } else if (bigmap === ptrs.petitions) {
    if (action === 'remove_key') {
      await sql`DELETE FROM petitions WHERE pid = ${key}`;
      return;
    }
    if (!value) return;
    const a = value.action ?? {};
    const actionType = Object.keys(a)[0] ?? 'unknown';
    const actionPayload = a[actionType] ?? null;
    await sql`
      INSERT INTO petitions (pid, creator, action_type, action_payload, creation_time, closes_at, yay, nay, unique_voters, resolved, passed)
      VALUES (
        ${key}, ${value.creator}, ${actionType}, ${JSON.stringify(actionPayload)}::jsonb,
        ${value.creation_time}, ${value.closes_at},
        ${value.yay}, ${value.nay}, ${value.unique_voters},
        ${value.resolved}, ${value.passed}
      )
      ON CONFLICT (pid) DO UPDATE SET
        yay = EXCLUDED.yay,
        nay = EXCLUDED.nay,
        unique_voters = EXCLUDED.unique_voters,
        resolved = EXCLUDED.resolved,
        passed = EXCLUDED.passed,
        updated_at = now()
    `;
  }
}

async function pollBigmaps(ptrs) {
  const targets = [ptrs.bits, ptrs.users, ptrs.petitions, ptrs.mod_content, ptrs.mod_users].filter(Boolean);
  if (targets.length === 0) return;

  while (true) {
    const cursor = await getCursor('bigmaps');
    const url = `${TZKT_API}/v1/bigmaps/updates?bigmap.in=${targets.join(',')}&offset.cr=${cursor}&sort.asc=id&limit=100`;
    const updates = await fetchJson(url);
    if (updates.length === 0) return;

    for (const u of updates) await applyBigmapUpdate(u, ptrs);
    await setCursor('bigmaps', updates[updates.length - 1].id);
    console.log(`[bigmaps] +${updates.length} → ${updates[updates.length - 1].id}`);

    if (updates.length < 100) return;
  }
}

async function pollVoteOps() {
  while (true) {
    const cursor = await getCursor('votes');
    const url = `${TZKT_API}/v1/operations/transactions?target=${BIT_REGISTRY}&entrypoint=vote_bit&id.gt=${cursor}&sort.asc=id&limit=100&status=applied`;
    const ops = await fetchJson(url);
    if (ops.length === 0) return;

    for (const op of ops) {
      const p = op.parameter?.value;
      if (!p) continue;
      const bid = p.bytes;
      const direction = p.bool === true || p.bool === 'true';
      const votes = String(p.nat);
      const voter = op.sender?.address;
      const voteTime = op.timestamp;
      if (!bid || !voter) continue;
      const vid = `${bid}:${voter}`;

      await sql`
        INSERT INTO votes (vid, bid, voter, direction, votes, vote_time)
        VALUES (${vid}, ${bid}, ${voter}, ${direction}, ${votes}, ${voteTime})
        ON CONFLICT (vid) DO UPDATE SET
          direction = EXCLUDED.direction,
          votes = EXCLUDED.votes,
          vote_time = EXCLUDED.vote_time,
          updated_at = now()
      `;
    }
    await setCursor('votes', ops[ops.length - 1].id);
    console.log(`[votes] +${ops.length} → ${ops[ops.length - 1].id}`);

    if (ops.length < 100) return;
  }
}

async function pollPetitionVoteOps() {
  while (true) {
    const cursor = await getCursor('petition_votes');
    const url = `${TZKT_API}/v1/operations/transactions?target=${PETITION_REGISTRY}&entrypoint=vote_petition&id.gt=${cursor}&sort.asc=id&limit=100&status=applied`;
    const ops = await fetchJson(url);
    if (ops.length === 0) return;

    for (const op of ops) {
      const p = op.parameter?.value;
      if (!p) continue;
      const pid = p.bytes;
      const direction = p.bool === true || p.bool === 'true';
      const votes = String(p.nat);
      const voter = op.sender?.address;
      const voteTime = op.timestamp;
      if (!pid || !voter) continue;
      const pvid = `${pid}:${voter}`;

      await sql`
        INSERT INTO petition_votes (pvid, pid, voter, direction, votes, vote_time)
        VALUES (${pvid}, ${pid}, ${voter}, ${direction}, ${votes}, ${voteTime})
        ON CONFLICT (pvid) DO UPDATE SET
          direction = EXCLUDED.direction,
          votes = EXCLUDED.votes,
          vote_time = EXCLUDED.vote_time,
          updated_at = now()
      `;
    }
    await setCursor('petition_votes', ops[ops.length - 1].id);
    console.log(`[petition_votes] +${ops.length} → ${ops[ops.length - 1].id}`);

    if (ops.length < 100) return;
  }
}

async function main() {
  console.log('Indexer starting');
  console.log(`  TzKT:             ${TZKT_API}`);
  console.log(`  IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`  BitRegistry:      ${BIT_REGISTRY}`);
  console.log(`  Poll interval:    ${pollMs}ms`);

  const id = await getBigmapPtrs(IDENTITY_REGISTRY);
  const br = await getBigmapPtrs(BIT_REGISTRY);
  const pr = await getBigmapPtrs(PETITION_REGISTRY);
  const mr = await getBigmapPtrs(MODERATION_REGISTRY);
  const ptrs = {
    users: id.users,
    bits: br.bits,
    petitions: pr.petitions,
    mod_content: mr.moderated_content,
    mod_users: mr.moderated_users,
  };
  console.log(`  Bigmap pointers:`, ptrs);

  while (true) {
    try {
      await pollBigmaps(ptrs);
      await pollVoteOps();
      await pollPetitionVoteOps();
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
