import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import { packDataBytes } from '@taquito/michel-codec';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';

function packAddressHex(addr) {
  const packed = packDataBytes({ string: addr }, { prim: 'address' });
  return packed.bytes;
}

const {
  DATABASE_URL,
  PORT = '8080',
  RPC_URL = 'https://rpc.shadownet.teztnets.com',
  FAUCET_URL = '',
  IPFS_UPLOAD_URL = 'http://localhost:5001',
  IPFS_GATEWAY_URL = 'http://localhost:8080',
  VARIABLES_ADDRESS,
  VARIABLES_DATA_STORE,
  BIT_DATA_STORE,
  PETITION_DATA_STORE,
  TREASURY_ADDRESS,
  IDENTITY_REGISTRY,
  BIT_REGISTRY,
  PETITION_REGISTRY,
  MODERATION_REGISTRY,
  SYNDICATE_REGISTRY,
  PROFILE_REGISTRY,
  BITNFT_FACTORY,
  ANTHROPIC_API_KEY,
} = process.env;

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

const sql = postgres(DATABASE_URL);
const app = new Hono();

app.use('*', cors());

async function uploadToIpfs(buffer, filename = 'content') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  const r = await fetch(`${IPFS_UPLOAD_URL}/api/v0/add`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`ipfs add failed: ${r.status} ${await r.text()}`);
  const text = await r.text();
  // IPFS returns one NDJSON line per added file; the last line is the wrapped file.
  const lines = text.trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  return last.Hash;
}

async function fetchFromIpfs(cid) {
  const r = await fetch(`${IPFS_GATEWAY_URL}/${cid}`);
  if (!r.ok) throw new Error(`ipfs gateway ${r.status}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  const contentType = r.headers.get('content-type') ?? 'application/octet-stream';
  return { buffer, contentType };
}

app.get('/health', c => c.json({ ok: true }));

const TZKT_API_URL = process.env.TZKT_API ?? 'https://api.shadownet.tzkt.io';

app.get('/api/kernel-vars', async c => {
  const valuesContract = VARIABLES_DATA_STORE || VARIABLES_ADDRESS;
  if (!valuesContract) return c.json({ values: {} });
  try {
    const r = await fetch(`${TZKT_API_URL}/v1/contracts/${valuesContract}/bigmaps/values/keys?active=true&limit=200`);
    if (!r.ok) return c.json({ error: 'tzkt unavailable' }, 502);
    const arr = await r.json();
    const values = {};
    for (const item of arr) {
      if (item.key != null && item.value != null) values[String(item.key)] = String(item.value);
    }
    return c.json({ values });
  } catch (e) {
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});

const RESOLVE_CACHE = new Map();
const RESOLVE_TTL_MS = 60_000;

async function resolveLogicAdmin(dataStore) {
  if (!dataStore) return null;
  const hit = RESOLVE_CACHE.get(dataStore);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;
  try {
    const r = await fetch(`${TZKT_API_URL}/v1/contracts/${dataStore}/storage`);
    if (!r.ok) return hit?.value ?? null;
    const s = await r.json();
    const admin = s?.admin ?? null;
    if (admin) RESOLVE_CACHE.set(dataStore, { at: Date.now(), value: admin });
    return admin;
  } catch {
    return hit?.value ?? null;
  }
}

app.get('/api/config', async c => {
  const [variables, bitRegistry, petitionRegistry] = await Promise.all([
    VARIABLES_DATA_STORE ? resolveLogicAdmin(VARIABLES_DATA_STORE) : VARIABLES_ADDRESS,
    BIT_DATA_STORE ? resolveLogicAdmin(BIT_DATA_STORE) : BIT_REGISTRY,
    PETITION_DATA_STORE ? resolveLogicAdmin(PETITION_DATA_STORE) : PETITION_REGISTRY,
  ]);
  return c.json({
    rpcUrl: RPC_URL,
    faucetUrl: FAUCET_URL || null,
    ipfsGateway: IPFS_GATEWAY_URL,
    contracts: {
      Variables: variables ?? VARIABLES_ADDRESS,
      Treasury: TREASURY_ADDRESS,
      IdentityRegistry: IDENTITY_REGISTRY,
      BitRegistry: bitRegistry ?? BIT_REGISTRY,
      PetitionRegistry: petitionRegistry ?? PETITION_REGISTRY,
      ModerationRegistry: MODERATION_REGISTRY,
      SyndicateRegistry: SYNDICATE_REGISTRY || undefined,
      ProfileRegistry: PROFILE_REGISTRY || undefined,
      BitNFTFactory: BITNFT_FACTORY || undefined,
    },
  });
});

// --- Issues (newspaper) ---

const ISSUE_SYSTEM_PROMPT = `You are the editor of Politicus, a user-governed publishing platform whose tagline is "Signed, civic, durable." The platform deliberately invokes 17th-century newsbook tradition (its name nods to Mercurius Politicus). Your job is to organise a list of recent bits into a serious, broadsheet-style front page.

Rules — these are absolute:
- ABSOLUTELY NO clickbait. Headlines must accurately summarise the bit's actual content in 3-8 words.
- Use a neutral, editorial tone. No exclamation marks, no hyperbole, no marketing language.
- NEVER invent facts. Each headline must be supported by the bit's content.
- Pick the lead based on substance: a bit with depth, broad relevance, and engagement signal (yay > nay, replies). Prefer syndicate-attributed content for the lead when comparable.
- Group remaining bits into 2-5 thematic sections. Section titles should be broad and traditional (e.g., "Politics", "Culture", "Technology", "Civic life"). Do not invent niche or jokey section names.
- Intro: ONE short editorial sentence setting the tone of the issue. No throat-clearing. No statistics unless they're genuinely insightful.
- Skip irrelevant bits. Don't pad sections.
- Skip bits whose content reads as banter or low signal.

Return JSON ONLY (no markdown fences, no commentary), matching this schema:
{
  "title": "Politicus — {date range}",
  "intro": "One sentence editorial framing.",
  "lead": { "bit_id": "<bid>", "headline": "..." },
  "sections": [
    {
      "name": "Section name",
      "items": [ { "bit_id": "<bid>", "headline": "..." } ]
    }
  ]
}`;

async function fetchBitsForIssue(timeStart, timeEnd, q, syndicate, limit = 80) {
  return await sql`
    SELECT b.bid, b.creator, b.creation_time, b.yay, b.nay, b.syndicate,
      u.username, s.name AS syndicate_name,
      ct.body
    FROM bits b
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    LEFT JOIN content ct ON ct.hash = b.content_hash
    WHERE b.creation_time >= ${timeStart}
      AND b.creation_time <= ${timeEnd}
      AND b.parent IS NULL
      AND NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
      AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
      ${syndicate ? sql`AND b.syndicate = ${syndicate}` : sql``}
      ${q ? sql`AND ct.body::text ILIKE ${'%' + q + '%'}` : sql``}
    ORDER BY (b.yay - b.nay) DESC, b.creation_time DESC
    LIMIT ${limit}
  `;
}

const DEFAULT_ISSUE_TTL_MS = 24 * 60 * 60 * 1000;

async function composeIssue({ windowDays, q, syndicate, creator, isDefault }) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not configured');
  const timeEnd = new Date();
  const timeStart = new Date(timeEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const bits = await fetchBitsForIssue(timeStart, timeEnd, q, syndicate);
  if (bits.length < 3) {
    const e = new Error(`Only ${bits.length} matching bits — need at least 3.`);
    e.status = 400; throw e;
  }
  const bitData = bits.map(b => ({
    bid: b.bid,
    creator: b.username ?? b.creator?.slice(0, 8),
    syndicate: b.syndicate_name ?? null,
    timestamp: b.creation_time,
    yay: Number(b.yay),
    nay: Number(b.nay),
    excerpt: (b.body ? b.body.toString('utf8') : '').slice(0, 500),
  }));
  const completion = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: ISSUE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Date range: ${timeStart.toISOString().slice(0, 10)} → ${timeEnd.toISOString().slice(0, 10)}\n${q ? `Search filter: "${q}"\n` : ''}${syndicate ? `Syndicate filter: ${syndicate}\n` : ''}\nBits:\n${JSON.stringify(bitData, null, 2)}`
    }],
  });
  const text = completion.content[0]?.text ?? '';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('no json in response');
  const layout = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const referenced = new Set();
  if (layout.lead?.bit_id) referenced.add(layout.lead.bit_id);
  for (const s of (layout.sections ?? [])) {
    for (const it of (s.items ?? [])) {
      if (it.bit_id) referenced.add(it.bit_id);
    }
  }
  const id = crypto.randomBytes(12).toString('hex');
  await sql`
    INSERT INTO issues
      (id, title, intro, layout_json, bit_ids,
       time_window_start, time_window_end,
       filter_query, filter_syndicate, creator, is_default)
    VALUES
      (${id}, ${layout.title ?? 'Politicus'}, ${layout.intro ?? null},
       ${JSON.stringify(layout)}::jsonb,
       ${JSON.stringify([...referenced])}::jsonb,
       ${timeStart.toISOString()}, ${timeEnd.toISOString()},
       ${q}, ${syndicate}, ${creator}, ${!!isDefault})
  `;
  return { id, layout, time_window_start: timeStart, time_window_end: timeEnd };
}

app.get('/api/issues/default', async c => {
  const fresh = await sql`
    SELECT * FROM issues
    WHERE is_default = true
      AND created_at > ${new Date(Date.now() - DEFAULT_ISSUE_TTL_MS).toISOString()}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (fresh.length > 0) return c.json({ id: fresh[0].id, cached: true });
  if (!anthropic) return c.json({ error: 'editor_offline' }, 503);
  try {
    const result = await composeIssue({ windowDays: 7, q: null, syndicate: null, creator: null, isDefault: true });
    return c.json({ id: result.id, cached: false });
  } catch (e) {
    return c.json({ error: 'editor_failed', detail: String(e?.message ?? e) }, e?.status ?? 502);
  }
});

app.post('/api/issues', async c => {
  if (!anthropic) return c.json({ error: 'editor_offline', detail: 'ANTHROPIC_API_KEY not configured' }, 503);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'expected json' }, 400);
  try {
    const result = await composeIssue({
      windowDays: Math.max(1, Math.min(30, Number(body.window_days) || 7)),
      q: body.query?.toString().trim() || null,
      syndicate: body.syndicate?.toString().trim() || null,
      creator: body.creator?.toString().trim() || null,
      isDefault: false,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'editor_failed', detail: String(e?.message ?? e) }, e?.status ?? 502);
  }
});

app.get('/api/issues', async c => {
  const limit = Math.min(50, Number(c.req.query('limit') ?? '20'));
  const rows = await sql`
    SELECT id, title, intro, time_window_start, time_window_end,
      filter_query, filter_syndicate, creator, created_at
    FROM issues
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return c.json({ issues: rows });
});

app.get('/api/issues/:id', async c => {
  const id = c.req.param('id');
  const rows = await sql`SELECT * FROM issues WHERE id = ${id}`;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  const issue = rows[0];
  let bitIds = issue.bit_ids ?? [];
  if (typeof bitIds === 'string') {
    try { bitIds = JSON.parse(bitIds); } catch { bitIds = []; }
  }
  const bits = bitIds.length > 0
    ? await sql`
        SELECT b.bid, b.creator, b.creation_time, b.syndicate,
          u.username, s.name AS syndicate_name,
          ct.body
        FROM bits b
        LEFT JOIN users u ON u.address = b.creator
        LEFT JOIN syndicates s ON s.sid = b.syndicate
        LEFT JOIN content ct ON ct.hash = b.content_hash
        WHERE b.bid = ANY(${bitIds})
      `
    : [];
  const bitMap = Object.fromEntries(bits.map(b => [b.bid, {
    bid: b.bid,
    creator: b.creator,
    creator_username: b.username ?? null,
    syndicate: b.syndicate,
    syndicate_name: b.syndicate_name ?? null,
    creation_time: b.creation_time,
    content: b.body ? b.body.toString('utf8') : null,
  }]));
  let layoutJson = issue.layout_json;
  if (typeof layoutJson === 'string') {
    try { layoutJson = JSON.parse(layoutJson); } catch {}
  }
  return c.json({ issue: { ...issue, layout_json: layoutJson, bit_ids: bitIds, bits: bitMap } });
});

// --- BitNFT ---

app.get('/api/nft/collections/by-user/:address', async c => {
  const address = c.req.param('address');
  const rows = await sql`SELECT * FROM nft_collections WHERE owner_address = ${address} LIMIT 1`;
  if (rows.length === 0) return c.json({ collection: null });
  return c.json({ collection: rows[0] });
});

app.get('/api/nft/collections/by-syndicate/:sid', async c => {
  const sid = c.req.param('sid');
  const rows = await sql`SELECT * FROM nft_collections WHERE owner_sid = ${sid} LIMIT 1`;
  if (rows.length === 0) return c.json({ collection: null });
  return c.json({ collection: rows[0] });
});

app.get('/api/nft/editions/by-bit/:bid', async c => {
  const bid = c.req.param('bid');
  const rows = await sql`
    SELECT e.*, c.owner_kind, c.owner_address, c.owner_sid
    FROM nft_editions e
    JOIN nft_collections c ON c.address = e.collection_address
    WHERE e.bid = ${bid}
    ORDER BY e.created_at DESC
  `;
  return c.json({ editions: rows.map(r => ({
    collection_address: r.collection_address,
    token_id: Number(r.token_id),
    bid: r.bid,
    total_editions: Number(r.total_editions),
    mint_price: Number(r.mint_price),
    royalty_bps: Number(r.royalty_bps),
    treasury_primary_bps: Number(r.treasury_primary_bps),
    treasury_secondary_bps: Number(r.treasury_secondary_bps),
    sold: Number(r.sold),
    created_at: r.created_at,
    owner_kind: r.owner_kind,
    owner_address: r.owner_address,
    owner_sid: r.owner_sid,
  })) });
});

app.get('/api/nft/owned/:address', async c => {
  const address = c.req.param('address');
  const rows = await sql`
    SELECT t.collection_address, t.token_id, t.balance,
      e.bid, e.total_editions, e.sold, e.mint_price,
      c.owner_kind, c.owner_address, c.owner_sid,
      b.creator AS bit_creator, b.creation_time AS bit_creation_time,
      b.syndicate AS bit_syndicate,
      s.name AS bit_syndicate_name,
      u.username AS bit_creator_username,
      ct.body AS bit_body
    FROM nft_tokens t
    JOIN nft_editions e ON e.collection_address = t.collection_address AND e.token_id = t.token_id
    JOIN nft_collections c ON c.address = t.collection_address
    LEFT JOIN bits b ON b.bid = e.bid
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    LEFT JOIN content ct ON ct.hash = b.content_hash
    WHERE t.holder = ${address} AND t.balance > 0
    ORDER BY t.updated_at DESC
  `;
  return c.json({ tokens: rows.map(r => ({
    collection_address: r.collection_address,
    token_id: Number(r.token_id),
    balance: Number(r.balance),
    bid: r.bid,
    total_editions: Number(r.total_editions),
    sold: Number(r.sold),
    mint_price: Number(r.mint_price),
    owner_kind: r.owner_kind,
    owner_address: r.owner_address,
    owner_sid: r.owner_sid,
    bit_creator: r.bit_creator,
    bit_creator_username: r.bit_creator_username,
    bit_syndicate: r.bit_syndicate,
    bit_syndicate_name: r.bit_syndicate_name,
    bit_creation_time: r.bit_creation_time,
    bit_content: r.bit_body ? r.bit_body.toString('utf8') : null,
  })) });
});

// --- Content ---

app.post('/api/content', async c => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.body !== 'string') {
    return c.json({ error: 'expected { body: string, content_type?: string }' }, 400);
  }
  const contentType = typeof body.content_type === 'string' ? body.content_type : 'text/plain';
  const bytes = Buffer.from(body.body, 'utf8');

  let hash;
  try {
    hash = await uploadToIpfs(bytes, 'content.txt');
  } catch (e) {
    return c.json({ error: 'ipfs_unavailable', detail: String(e?.message ?? e) }, 502);
  }

  await sql`
    INSERT INTO content (hash, body, content_type)
    VALUES (${hash}, ${bytes}, ${contentType})
    ON CONFLICT (hash) DO NOTHING
  `;
  return c.json({ hash, url: `${IPFS_GATEWAY_URL}/${hash}` });
});

function validateProfile(p) {
  if (typeof p !== 'object' || p === null) return 'must be object';
  if (p.version !== 1) return 'version must be 1';
  const allowed = new Set(['version', 'username', 'name', 'bio', 'avatar', 'links', 'location', 'tagline']);
  for (const k of Object.keys(p)) {
    if (!allowed.has(k)) return `unknown field "${k}"`;
  }
  if (p.username !== undefined) {
    if (typeof p.username !== 'string' || p.username.length === 0 || p.username.length > 30) return 'username must be string 1..30';
  }
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || p.name.length === 0 || p.name.length > 60) return 'name must be string 1..60';
  }
  if (p.bio !== undefined) {
    if (typeof p.bio !== 'string' || p.bio.length > 1000) return 'bio must be string ≤1000';
  }
  if (p.avatar !== undefined) {
    if (typeof p.avatar !== 'string') return 'avatar must be string CID';
    if (!/^[A-Za-z0-9]{30,80}$/.test(p.avatar)) return 'avatar must look like a CID';
  }
  if (p.tagline !== undefined) {
    if (typeof p.tagline !== 'string' || p.tagline.length > 140) return 'tagline must be string ≤140';
  }
  if (p.location !== undefined) {
    if (typeof p.location !== 'string' || p.location.length > 100) return 'location must be string ≤100';
  }
  if (p.links !== undefined) {
    if (!Array.isArray(p.links)) return 'links must be array';
    if (p.links.length > 20) return 'too many links (max 20)';
    for (const l of p.links) {
      if (typeof l !== 'object' || l === null) return 'link must be object';
      if (typeof l.name !== 'string' || l.name.length === 0 || l.name.length > 60) return 'link.name must be string 1..60';
      if (typeof l.url !== 'string' || l.url.length > 500) return 'link.url must be string ≤500';
      if (!/^https?:\/\//.test(l.url)) return 'link.url must be http(s)';
    }
  }
  return null;
}

app.post('/api/profile', async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'expected json' }, 400);
  const err = validateProfile(body);
  if (err) return c.json({ error: err }, 400);
  const json = JSON.stringify(body);
  const bytes = Buffer.from(json, 'utf8');
  let hash;
  try { hash = await uploadToIpfs(bytes, 'profile.json'); }
  catch (e) { return c.json({ error: 'ipfs_unavailable', detail: String(e?.message ?? e) }, 502); }
  await sql`
    INSERT INTO content (hash, body, content_type)
    VALUES (${hash}, ${bytes}, 'application/json')
    ON CONFLICT (hash) DO NOTHING
  `;
  return c.json({ hash, url: `${IPFS_GATEWAY_URL}/${hash}` });
});

app.post('/api/upload', async c => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'expected multipart field "file"' }, 400);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let cid;
  try {
    cid = await uploadToIpfs(buffer, file.name || 'upload');
  } catch (e) {
    return c.json({ error: 'ipfs_unavailable', detail: String(e?.message ?? e) }, 502);
  }
  return c.json({ cid, url: `${IPFS_GATEWAY_URL}/${cid}` });
});

app.get('/api/content/:hash', async c => {
  const hash = c.req.param('hash');
  const modCheck = await sql`SELECT 1 FROM moderated_content WHERE content_hash = ${hash}`;
  if (modCheck.length > 0) {
    return c.json({ error: 'moderated', hash }, 451);
  }
  const rows = await sql`SELECT body, content_type FROM content WHERE hash = ${hash}`;
  if (rows.length > 0) {
    const row = rows[0];
    return c.json({
      hash,
      body: row.body.toString('utf8'),
      content_type: row.content_type,
    });
  }
  // Cache miss — try fetching from IPFS gateway and cache for next time.
  try {
    const { buffer, contentType } = await fetchFromIpfs(hash);
    await sql`
      INSERT INTO content (hash, body, content_type)
      VALUES (${hash}, ${buffer}, ${contentType})
      ON CONFLICT (hash) DO NOTHING
    `;
    return c.json({
      hash,
      body: buffer.toString('utf8'),
      content_type: contentType,
    });
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
});

// --- Bits ---

app.get('/api/bits', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const before = c.req.query('before');
  const viewer = c.req.query('viewer') ?? '';
  const rows = before
    ? await sql`
        SELECT b.*, c.body, c.content_type, u.username, u.bio,
          s.name AS syndicate_name,
          (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
          v.direction AS my_vote, v.votes AS my_votes,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
        LEFT JOIN syndicates s ON s.sid = b.syndicate
        LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
        WHERE b.creation_time < ${before}
          AND NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
          AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
        ORDER BY b.creation_time DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT b.*, c.body, c.content_type, u.username, u.bio,
          s.name AS syndicate_name,
          (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
          v.direction AS my_vote, v.votes AS my_votes,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
        LEFT JOIN syndicates s ON s.sid = b.syndicate
        LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
        WHERE NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
          AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
        ORDER BY b.creation_time DESC
        LIMIT ${limit}
      `;
  return c.json({ bits: rows.map(formatBit) });
});

app.get('/api/bits/:bid', async c => {
  const bid = c.req.param('bid');
  const viewer = c.req.query('viewer') ?? '';
  const rows = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      s.name AS syndicate_name,
      (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
    WHERE b.bid = ${bid}
  `;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);

  const ancestors = await sql`
    WITH RECURSIVE thread AS (
      SELECT b.bid, b.parent, 0 AS depth FROM bits b WHERE b.bid = ${bid}
      UNION ALL
      SELECT b.bid, b.parent, t.depth + 1 FROM bits b JOIN thread t ON b.bid = t.parent WHERE t.depth < 50
    )
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM thread t
    JOIN bits b ON b.bid = t.bid
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
    WHERE t.depth > 0
    ORDER BY t.depth DESC
  `;

  const replies = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      s.name AS syndicate_name,
      (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
    WHERE b.parent = ${bid}
    ORDER BY b.creation_time ASC
  `;
  const votes = await sql`
    SELECT voter, direction, votes, vote_time FROM votes WHERE bid = ${bid} ORDER BY vote_time DESC
  `;

  return c.json({
    bit: formatBit(rows[0]),
    ancestors: ancestors.map(formatBit),
    replies: replies.map(formatBit),
    votes,
  });
});

// --- Users ---

app.get('/api/users/:address', async c => {
  const address = c.req.param('address');
  const userRows = await sql`SELECT * FROM users WHERE address = ${address}`;
  if (userRows.length === 0) return c.json({ error: 'not_found' }, 404);
  const moderated = await sql`SELECT 1 FROM moderated_users WHERE address = ${address}`;
  let profile_hash = null;
  try {
    const profKey = packAddressHex(address);
    const profRows = await sql`SELECT profile_hash FROM profiles WHERE key = ${profKey}`;
    if (profRows.length > 0) profile_hash = profRows[0].profile_hash;
  } catch { /* ignore */ }
  const bitRows = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      s.name AS syndicate_name,
      (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    WHERE b.creator = ${address}
    ORDER BY b.creation_time DESC
    LIMIT 50
  `;
  return c.json({
    user: { ...userRows[0], moderated: moderated.length > 0, profile_hash },
    bits: bitRows.map(formatBit),
  });
});

// --- Petitions ---

app.get('/api/petitions', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const viewer = c.req.query('viewer') ?? '';
  const rows = await sql`
    SELECT p.*, u.username AS creator_username,
      pv.direction AS my_vote, pv.votes AS my_votes
    FROM petitions p
    LEFT JOIN users u ON u.address = p.creator
    LEFT JOIN petition_votes pv ON pv.pid = p.pid AND pv.voter = ${viewer}
    ORDER BY p.creation_time DESC
    LIMIT ${limit}
  `;
  return c.json({ petitions: rows.map(formatPetition) });
});

app.get('/api/petitions/:pid', async c => {
  const pid = c.req.param('pid');
  const viewer = c.req.query('viewer') ?? '';
  const rows = await sql`
    SELECT p.*, u.username AS creator_username,
      pv.direction AS my_vote, pv.votes AS my_votes
    FROM petitions p
    LEFT JOIN users u ON u.address = p.creator
    LEFT JOIN petition_votes pv ON pv.pid = p.pid AND pv.voter = ${viewer}
    WHERE p.pid = ${pid}
  `;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ petition: formatPetition(rows[0]) });
});

// --- Syndicates ---

app.get('/api/syndicates', async c => {
  const rows = await sql`
    SELECT s.*,
      (SELECT count(*) FROM syndicate_members m WHERE m.sid = s.sid) AS member_count,
      (SELECT count(*) FROM syndicate_members m WHERE m.sid = s.sid AND m.is_admin) AS admin_count,
      (SELECT count(*) FROM bits b WHERE b.syndicate = s.sid) AS bit_count,
      (SELECT profile_hash FROM profiles WHERE key = s.sid) AS profile_hash
    FROM syndicates s
    ORDER BY s.creation_time DESC
  `;
  return c.json({ syndicates: rows.map(formatSyndicate) });
});

app.get('/api/syndicates/:sid', async c => {
  const sid = c.req.param('sid');
  const viewer = c.req.query('viewer') ?? '';
  const sRows = await sql`
    SELECT s.*,
      (SELECT count(*) FROM syndicate_members m WHERE m.sid = s.sid) AS member_count,
      (SELECT count(*) FROM syndicate_members m WHERE m.sid = s.sid AND m.is_admin) AS admin_count,
      (SELECT count(*) FROM bits b WHERE b.syndicate = s.sid) AS bit_count,
      (SELECT profile_hash FROM profiles WHERE key = s.sid) AS profile_hash
    FROM syndicates s WHERE s.sid = ${sid}
  `;
  if (sRows.length === 0) return c.json({ error: 'not_found' }, 404);
  const members = await sql`
    SELECT m.address, m.is_admin, m.joined_at, u.username
    FROM syndicate_members m
    LEFT JOIN users u ON u.address = m.address
    WHERE m.sid = ${sid}
    ORDER BY m.is_admin DESC, m.joined_at ASC
  `;
  const bits = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      s.name AS syndicate_name,
      (SELECT count(*) FROM nft_editions ne WHERE ne.bid = b.bid) AS nft_edition_count,
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    LEFT JOIN syndicates s ON s.sid = b.syndicate
    LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
    WHERE b.syndicate = ${sid}
    ORDER BY b.creation_time DESC
    LIMIT 50
  `;
  return c.json({
    syndicate: formatSyndicate(sRows[0]),
    members: members.map(m => ({
      address: m.address,
      username: m.username ?? null,
      is_admin: m.is_admin,
      joined_at: m.joined_at,
    })),
    bits: bits.map(formatBit),
  });
});

app.get('/api/users/:address/syndicates', async c => {
  const address = c.req.param('address');
  const rows = await sql`
    SELECT s.*, m.is_admin
    FROM syndicate_members m
    JOIN syndicates s ON s.sid = m.sid
    WHERE m.address = ${address}
    ORDER BY s.creation_time DESC
  `;
  return c.json({ syndicates: rows.map(r => ({ ...formatSyndicate(r), is_admin: r.is_admin })) });
});

function formatSyndicate(row) {
  return {
    sid: row.sid,
    name: row.name,
    bio: row.bio,
    creator: row.creator,
    creation_time: row.creation_time,
    member_count: Number(row.member_count ?? 0),
    admin_count: Number(row.admin_count ?? 0),
    bit_count: Number(row.bit_count ?? 0),
    profile_hash: row.profile_hash ?? null,
  };
}

function formatPetition(row) {
  let payload = row.action_payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {}
  }
  let myVote = null;
  if (row.my_vote === true) myVote = 'up';
  else if (row.my_vote === false) myVote = 'down';
  return {
    pid: row.pid,
    creator: row.creator,
    creator_username: row.creator_username,
    action_type: row.action_type,
    action_payload: payload,
    creation_time: row.creation_time,
    closes_at: row.closes_at,
    yay: Number(row.yay),
    nay: Number(row.nay),
    unique_voters: Number(row.unique_voters),
    resolved: row.resolved,
    passed: row.passed,
    my_vote: myVote,
    my_votes: row.my_votes !== null && row.my_votes !== undefined ? Number(row.my_votes) : null,
  };
}

function formatBit(row) {
  const contentModerated = Boolean(row.content_moderated);
  const creatorModerated = Boolean(row.creator_moderated);
  const suppressed = contentModerated || creatorModerated;
  let myVote = null;
  if (row.my_vote === true) myVote = 'up';
  else if (row.my_vote === false) myVote = 'down';
  return {
    bid: row.bid,
    creator: row.creator,
    creator_username: row.username ?? null,
    content_hash: row.content_hash,
    content: suppressed ? null : (row.body ? row.body.toString('utf8') : null),
    content_type: suppressed ? null : (row.content_type ?? null),
    parent: row.parent,
    syndicate: row.syndicate,
    syndicate_name: row.syndicate_name ?? null,
    nft_edition_count: Number(row.nft_edition_count ?? 0),
    creation_time: row.creation_time,
    yay: Number(row.yay),
    nay: Number(row.nay),
    content_moderated: contentModerated,
    creator_moderated: creatorModerated,
    my_vote: myVote,
    my_votes: row.my_votes !== null && row.my_votes !== undefined ? Number(row.my_votes) : null,
  };
}

console.log(`API listening on :${PORT}`);
serve({ fetch: app.fetch, port: Number(PORT) });
