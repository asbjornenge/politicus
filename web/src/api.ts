export type Bit = {
  bid: string;
  creator: string;
  creator_username: string | null;
  content_hash: string;
  content: string | null;
  content_type: string | null;
  parent: string | null;
  syndicate: string | null;
  syndicate_name: string | null;
  nft_edition_count: number;
  creation_time: string;
  yay: number;
  nay: number;
  content_moderated: boolean;
  creator_moderated: boolean;
  my_vote: 'up' | 'down' | null;
  my_votes: number | null;
};

export type Config = {
  rpcUrl: string;
  faucetUrl: string | null;
  ipfsGateway: string;
  contracts: {
    Variables: string;
    Treasury: string;
    IdentityRegistry: string;
    BitRegistry: string;
    PetitionRegistry: string;
    ModerationRegistry: string;
    SyndicateRegistry?: string;
    ProfileRegistry?: string;
    BitNFTFactory?: string;
  };
};

export type NFTCollection = {
  address: string;
  owner_kind: 'user' | 'syndicate';
  owner_address: string | null;
  owner_sid: string | null;
  payout: string | null;
  registered_at: string;
};

export type NFTEdition = {
  collection_address: string;
  token_id: number;
  bid: string;
  total_editions: number;
  mint_price: number;        // mutez
  royalty_bps: number;
  treasury_primary_bps: number;
  treasury_secondary_bps: number;
  sold: number;
  created_at: string;
  owner_kind: 'user' | 'syndicate';
  owner_address: string | null;
  owner_sid: string | null;
};

export type NFTOwnedToken = {
  collection_address: string;
  token_id: number;
  balance: number;
  bid: string;
  total_editions: number;
  sold: number;
  mint_price: number;
  owner_kind: 'user' | 'syndicate';
  owner_address: string | null;
  owner_sid: string | null;
  bit_creator: string | null;
  bit_creator_username: string | null;
  bit_syndicate: string | null;
  bit_syndicate_name: string | null;
  bit_creation_time: string | null;
  bit_content: string | null;
};

export type Syndicate = {
  sid: string;
  name: string;
  bio: string;
  creator: string;
  creation_time: string;
  member_count: number;
  admin_count: number;
  bit_count: number;
  profile_hash: string | null;
};

export type SyndicateMember = {
  address: string;
  username: string | null;
  is_admin: boolean;
  joined_at: string;
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
  my_votes: number | null;
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

export type ProfileLink = { name: string; url: string };
export type ProfileDoc = {
  version: 1;
  username?: string;
  name?: string;
  bio?: string;
  avatar?: string;
  tagline?: string;
  location?: string;
  links?: ProfileLink[];
};

export type User = {
  address: string;
  username: string;
  bio: string;
  brightid_hash: string;
  moderated: boolean;
  profile_hash: string | null;
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

export async function listSyndicates(): Promise<Syndicate[]> {
  const r = await fetch('/api/syndicates');
  if (!r.ok) return [];
  const { syndicates } = await r.json();
  return syndicates;
}

export type SyndicateDetail = {
  syndicate: Syndicate;
  members: SyndicateMember[];
  bits: Bit[];
};

export async function getSyndicate(sid: string, viewer?: string): Promise<SyndicateDetail | null> {
  const q = viewer ? `?viewer=${viewer}` : '';
  const r = await fetch(`/api/syndicates/${sid}${q}`);
  if (!r.ok) return null;
  return r.json();
}

export async function postProfile(doc: ProfileDoc): Promise<string> {
  const r = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`profile upload failed: ${t}`);
  }
  const { hash } = await r.json();
  return hash;
}

export async function getProfileDoc(hash: string): Promise<ProfileDoc | null> {
  const r = await fetch(`/api/content/${hash}`);
  if (!r.ok) return null;
  const { body } = await r.json();
  try { return JSON.parse(body); } catch { return null; }
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: form });
  if (!r.ok) throw new Error('image upload failed');
  const { cid } = await r.json();
  return cid;
}

export async function getMyCollection(address: string): Promise<NFTCollection | null> {
  const r = await fetch(`/api/nft/collections/by-user/${address}`);
  if (!r.ok) return null;
  const { collection } = await r.json();
  return collection;
}

export async function getSyndicateCollection(sid: string): Promise<NFTCollection | null> {
  const r = await fetch(`/api/nft/collections/by-syndicate/${sid}`);
  if (!r.ok) return null;
  const { collection } = await r.json();
  return collection;
}

export async function getEditionsForBit(bid: string): Promise<NFTEdition[]> {
  const r = await fetch(`/api/nft/editions/by-bit/${bid}`);
  if (!r.ok) return [];
  const { editions } = await r.json();
  return editions;
}

export async function getOwnedTokens(address: string): Promise<NFTOwnedToken[]> {
  const r = await fetch(`/api/nft/owned/${address}`);
  if (!r.ok) return [];
  const { tokens } = await r.json();
  return tokens;
}

export type IssueLayoutItem = { bit_id: string; headline: string };
export type IssueSection = { name: string; items: IssueLayoutItem[] };
export type IssueLayout = {
  title: string;
  intro: string;
  lead: IssueLayoutItem;
  sections: IssueSection[];
};

export type IssueSummary = {
  id: string;
  title: string;
  intro: string | null;
  time_window_start: string;
  time_window_end: string;
  filter_query: string | null;
  filter_syndicate: string | null;
  creator: string | null;
  created_at: string;
};

export type IssueBitRef = {
  bid: string;
  creator: string;
  creator_username: string | null;
  syndicate: string | null;
  syndicate_name: string | null;
  creation_time: string;
  content: string | null;
};

export type IssueDetail = {
  id: string;
  title: string;
  intro: string | null;
  layout_json: IssueLayout;
  bit_ids: string[];
  time_window_start: string;
  time_window_end: string;
  filter_query: string | null;
  filter_syndicate: string | null;
  creator: string | null;
  created_at: string;
  bits: Record<string, IssueBitRef>;
};

export async function listIssues(limit = 20): Promise<IssueSummary[]> {
  const r = await fetch(`/api/issues?limit=${limit}`);
  if (!r.ok) return [];
  const { issues } = await r.json();
  return issues;
}

export async function getIssue(id: string): Promise<IssueDetail | null> {
  const r = await fetch(`/api/issues/${id}`);
  if (!r.ok) return null;
  const { issue } = await r.json();
  return issue;
}

export async function getDefaultIssueId(): Promise<string | null> {
  const r = await fetch(`/api/issues/default`);
  if (!r.ok) return null;
  const { id } = await r.json();
  return id ?? null;
}

export async function generateIssue(params: {
  window_days?: number;
  query?: string;
  syndicate?: string;
  creator?: string;
}): Promise<{ id: string; layout: IssueLayout } | { error: string; detail?: string }> {
  const r = await fetch('/api/issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({ error: `http ${r.status}` }));
    return j;
  }
  return r.json();
}

export async function listMySyndicates(address: string): Promise<Array<Syndicate & { is_admin: boolean }>> {
  const r = await fetch(`/api/users/${address}/syndicates`);
  if (!r.ok) return [];
  const { syndicates } = await r.json();
  return syndicates;
}
