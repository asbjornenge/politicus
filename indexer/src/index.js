import postgres from 'postgres';
import { packDataBytes } from '@taquito/michel-codec';

const {
  DATABASE_URL,
  TZKT_API = 'https://api.previewnet.tezosx.tzkt.io',
  IDENTITY_REGISTRY,
  BIT_REGISTRY,
  BIT_DATA_STORE,
  PETITION_REGISTRY,
  PETITION_DATA_STORE,
  MODERATION_REGISTRY,
  SYNDICATE_REGISTRY,
  PROFILE_REGISTRY,
  BITNFT_FACTORY,
  IPFS_GATEWAY_URL = '',
  POLL_INTERVAL_MS = '10000',
} = process.env;

function packAddressHex(addr) {
  return packDataBytes({ string: addr }, { prim: 'address' }).bytes;
}

async function fetchProfileJson(hash) {
  const rows = await sql`SELECT body FROM content WHERE hash = ${hash}`;
  if (rows.length > 0) {
    try { return JSON.parse(rows[0].body.toString('utf8')); } catch { return null; }
  }
  if (!IPFS_GATEWAY_URL) return null;
  try {
    const r = await fetch(`${IPFS_GATEWAY_URL}/${hash}`);
    if (!r.ok) return null;
    const text = await r.text();
    await sql`
      INSERT INTO content (hash, body, content_type)
      VALUES (${hash}, ${Buffer.from(text, 'utf8')}, 'application/json')
      ON CONFLICT (hash) DO NOTHING
    `;
    return JSON.parse(text);
  } catch { return null; }
}

async function applyProfileToUser(packedKey, doc) {
  const u = await sql`SELECT address, username, bio FROM users WHERE packed_key = ${packedKey}`;
  if (u.length === 0) return;
  const username = (typeof doc?.username === 'string' && doc.username.trim()) ? doc.username : u[0].username;
  const bio = (typeof doc?.bio === 'string') ? doc.bio : u[0].bio;
  await sql`
    UPDATE users
    SET username = ${username}, bio = ${bio}, updated_at = now()
    WHERE packed_key = ${packedKey}
  `;
}

async function applyProfileToSyndicate(sid, doc) {
  const s = await sql`SELECT name, bio FROM syndicates WHERE sid = ${sid}`;
  if (s.length === 0) return;
  const name = (typeof doc?.name === 'string' && doc.name.trim()) ? doc.name : s[0].name;
  const bio = (typeof doc?.bio === 'string') ? doc.bio : s[0].bio;
  await sql`
    UPDATE syndicates
    SET name = ${name}, bio = ${bio}, updated_at = now()
    WHERE sid = ${sid}
  `;
}

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

// IPFS CIDs are stored on-chain as UTF-8 bytes (hex-encoded by Tezos). When
// the bytes decode cleanly to an alphanumeric string of CID length, treat
// them as a CID; otherwise keep the raw hex (covers legacy Blake2b-style
// hashes from pre-IPFS bits).
function decodeContentHash(hex) {
  if (!hex || typeof hex !== 'string') return hex;
  try {
    const utf8 = Buffer.from(hex, 'hex').toString('utf8');
    if (/^[A-Za-z0-9]{30,80}$/.test(utf8)) return utf8;
  } catch {}
  return hex;
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
    const contentHash = decodeContentHash(value.content_hash);
    // Lazy-fetch content from IPFS gateway if not already cached.
    if (IPFS_GATEWAY_URL && contentHash) {
      const cached = await sql`SELECT 1 FROM content WHERE hash = ${contentHash}`;
      if (cached.length === 0) {
        try {
          const r = await fetch(`${IPFS_GATEWAY_URL}/${contentHash}`);
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            await sql`
              INSERT INTO content (hash, body, content_type)
              VALUES (${contentHash}, ${buf}, 'text/plain')
              ON CONFLICT (hash) DO NOTHING
            `;
          }
        } catch { /* ignore — show "not yet uploaded" until next pass */ }
      }
    }
    await sql`
      INSERT INTO bits (bid, creator, content_hash, parent, syndicate, creation_time, yay, nay)
      VALUES (
        ${key}, ${value.creator}, ${contentHash},
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
    const packedKey = packAddressHex(key);
    await sql`
      INSERT INTO users (address, username, bio, brightid_hash, packed_key)
      VALUES (${key}, ${value.username}, ${value.bio}, ${value.brightid_hash}, ${packedKey})
      ON CONFLICT (address) DO UPDATE SET
        username = CASE
          WHEN users.packed_key IS NOT NULL
            AND EXISTS (SELECT 1 FROM profiles WHERE key = users.packed_key)
          THEN users.username
          ELSE EXCLUDED.username
        END,
        bio = CASE
          WHEN users.packed_key IS NOT NULL
            AND EXISTS (SELECT 1 FROM profiles WHERE key = users.packed_key)
          THEN users.bio
          ELSE EXCLUDED.bio
        END,
        brightid_hash = EXCLUDED.brightid_hash,
        packed_key = EXCLUDED.packed_key,
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
  } else if (bigmap === ptrs.profiles) {
    if (action === 'remove_key') {
      await sql`DELETE FROM profiles WHERE key = ${key}`;
      return;
    }
    if (!value) return;
    const profileHash = decodeContentHash(value);
    await sql`
      INSERT INTO profiles (key, profile_hash)
      VALUES (${key}, ${profileHash})
      ON CONFLICT (key) DO UPDATE SET
        profile_hash = EXCLUDED.profile_hash,
        updated_at = now()
    `;
    const doc = await fetchProfileJson(profileHash);
    if (doc) {
      const syndCheck = await sql`SELECT 1 FROM syndicates WHERE sid = ${key}`;
      if (syndCheck.length > 0) await applyProfileToSyndicate(key, doc);
      else await applyProfileToUser(key, doc);
    }
  } else if (bigmap === ptrs.nft_collections) {
    if (action === 'remove_key') {
      await sql`DELETE FROM nft_collections WHERE address = ${value}`;
      return;
    }
    if (!value) return;
    const addr = value;
    const ownerKey = key; // hex of blake2b("u"|"s" + pack(...))
    const meta = await fetchCollectionStorage(addr);
    if (!meta) return;
    await sql`
      INSERT INTO nft_collections (address, owner_kind, owner_address, owner_sid, payout)
      VALUES (${addr}, ${meta.kind}, ${meta.address ?? null}, ${meta.sid ?? null}, ${meta.payout ?? null})
      ON CONFLICT (address) DO UPDATE SET
        owner_kind = EXCLUDED.owner_kind,
        owner_address = EXCLUDED.owner_address,
        owner_sid = EXCLUDED.owner_sid,
        payout = EXCLUDED.payout,
        updated_at = now()
    `;
  } else if (bigmap === ptrs.syndicates) {
    if (action === 'remove_key') {
      await sql`DELETE FROM syndicate_members WHERE sid = ${key}`;
      await sql`DELETE FROM syndicates WHERE sid = ${key}`;
      return;
    }
    if (!value) return;
    await sql`
      INSERT INTO syndicates (sid, name, bio, creator, creation_time)
      VALUES (${key}, ${value.name ?? ''}, ${value.bio ?? ''}, ${value.creator}, ${value.creation_time})
      ON CONFLICT (sid) DO UPDATE SET
        name = EXCLUDED.name,
        bio = EXCLUDED.bio,
        updated_at = now()
    `;
    const admins = Array.isArray(value.admins) ? value.admins : [];
    const members = Array.isArray(value.members) ? value.members : [];
    const adminSet = new Set(admins);
    const all = new Set([...admins, ...members]);
    await sql`DELETE FROM syndicate_members WHERE sid = ${key} AND address NOT IN ${sql([...all, ''])}`;
    for (const addr of all) {
      const isAdmin = adminSet.has(addr);
      await sql`
        INSERT INTO syndicate_members (sid, address, is_admin)
        VALUES (${key}, ${addr}, ${isAdmin})
        ON CONFLICT (sid, address) DO UPDATE SET is_admin = EXCLUDED.is_admin
      `;
    }
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
    let actionPayload = a[actionType] ?? null;
    if ((actionType === 'mod_content_add' || actionType === 'mod_content_del')
        && typeof actionPayload === 'string') {
      actionPayload = decodeContentHash(actionPayload);
    }
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
  const targets = [ptrs.bits, ptrs.users, ptrs.petitions, ptrs.mod_content, ptrs.mod_users, ptrs.syndicates, ptrs.profiles, ptrs.nft_collections].filter(Boolean);
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

function extractAdminVoteFields(p) {
  // admin_apply_vote(bytes * address * bool * nat * timestamp). TzKT returns
  // either a positional object or named one depending on type metadata.
  if (!p) return null;
  const bid = p.bytes ?? p.bytes_0 ?? p['0'];
  const voter = p.address ?? p.address_1 ?? p['1'];
  const direction = p.bool ?? p.bool_2 ?? p['2'];
  const votes = p.nat ?? p.nat_3 ?? p['3'];
  const voteTime = p.timestamp ?? p.timestamp_4 ?? p['4'];
  if (!bid || !voter) return null;
  return {
    bid,
    voter,
    direction: direction === true || direction === 'true',
    votes: String(votes),
    voteTime,
  };
}

async function pollVoteOps() {
  if (!BIT_DATA_STORE) return;
  while (true) {
    const cursor = await getCursor('votes');
    const url = `${TZKT_API}/v1/operations/transactions?target=${BIT_DATA_STORE}&entrypoint=admin_apply_vote&id.gt=${cursor}&sort.asc=id&limit=100&status=applied`;
    const ops = await fetchJson(url);
    if (ops.length === 0) return;

    for (const op of ops) {
      const f = extractAdminVoteFields(op.parameter?.value);
      if (!f) continue;
      const vid = `${f.bid}:${f.voter}`;
      await sql`
        INSERT INTO votes (vid, bid, voter, direction, votes, vote_time)
        VALUES (${vid}, ${f.bid}, ${f.voter}, ${f.direction}, ${f.votes}, ${f.voteTime ?? op.timestamp})
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
  if (!PETITION_DATA_STORE) return;
  while (true) {
    const cursor = await getCursor('petition_votes');
    const url = `${TZKT_API}/v1/operations/transactions?target=${PETITION_DATA_STORE}&entrypoint=admin_apply_vote&id.gt=${cursor}&sort.asc=id&limit=100&status=applied`;
    const ops = await fetchJson(url);
    if (ops.length === 0) return;

    for (const op of ops) {
      const f = extractAdminVoteFields(op.parameter?.value);
      if (!f) continue;
      const pvid = `${f.bid}:${f.voter}`;
      await sql`
        INSERT INTO petition_votes (pvid, pid, voter, direction, votes, vote_time)
        VALUES (${pvid}, ${f.bid}, ${f.voter}, ${f.direction}, ${f.votes}, ${f.voteTime ?? op.timestamp})
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

async function fetchCollectionStorage(collectionAddr) {
  try {
    const r = await fetch(`${TZKT_API}/v1/contracts/${collectionAddr}/storage`);
    if (!r.ok) return null;
    const s = await r.json();
    const owner = s?.owner;
    if (!owner) return null;
    let meta = null;
    if (owner.user) meta = { kind: 'user', address: owner.user };
    else if (owner.syndicate) {
      const sid = owner.syndicate.bytes ?? owner.syndicate[1] ?? owner.syndicate.sid ?? null;
      meta = { kind: 'syndicate', sid };
    }
    if (!meta) return null;
    return { ...meta, payout: s.payout ?? null };
  } catch { return null; }
}

async function syncCollection(addr) {
  try {
    // Refresh the payout field on every cycle so it stays current after set_payout.
    const meta = await fetchCollectionStorage(addr);
    if (meta) {
      await sql`UPDATE nft_collections SET payout = ${meta.payout ?? null}, updated_at = now() WHERE address = ${addr}`;
    }
    const bms = await fetch(`${TZKT_API}/v1/contracts/${addr}/bigmaps`);
    if (!bms.ok) return;
    const arr = await bms.json();
    const editionsPtr = arr.find(b => b.path === 'editions')?.ptr;
    const ledgerPtr = arr.find(b => b.path === 'ledger')?.ptr;

    if (editionsPtr) {
      const ed = await fetch(`${TZKT_API}/v1/bigmaps/${editionsPtr}/keys?active=true&limit=200`);
      if (ed.ok) {
        const keys = await ed.json();
        for (const k of keys) {
          const tokenId = Number(k.key);
          const v = k.value;
          if (!v) continue;
          await sql`
            INSERT INTO nft_editions
              (collection_address, token_id, bid, total_editions, mint_price,
               royalty_bps, treasury_primary_bps, treasury_secondary_bps,
               sold, created_at)
            VALUES (${addr}, ${tokenId}, ${v.bid}, ${v.total_editions}, ${v.mint_price},
                    ${v.royalty_bps}, ${v.treasury_primary_bps}, ${v.treasury_secondary_bps},
                    ${v.sold}, ${v.created_at})
            ON CONFLICT (collection_address, token_id) DO UPDATE SET
              sold = EXCLUDED.sold,
              updated_at = now()
          `;
        }
      }
    }

    if (ledgerPtr) {
      const lg = await fetch(`${TZKT_API}/v1/bigmaps/${ledgerPtr}/keys?active=true&limit=500`);
      if (lg.ok) {
        const keys = await lg.json();
        for (const k of keys) {
          const holder = k.key?.address ?? k.key?.[0];
          const tokenId = Number(k.key?.nat ?? k.key?.[1]);
          const balance = Number(k.value);
          if (!holder || !Number.isFinite(tokenId)) continue;
          if (balance === 0) {
            await sql`DELETE FROM nft_tokens WHERE collection_address = ${addr} AND token_id = ${tokenId} AND holder = ${holder}`;
          } else {
            await sql`
              INSERT INTO nft_tokens (collection_address, token_id, holder, balance)
              VALUES (${addr}, ${tokenId}, ${holder}, ${balance})
              ON CONFLICT (collection_address, token_id, holder) DO UPDATE SET
                balance = EXCLUDED.balance,
                updated_at = now()
            `;
          }
        }
      }
    }
  } catch (e) {
    console.error(`[nft sync ${addr}] error:`, e.message);
  }
}

async function pollCollections() {
  const rows = await sql`SELECT address FROM nft_collections`;
  for (const r of rows) await syncCollection(r.address);
}

async function backfillMissingContent() {
  if (!IPFS_GATEWAY_URL) return;
  const rows = await sql`
    SELECT DISTINCT b.content_hash FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    WHERE c.hash IS NULL
  `;
  if (rows.length === 0) return;
  console.log(`Backfilling content cache for ${rows.length} bits from IPFS`);
  for (const r of rows) {
    try {
      const resp = await fetch(`${IPFS_GATEWAY_URL}/${r.content_hash}`);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      await sql`
        INSERT INTO content (hash, body, content_type)
        VALUES (${r.content_hash}, ${buf}, 'text/plain')
        ON CONFLICT (hash) DO NOTHING
      `;
    } catch (e) {
      console.error(`  fetch failed for ${r.content_hash}:`, e.message);
    }
  }
}

async function backfillPackedKeys() {
  const rows = await sql`SELECT address FROM users WHERE packed_key IS NULL`;
  if (rows.length === 0) return;
  console.log(`Backfilling packed_key for ${rows.length} users`);
  for (const r of rows) {
    try {
      const k = packAddressHex(r.address);
      await sql`UPDATE users SET packed_key = ${k} WHERE address = ${r.address}`;
    } catch (e) {
      console.error(`  pack failed for ${r.address}:`, e.message);
    }
  }
}

async function main() {
  console.log('Indexer starting');
  console.log(`  TzKT:             ${TZKT_API}`);
  console.log(`  IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`  BitRegistry:      ${BIT_REGISTRY}`);
  console.log(`  Poll interval:    ${pollMs}ms`);

  await backfillPackedKeys();
  await backfillMissingContent();

  const id = await getBigmapPtrs(IDENTITY_REGISTRY);
  const bitStore = BIT_DATA_STORE ?? BIT_REGISTRY;
  const br = await getBigmapPtrs(bitStore);
  const petitionStore = PETITION_DATA_STORE ?? PETITION_REGISTRY;
  const pr = await getBigmapPtrs(petitionStore);
  const mr = await getBigmapPtrs(MODERATION_REGISTRY);
  const sr = SYNDICATE_REGISTRY ? await getBigmapPtrs(SYNDICATE_REGISTRY) : {};
  const prof = PROFILE_REGISTRY ? await getBigmapPtrs(PROFILE_REGISTRY) : {};
  const nft = BITNFT_FACTORY ? await getBigmapPtrs(BITNFT_FACTORY) : {};
  const ptrs = {
    users: id.users,
    bits: br.bits,
    petitions: pr.petitions,
    mod_content: mr.moderated_content,
    mod_users: mr.moderated_users,
    syndicates: sr.syndicates,
    profiles: prof.profiles,
    nft_collections: nft.collections,
  };
  console.log(`  Bigmap pointers:`, ptrs);

  while (true) {
    try {
      await pollBigmaps(ptrs);
      await pollVoteOps();
      await pollPetitionVoteOps();
      await pollCollections();
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
