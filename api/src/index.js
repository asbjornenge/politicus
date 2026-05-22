import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import postgres from 'postgres';

const {
  DATABASE_URL,
  PORT = '8080',
  RPC_URL = 'https://rpc.shadownet.teztnets.com',
  FAUCET_URL = '',
  IPFS_UPLOAD_URL = 'http://localhost:5001',
  IPFS_GATEWAY_URL = 'http://localhost:8080',
  VARIABLES_ADDRESS,
  TREASURY_ADDRESS,
  IDENTITY_REGISTRY,
  BIT_REGISTRY,
  PETITION_REGISTRY,
  MODERATION_REGISTRY,
} = process.env;

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
  if (!VARIABLES_ADDRESS) return c.json({ values: {} });
  try {
    const r = await fetch(`${TZKT_API_URL}/v1/contracts/${VARIABLES_ADDRESS}/bigmaps/values/keys?active=true&limit=200`);
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

app.get('/api/config', c => c.json({
  rpcUrl: RPC_URL,
  faucetUrl: FAUCET_URL || null,
  contracts: {
    Variables: VARIABLES_ADDRESS,
    Treasury: TREASURY_ADDRESS,
    IdentityRegistry: IDENTITY_REGISTRY,
    BitRegistry: BIT_REGISTRY,
    PetitionRegistry: PETITION_REGISTRY,
    ModerationRegistry: MODERATION_REGISTRY,
  },
}));

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
          v.direction AS my_vote, v.votes AS my_votes,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
        LEFT JOIN votes v ON v.bid = b.bid AND v.voter = ${viewer}
        WHERE b.creation_time < ${before}
          AND NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
          AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
        ORDER BY b.creation_time DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT b.*, c.body, c.content_type, u.username, u.bio,
          v.direction AS my_vote, v.votes AS my_votes,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
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
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
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
      v.direction AS my_vote, v.votes AS my_votes,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
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
  const bitRows = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    WHERE b.creator = ${address}
    ORDER BY b.creation_time DESC
    LIMIT 50
  `;
  return c.json({
    user: { ...userRows[0], moderated: moderated.length > 0 },
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
