import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import blake from 'blakejs';

const {
  DATABASE_URL,
  PORT = '8080',
  RPC_URL = 'https://rpc.shadownet.teztnets.com',
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

app.get('/health', c => c.json({ ok: true }));

app.get('/api/config', c => c.json({
  rpcUrl: RPC_URL,
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
  const bytes = new TextEncoder().encode(body.body);
  const hashBytes = blake.blake2b(bytes, null, 32);
  const hash = Buffer.from(hashBytes).toString('hex');

  await sql`
    INSERT INTO content (hash, body, content_type)
    VALUES (${hash}, ${Buffer.from(bytes)}, ${contentType})
    ON CONFLICT (hash) DO NOTHING
  `;
  return c.json({ hash });
});

app.get('/api/content/:hash', async c => {
  const hash = c.req.param('hash');
  const modCheck = await sql`SELECT 1 FROM moderated_content WHERE content_hash = ${hash}`;
  if (modCheck.length > 0) {
    return c.json({ error: 'moderated', hash }, 451);
  }
  const rows = await sql`SELECT body, content_type FROM content WHERE hash = ${hash}`;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  const row = rows[0];
  return c.json({
    hash,
    body: row.body.toString('utf8'),
    content_type: row.content_type,
  });
});

// --- Bits ---

app.get('/api/bits', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const before = c.req.query('before');
  const rows = before
    ? await sql`
        SELECT b.*, c.body, c.content_type, u.username, u.bio,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
        WHERE b.creation_time < ${before}
          AND NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
          AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
        ORDER BY b.creation_time DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT b.*, c.body, c.content_type, u.username, u.bio,
          false AS content_moderated, false AS creator_moderated
        FROM bits b
        LEFT JOIN content c ON c.hash = b.content_hash
        LEFT JOIN users u ON u.address = b.creator
        WHERE NOT EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash)
          AND NOT EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator)
        ORDER BY b.creation_time DESC
        LIMIT ${limit}
      `;
  return c.json({ bits: rows.map(formatBit) });
});

app.get('/api/bits/:bid', async c => {
  const bid = c.req.param('bid');
  const rows = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    WHERE b.bid = ${bid}
  `;
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);

  const replies = await sql`
    SELECT b.*, c.body, c.content_type, u.username, u.bio,
      EXISTS (SELECT 1 FROM moderated_content mc WHERE mc.content_hash = b.content_hash) AS content_moderated,
      EXISTS (SELECT 1 FROM moderated_users mu WHERE mu.address = b.creator) AS creator_moderated
    FROM bits b
    LEFT JOIN content c ON c.hash = b.content_hash
    LEFT JOIN users u ON u.address = b.creator
    WHERE b.parent = ${bid}
    ORDER BY b.creation_time ASC
  `;
  const votes = await sql`
    SELECT voter, direction, votes, vote_time FROM votes WHERE bid = ${bid} ORDER BY vote_time DESC
  `;

  return c.json({
    bit: formatBit(rows[0]),
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
  const rows = await sql`
    SELECT p.*, u.username AS creator_username
    FROM petitions p
    LEFT JOIN users u ON u.address = p.creator
    ORDER BY p.creation_time DESC
    LIMIT ${limit}
  `;
  return c.json({ petitions: rows.map(formatPetition) });
});

app.get('/api/petitions/:pid', async c => {
  const pid = c.req.param('pid');
  const rows = await sql`
    SELECT p.*, u.username AS creator_username
    FROM petitions p
    LEFT JOIN users u ON u.address = p.creator
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
  };
}

function formatBit(row) {
  const contentModerated = Boolean(row.content_moderated);
  const creatorModerated = Boolean(row.creator_moderated);
  const suppressed = contentModerated || creatorModerated;
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
  };
}

console.log(`API listening on :${PORT}`);
serve({ fetch: app.fetch, port: Number(PORT) });
