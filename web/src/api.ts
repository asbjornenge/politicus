export type Bit = {
  bid: string;
  creator: string;
  creator_username: string | null;
  content_hash: string;
  content: string | null;
  content_type: string | null;
  parent: string | null;
  syndicate: string | null;
  creation_time: string;
  yay: number;
  nay: number;
};

export type Config = {
  rpcUrl: string;
  contracts: {
    Variables: string;
    Treasury: string;
    IdentityRegistry: string;
    BitRegistry: string;
  };
};

export async function getConfig(): Promise<Config> {
  const r = await fetch('/api/config');
  return r.json();
}

export async function postContent(body: string, contentType = 'text/plain'): Promise<string> {
  const r = await fetch('/api/content', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body, content_type: contentType }),
  });
  if (!r.ok) throw new Error(`content upload failed: ${r.status}`);
  const { hash } = await r.json();
  return hash;
}

export async function listBits(): Promise<Bit[]> {
  const r = await fetch('/api/bits');
  const { bits } = await r.json();
  return bits;
}

export async function getUser(address: string) {
  const r = await fetch(`/api/users/${address}`);
  if (!r.ok) return null;
  const { user } = await r.json();
  return user as { address: string; username: string; bio: string; brightid_hash: string };
}
