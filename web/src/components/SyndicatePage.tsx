import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Building2, Users, ChevronUp, ChevronDown, Flag, Shield, MapPin, Link as LinkIcon, X as XIcon, UserPlus, ShieldOff, Loader2, Coins } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, SyndicateDetail, SyndicateMember, ProfileDoc, ProfileLink, NFTCollection } from '../api';
import { getSyndicate, getProfileDoc, postProfile, uploadImage, getSyndicateCollection } from '../api';
import {
  sendUpdateSyndicateProfile, sendAddMember, sendRemoveMember,
  sendPromoteAdmin, sendDemoteAdmin, sendSetPayout,
} from '../tezos';
import { formatBitDate } from '../utils';
import { Markdown } from './Markdown';
import { Avatar } from './Avatar';

export function SyndicatePage({ tezos, cfg, address }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
}) {
  const { sid } = useParams<{ sid: string }>();
  const [data, setData] = useState<SyndicateDetail | null>(null);
  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  async function reload() {
    if (!sid) return;
    setLoading(true);
    try {
      const d = await getSyndicate(sid, address ?? undefined);
      setData(d);
      if (d?.syndicate.profile_hash) {
        setProfile(await getProfileDoc(d.syndicate.profile_hash));
      } else {
        setProfile(null);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); setEditing(false); }, [sid, address]);

  if (loading && !data) return <p className="muted">loading…</p>;
  if (!data) return <p className="muted">syndicate not found.</p>;

  const { syndicate: s, members, bits } = data;
  const isMember = address && members.some(m => m.address === address);
  const isAdmin = address && members.some(m => m.address === address && m.is_admin);

  return (
    <div>
      <div className="bit">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Avatar cid={profile?.avatar ?? null} gateway={cfg.ipfsGateway} size={64} kind="syndicate" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="meta">
              <span className="creator" style={{ fontSize: 18, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={16} /> {s.name}
              </span>
              {isAdmin ? (
                <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Shield size={12} /> admin
                </span>
              ) : isMember ? (
                <span className="muted" style={{ fontSize: 12 }}>member</span>
              ) : null}
            </div>
            {profile?.tagline && (
              <div style={{ fontFamily: 'var(--font-italic)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                {profile.tagline}
              </div>
            )}
          </div>
        </div>
        {s.bio && <div className="content" style={{ marginTop: 12 }}><Markdown>{s.bio}</Markdown></div>}
        {(profile?.location || (profile?.links && profile.links.length > 0)) && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
            {profile.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {profile.location}</span>}
            {profile.links?.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-soft)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <LinkIcon size={12} /> {l.name}
              </a>
            ))}
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 12, display: 'flex', gap: 14 }}>
          <span><Users size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{s.member_count} members ({s.admin_count} admin)</span>
          <span>{s.bit_count} bits</span>
        </div>
        {isAdmin && !editing && tezos && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setEditing(true)}>edit profile</button>
          </div>
        )}
        {isAdmin && editing && tezos && (
          <EditSyndicateProfile
            tezos={tezos}
            cfg={cfg}
            sid={s.sid}
            currentName={s.name}
            currentBio={s.bio}
            current={profile}
            onDone={() => { setEditing(false); setTimeout(reload, 4000); }}
            onCancel={() => setEditing(false)}
          />
        )}
        {isAdmin && tezos && <PayoutControl tezos={tezos} sid={s.sid} />}
      </div>

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>members</h3>
      <MemberList
        tezos={tezos}
        cfg={cfg}
        sid={s.sid}
        members={members}
        isAdmin={!!isAdmin}
        callerAddress={address}
        adminCount={s.admin_count}
        onChange={() => setTimeout(reload, 4000)}
      />

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>
        bits ({bits.length})
      </h3>
      {bits.length === 0 && <p className="muted">no bits published under this syndicate yet.</p>}
      {bits.map(b => (
        <Link key={b.bid} to={`/bit/${b.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span className="creator">{b.creator_username ?? b.creator.slice(0, 12) + '…'}</span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <span title={new Date(b.creation_time).toLocaleString()}>{formatBitDate(b.creation_time)}</span>
                <ChevronUp size={14} /> {b.yay} <ChevronDown size={14} /> {b.nay}
              </span>
            </div>
            <div className="content">
              {b.content_moderated || b.creator_moderated ? (
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Flag size={14} /> moderated
                </span>
              ) : b.content ? (
                <Markdown truncate>{b.content}</Markdown>
              ) : (
                <span className="muted">no content</span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function PayoutControl({ tezos, sid }: { tezos: TezosToolkit; sid: string }) {
  const [collection, setCollection] = useState<NFTCollection | null>(null);
  const [newPayout, setNewPayout] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  const currentPayout = collection?.payout ?? null;

  async function reload() {
    setCollection(await getSyndicateCollection(sid));
  }

  useEffect(() => { reload(); }, [sid]);

  async function save() {
    if (!newPayout.trim().startsWith('tz') && !newPayout.trim().startsWith('KT')) {
      setErr('payout must be a tz1/tz2/tz3 or KT1 address');
      return;
    }
    if (!collection) return;
    setBusy(true); setErr(''); setStatus('signing transaction…');
    try {
      const op = await sendSetPayout(tezos, collection.address, newPayout.trim());
      setStatus(`in mempool (${op.hash.slice(0, 10)}…)`);
      await op.confirmation();
      setStatus('waiting for view…');
      setTimeout(async () => { await reload(); setStatus(''); setNewPayout(''); }, 3000);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setStatus('');
    } finally { setBusy(false); }
  }

  if (!collection) {
    return (
      <details style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Coins size={13} /> NFT payout
        </summary>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          No NFT collection registered for this syndicate yet. As soon as a syndicate admin mints the first edition,
          the collection contract is originated and you can set the payout address here. Until then, sales of any
          syndicate-tagged edition default to Treasury.
        </p>
      </details>
    );
  }

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Coins size={13} /> NFT payout
        {currentPayout
          ? <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>· {currentPayout.slice(0, 12)}…</span>
          : <span style={{ fontSize: 11, color: 'var(--error)' }}>· not set (proceeds → Treasury)</span>}
      </summary>
      <div style={{ marginTop: 10 }}>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>
          Where the creator share of each primary sale on this syndicate's NFT collection is sent.
          Typically a multisig the syndicate controls — but any tz1/tz2/tz3 or KT1 address works. The platform's
          snapshot fee always goes to Treasury separately.
        </p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            style={{
              flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
              color: 'inherit', padding: 6, borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12,
            }}
            placeholder="tz1… or KT1…"
            value={newPayout}
            onChange={e => setNewPayout(e.target.value)}
            disabled={busy}
          />
          <button onClick={save} disabled={busy || !newPayout.trim()}>
            {busy ? <Loader2 size={14} className="spinner" /> : 'save'}
          </button>
        </div>
        {status && <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>{status}</div>}
        {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}
        <div className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', marginTop: 8, wordBreak: 'break-all' }}>
          collection: {collection.address}
        </div>
      </div>
    </details>
  );
}

function MemberList({
  tezos, cfg, sid, members, isAdmin, callerAddress, adminCount, onChange,
}: {
  tezos: TezosToolkit | null;
  cfg: Config;
  sid: string;
  members: SyndicateMember[];
  isAdmin: boolean;
  callerAddress: string | null;
  adminCount: number;
  onChange: () => void;
}) {
  const [busyOn, setBusyOn] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [newAddr, setNewAddr] = useState('');
  const [err, setErr] = useState('');

  async function withBusy(key: string, fn: () => Promise<any>) {
    if (!tezos) return;
    setErr('');
    setBusyOn(key);
    setStatus('preparing…');
    try {
      setStatus('signing transaction…');
      const op = await fn();
      setStatus(`in mempool (${op.hash.slice(0, 10)}…)`);
      await op.confirmation();
      setStatus('waiting for indexer…');
      onChange();
      setTimeout(() => setStatus(''), 4000);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setStatus('');
    } finally {
      setBusyOn(null);
    }
  }

  async function addMember() {
    if (!newAddr.trim().startsWith('tz')) { setErr('address must start with tz1/tz2/tz3'); return; }
    await withBusy(`add:${newAddr}`, () => sendAddMember(tezos!, cfg, sid, newAddr.trim()));
    setNewAddr('');
    setAdding(false);
  }

  return (
    <div className="bit" style={{ padding: 12 }}>
      {members.map(m => {
        const isLastAdmin = m.is_admin && adminCount === 1;
        const isSelf = m.address === callerAddress;
        return (
          <div key={m.address} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            <Link to={`/user/${m.address}`} style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              {m.is_admin && <Shield size={12} style={{ color: 'var(--accent-soft)', flexShrink: 0 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.username ?? m.address.slice(0, 12) + '…'}</span>
            </Link>
            <span className="muted hide-mobile" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', marginRight: 8 }}>{m.address.slice(0, 12)}…</span>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 4 }}>
                {m.is_admin ? (
                  <button
                    className="secondary icon-only"
                    onClick={() => withBusy(`demote:${m.address}`, () => sendDemoteAdmin(tezos!, cfg, sid, m.address))}
                    disabled={busyOn !== null || isLastAdmin}
                    title={isLastAdmin ? 'cannot demote the only admin' : 'demote to member'}
                  >
                    {busyOn === `demote:${m.address}` ? <Loader2 size={12} className="spinner" /> : <ShieldOff size={12} />}
                  </button>
                ) : (
                  <button
                    className="secondary icon-only"
                    onClick={() => withBusy(`promote:${m.address}`, () => sendPromoteAdmin(tezos!, cfg, sid, m.address))}
                    disabled={busyOn !== null}
                    title="promote to admin"
                  >
                    {busyOn === `promote:${m.address}` ? <Loader2 size={12} className="spinner" /> : <Shield size={12} />}
                  </button>
                )}
                <button
                  className="secondary icon-only"
                  onClick={() => withBusy(`remove:${m.address}`, () => sendRemoveMember(tezos!, cfg, sid, m.address))}
                  disabled={busyOn !== null || isLastAdmin || isSelf}
                  title={isLastAdmin ? 'cannot remove the only admin' : isSelf ? 'cannot remove yourself' : 'remove member'}
                >
                  {busyOn === `remove:${m.address}` ? <Loader2 size={12} className="spinner" /> : <XIcon size={12} />}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {isAdmin && (
        <div style={{ marginTop: 10 }}>
          {adding ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                  color: 'inherit', padding: 6, borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12,
                }}
                placeholder="tz1..."
                value={newAddr}
                onChange={e => setNewAddr(e.target.value)}
                disabled={busyOn !== null}
                autoFocus
              />
              <button onClick={addMember} disabled={busyOn !== null || !newAddr.trim()}>
                {busyOn?.startsWith('add:') ? <Loader2 size={14} className="spinner" /> : 'add'}
              </button>
              <button className="secondary" onClick={() => { setAdding(false); setNewAddr(''); setErr(''); }} disabled={busyOn !== null}>cancel</button>
            </div>
          ) : (
            <button className="secondary" onClick={() => setAdding(true)} disabled={busyOn !== null}>
              <UserPlus size={12} /> add member
            </button>
          )}
        </div>
      )}
      {status && <div className="muted" style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic' }}>{status}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function EditSyndicateProfile({
  tezos, cfg, sid, currentName, currentBio, current, onDone, onCancel,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  sid: string;
  currentName: string;
  currentBio: string;
  current: ProfileDoc | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState<string>(current?.name ?? currentName);
  const [bio, setBio] = useState<string>(current?.bio ?? currentBio);
  const [avatar, setAvatar] = useState<string | undefined>(current?.avatar);
  const [tagline, setTagline] = useState<string>(current?.tagline ?? '');
  const [location, setLocation] = useState<string>(current?.location ?? '');
  const [links, setLinks] = useState<ProfileLink[]>(current?.links ?? []);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  async function pickAvatar(file: File) {
    setUploading(true); setErr('');
    try { setAvatar(await uploadImage(file)); }
    catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!name.trim()) { setErr('name cannot be empty'); return; }
    setBusy(true); setErr('');
    try {
      const doc: ProfileDoc = { version: 1, name: name.trim() };
      if (bio.trim()) doc.bio = bio.trim();
      if (avatar) doc.avatar = avatar;
      if (tagline.trim()) doc.tagline = tagline.trim();
      if (location.trim()) doc.location = location.trim();
      const cleanLinks = links.filter(l => l.name.trim() && l.url.trim());
      if (cleanLinks.length > 0) doc.links = cleanLinks;
      setStatus('uploading profile…');
      const hash = await postProfile(doc);
      setStatus('signing transaction…');
      const op = await sendUpdateSyndicateProfile(tezos, cfg, sid, hash);
      setStatus(`in mempool (${op.hash.slice(0, 10)}…)`);
      await op.confirmation();
      setStatus('confirmed, waiting for indexer…');
      onDone();
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    color: 'inherit',
    padding: 6,
    borderRadius: 4,
    fontFamily: 'inherit',
    marginBottom: 8,
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
        <Avatar cid={avatar ?? null} gateway={cfg.ipfsGateway} size={64} kind="syndicate" />
        <label style={{ cursor: 'pointer' }}>
          <span className="secondary" style={{ display: 'inline-block', padding: '6px 12px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 13 }}>
            {uploading ? 'uploading…' : (avatar ? 'replace logo' : 'upload logo')}
          </span>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) pickAvatar(f); }}
            disabled={uploading || busy}
          />
        </label>
        {avatar && <button className="secondary" onClick={() => setAvatar(undefined)} disabled={busy}>remove</button>}
      </div>
      <input
        style={fieldStyle}
        placeholder="syndicate name (required)"
        value={name}
        onChange={e => setName(e.target.value.slice(0, 60))}
        disabled={busy}
      />
      <textarea
        style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' as const }}
        placeholder="bio / mission (markdown ok)"
        value={bio}
        onChange={e => setBio(e.target.value.slice(0, 1000))}
        disabled={busy}
      />
      <input
        style={fieldStyle}
        placeholder="tagline (≤140 chars)"
        value={tagline}
        onChange={e => setTagline(e.target.value.slice(0, 140))}
        disabled={busy}
      />
      <input
        style={fieldStyle}
        placeholder="location (e.g. Oslo)"
        value={location}
        onChange={e => setLocation(e.target.value.slice(0, 100))}
        disabled={busy}
      />
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Links</div>
      {links.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            style={{ ...fieldStyle, flex: 1, marginBottom: 0 }}
            placeholder="name"
            value={l.name}
            onChange={e => setLinks(ls => ls.map((x, j) => j === i ? { ...x, name: e.target.value.slice(0, 60) } : x))}
            disabled={busy}
          />
          <input
            style={{ ...fieldStyle, flex: 2, marginBottom: 0 }}
            placeholder="https://..."
            value={l.url}
            onChange={e => setLinks(ls => ls.map((x, j) => j === i ? { ...x, url: e.target.value.slice(0, 500) } : x))}
            disabled={busy}
          />
          <button className="secondary icon-only" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))} disabled={busy} title="remove">
            <XIcon size={12} />
          </button>
        </div>
      ))}
      {links.length < 20 && (
        <button
          className="secondary"
          onClick={() => setLinks(ls => [...ls, { name: '', url: '' }])}
          disabled={busy}
          style={{ marginBottom: 12 }}
        >
          + link
        </button>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={busy || uploading}>{busy ? 'saving…' : 'save'}</button>
        <button onClick={onCancel} disabled={busy} className="secondary">cancel</button>
      </div>
      {status && <div className="muted" style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic' }}>{status}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
