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
};

export type Config = {
  rpcUrl: string;
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

export type BitDetail = {
  bit: Bit;
  replies: Bit[];
  votes: Array<{ voter: string; direction: boolean; votes: number; vote_time: string }>;
};

export async function getBit(bid: string): Promise<BitDetail | null> {
  const r = await fetch(`/api/bits/${bid}`);
  if (!r.ok) return null;
  return r.json();
}

export async function getPetition(pid: string): Promise<Petition | null> {
  const r = await fetch(`/api/petitions/${pid}`);
  if (!r.ok) return null;
  const { petition } = await r.json();
  return petition;
}

export async function listPetitions(): Promise<Petition[]> {
  const r = await fetch('/api/petitions');
  const { petitions } = await r.json();
  return petitions;
}

export async function getUser(address: string) {
  const r = await fetch(`/api/users/${address}`);
  if (!r.ok) return null;
  const { user } = await r.json();
  return user as { address: string; username: string; bio: string; brightid_hash: string };
}
