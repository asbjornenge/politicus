import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Building2, Users, ChevronUp, ChevronDown, Flag, Shield, MapPin, Link as LinkIcon, X as XIcon } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, SyndicateDetail, ProfileDoc, ProfileLink } from '../api';
import { getSyndicate, getProfileDoc, postProfile, uploadImage } from '../api';
import { sendUpdateSyndicateProfile } from '../tezos';
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
      </div>

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>members</h3>
      <div className="bit" style={{ padding: 12 }}>
        {members.map(m => (
          <div key={m.address} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
            <Link to={`/user/${m.address}`} style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {m.is_admin && <Shield size={12} style={{ color: 'var(--accent-soft)' }} />}
              <span>{m.username ?? m.address.slice(0, 12) + '…'}</span>
            </Link>
            <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{m.address.slice(0, 12)}…</span>
          </div>
        ))}
      </div>

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
