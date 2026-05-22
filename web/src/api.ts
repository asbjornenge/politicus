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
  content_moderated: boolean;
  creator_moderated: boolean;
  my_vote: 'up' | 'down' | null;
};

export type Config = {
  rpcUrl: string;
  faucetUrl: string | null;
  contracts: {
    Variables: string;
    Treasury: string;
    IdentityRegistry: string;
    BitRegistry: string;
    PetitionRegistry: string;
    ModerationRegistry: string;
  };
};

export type Petition = {
  pid: string;
  creator: string;
  creator_username: string | null;
  action_type: string;
  action_payload: any;
  creation_time: string;
  closes_at: string;
  yay: number;
  nay: number;
  unique_voters: number;
  resolved: boolean;
  passed: boolean;
  my_vote: 'up' | 'down' | null;
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

export async function listBits(viewer?: string): Promise<Bit[]> {
  const q = viewer ? `?viewer=${viewer}` : '';
  const r = await fetch(`/api/bits${q}`);
  const { bits } = await r.json();
  return bits;
}

export type BitDetail = {
  bit: Bit;
  ancestors: Bit[];
  replies: Bit[];
  votes: Array<{ voter: string; direction: boolean; votes: number; vote_time: string }>;
};

export async function getBit(bid: string, viewer?: string): Promise<BitDetail | null> {
  const q = viewer ? `?viewer=${viewer}` : '';
  const r = await fetch(`/api/bits/${bid}${q}`);
  if (!r.ok) return null;
  return r.json();
}

export async function getPetition(pid: string, viewer?: string): Promise<Petition | null> {
  const q = viewer ? `?viewer=${viewer}` : '';
  const r = await fetch(`/api/petitions/${pid}${q}`);
  if (!r.ok) return null;
  const { petition } = await r.json();
  return petition;
}

export async function listPetitions(viewer?: string): Promise<Petition[]> {
  const q = viewer ? `?viewer=${viewer}` : '';
  const r = await fetch(`/api/petitions${q}`);
  const { petitions } = await r.json();
  return petitions;
}

export type User = {
  address: string;
  username: string;
  bio: string;
  brightid_hash: string;
  moderated: boolean;
};

export async function getUser(address: string): Promise<{ user: User; bits: Bit[] } | null> {
  const r = await fetch(`/api/users/${address}`);
  if (!r.ok) return null;
  return r.json();
}

export async function getKernelVars(): Promise<Record<string, string>> {
  const r = await fetch('/api/kernel-vars');
  if (!r.ok) return {};
  const { values } = await r.json();
  return values ?? {};
}
