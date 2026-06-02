import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag, X as XIcon, MapPin, Link as LinkIcon, Sparkles } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Bit, User, ProfileDoc, ProfileLink, NFTOwnedToken } from '../api';
import { getUser, getProfileDoc, postProfile, uploadImage, getOwnedTokens } from '../api';
import { registerUser, placeholderBrightIdHash, loadSecretKey, sendUpdateUserProfile } from '../tezos';
import { formatBitDate, formatTez, LOW_BALANCE_TEZ } from '../utils';
import { Markdown } from './Markdown';
import { Avatar } from './Avatar';

export function ProfilePage({ tezos, cfg, address, balance }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  balance: number | null;
}) {
  const { address: target } = useParams<{ address: string }>();
  const [data, setData] = useState<{ user: User; bits: Bit[] } | null>(null);
  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [ownedTokens, setOwnedTokens] = useState<NFTOwnedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  async function reload() {
    if (!target) return;
    setLoading(true);
    try {
      const d = await getUser(target);
      setData(d);
      if (d?.user.profile_hash) {
        setProfile(await getProfileDoc(d.user.profile_hash));
      } else {
        setProfile(null);
      }
      if (target) setOwnedTokens(await getOwnedTokens(target));
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); setEditing(false); }, [target]);

  if (loading) return <p className="muted">loading…</p>;

  if (!data) {
    const isOwn = target === address;
    if (isOwn && tezos && target) {
      return <RegisterPrompt tezos={tezos} cfg={cfg} address={target} onDone={reload} faucetUrl={cfg.faucetUrl} />;
    }
    return (
      <div className="bit">
        <p className="muted">This address has no Politicus profile yet.</p>
        <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-faint)', wordBreak: 'break-all' }}>
          {target}
        </div>
      </div>
    );
  }

  const isOwn = target === address;
  const u = data.user;

  return (
    <div>
      <div className="bit">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Avatar cid={profile?.avatar ?? null} gateway={cfg.ipfsGateway} size={64} kind="user" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="meta">
              <span className="creator" style={{ fontSize: 16 }}>{u.username}</span>
              {u.moderated && (
                <span className="error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Flag size={14} /> moderated
                </span>
              )}
            </div>
            {profile?.tagline && (
              <div style={{ fontFamily: 'var(--font-italic)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                {profile.tagline}
              </div>
            )}
          </div>
        </div>
        {u.bio && <div className="content" style={{ marginTop: 12 }}>{u.bio}</div>}
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
        <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 12, wordBreak: 'break-all' }}>
          {u.address}
        </div>
        {isOwn && !editing && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(true)}>edit profile</button>
          </div>
        )}
        {isOwn && editing && tezos && (
          <EditProfile
            tezos={tezos}
            cfg={cfg}
            user={u}
            current={profile}
            onDone={() => { setEditing(false); setTimeout(reload, 4000); }}
            onCancel={() => setEditing(false)}
          />
        )}
        {isOwn && balance !== null && <BalanceLine balance={balance} hasFaucet={!!cfg.faucetUrl} />}
        {isOwn && cfg.faucetUrl && <FaucetLink faucetUrl={cfg.faucetUrl} address={u.address} />}
        {isOwn && <BackupKey />}
      </div>

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>
        {data.bits.length} bit{data.bits.length === 1 ? '' : 's'}
      </h3>
      {data.bits.length === 0 && <p className="muted">no bits yet.</p>}
      {data.bits.map(b => (
        <Link key={b.bid} to={`/bit/${b.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span title={new Date(b.creation_time).toLocaleString()}>{formatBitDate(b.creation_time)}</span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ChevronUp size={14} /> {b.yay} <ChevronDown size={14} /> {b.nay}
              </span>
            </div>
            <div className="content">
              {b.content_moderated ? (
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

      {ownedTokens.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} /> Collection · {ownedTokens.length} edition{ownedTokens.length === 1 ? '' : 's'}
          </h3>
          {ownedTokens.map(t => (
            <Link key={`${t.collection_address}:${t.token_id}`} to={`/bit/${t.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="bit">
                <div className="meta">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={12} style={{ color: 'var(--accent-soft)' }} />
                    {t.balance > 1 ? `${t.balance}× edition #${t.token_id}` : `Edition #${t.token_id}`}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    by{' '}
                    {t.bit_syndicate
                      ? <span>{t.bit_syndicate_name ?? 'syndicate'}</span>
                      : <span>{t.bit_creator_username ?? (t.bit_creator?.slice(0, 12) + '…')}</span>
                    }
                  </span>
                </div>
                <div className="content">
                  {t.bit_content
                    ? <Markdown truncate>{t.bit_content}</Markdown>
                    : <span className="muted">content unavailable</span>}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  {t.sold}/{t.total_editions} sold
                </div>
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

function EditProfile({
  tezos, cfg, user, current, onDone, onCancel,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  user: User;
  current: ProfileDoc | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState<string>(current?.username ?? user.username);
  const [bio, setBio] = useState<string>(current?.bio ?? user.bio);
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
    try {
      const cid = await uploadImage(file);
      setAvatar(cid);
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!username.trim()) { setErr('username cannot be empty'); return; }
    setBusy(true); setErr('');
    try {
      const doc: ProfileDoc = { version: 1, username: username.trim() };
      if (bio.trim()) doc.bio = bio.trim();
      if (avatar) doc.avatar = avatar;
      if (tagline.trim()) doc.tagline = tagline.trim();
      if (location.trim()) doc.location = location.trim();
      const cleanLinks = links.filter(l => l.name.trim() && l.url.trim());
      if (cleanLinks.length > 0) doc.links = cleanLinks;
      setStatus('uploading profile…');
      const hash = await postProfile(doc);
      setStatus('signing transaction…');
      const op = await sendUpdateUserProfile(tezos, cfg, hash);
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
        <Avatar cid={avatar ?? null} gateway={cfg.ipfsGateway} size={64} kind="user" />
        <label style={{ cursor: 'pointer' }}>
          <span className="secondary" style={{ display: 'inline-block', padding: '6px 12px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 13 }}>
            {uploading ? 'uploading…' : (avatar ? 'replace avatar' : 'upload avatar')}
          </span>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) pickAvatar(f); }}
            disabled={uploading || busy}
          />
        </label>
        {avatar && (
          <button className="secondary" onClick={() => setAvatar(undefined)} disabled={busy}>remove</button>
        )}
      </div>
      <input
        style={fieldStyle}
        placeholder="username (required)"
        value={username}
        onChange={e => setUsername(e.target.value.slice(0, 30))}
        disabled={busy}
      />
      <textarea
        style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' as const }}
        placeholder="bio (markdown ok)"
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

function BalanceLine({ balance, hasFaucet }: { balance: number; hasFaucet: boolean }) {
  const low = balance < LOW_BALANCE_TEZ;
  return (
    <div style={{
      marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Balance</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 15,
        color: low ? 'var(--error)' : 'var(--text)',
      }}>
        {formatTez(balance)} ꜩ
      </span>
      {low && (
        <span style={{ fontSize: 12, color: 'var(--error)' }}>
          low{hasFaucet ? ' — top up below' : ''}
        </span>
      )}
    </div>
  );
}

function FaucetLink({ faucetUrl, address }: { faucetUrl: string; address: string }) {
  const [copied, setCopied] = useState(false);
  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <details style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
        Get testnet tez
      </summary>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
        Politicus runs on a testnet — posting and voting needs test tez. Get some
        from the{' '}
        <a href={faucetUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-soft)' }}>
          faucet
        </a>{' '}
        and paste your address there.
      </p>
      <button className="secondary" onClick={copyAddr} style={{ marginTop: 4 }}>
        {copied ? 'copied!' : 'copy address'}
      </button>
    </details>
  );
}

function BackupKey() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const sk = loadSecretKey();
  if (!sk) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(sk!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <details style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
        Backup private key
      </summary>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
        Anyone with this key controls your account. Save it somewhere safe; don't share it.
      </p>
      <input
        readOnly
        value={revealed ? sk : '•'.repeat(54)}
        type="text"
        onFocus={e => revealed && e.target.select()}
        style={{
          width: '100%',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          color: 'inherit',
          padding: 6,
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 12,
          marginTop: 4,
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="secondary" onClick={() => setRevealed(r => !r)}>
          {revealed ? 'hide' : 'reveal'}
        </button>
        <button className="secondary" onClick={copy}>
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
    </details>
  );
}

function RegisterPrompt({
  tezos, cfg, address, onDone, faucetUrl,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  address: string;
  onDone: () => void;
  faucetUrl: string | null;
}) {
  const [username, setUsername] = useState(address.slice(0, 8));
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function register() {
    if (!username.trim()) { setErr('username cannot be empty'); return; }
    setBusy(true); setErr('');
    try {
      const placeholderHash = await placeholderBrightIdHash(address);
      await registerUser(tezos, cfg, { brightidHash: placeholderHash, username, bio });
      // Give the indexer a moment to pick up the registration before reloading.
      setTimeout(onDone, 4000);
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(false); }
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
    <div className="bit">
      <h2 style={{ marginTop: 0 }}>Welcome!</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
        Your account is created, but you haven't registered with Politicus yet. Set up your profile to start posting.
      </p>
      <div className="muted" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 16, wordBreak: 'break-all' }}>
        {address}
      </div>
      {faucetUrl && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
          Registration is an on-chain transaction — you'll need some test tez. Get some from the{' '}
          <a href={faucetUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-soft)' }}>
            faucet
          </a>{' '}
          and paste your address there.
        </p>
      )}
      <input
        style={fieldStyle}
        placeholder="username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        disabled={busy}
      />
      <textarea
        style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' as const }}
        placeholder="bio (optional)"
        value={bio}
        onChange={e => setBio(e.target.value)}
        disabled={busy}
      />
      <button onClick={register} disabled={busy}>
        {busy ? 'registering…' : 'Register'}
      </button>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {busy && !err && (
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Registering on-chain, then waiting for the indexer. This takes about 10–20 seconds.
        </p>
      )}
    </div>
  );
}
