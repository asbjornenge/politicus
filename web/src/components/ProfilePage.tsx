import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Bit, User } from '../api';
import { getUser } from '../api';
import { updateProfile, registerUser, placeholderBrightIdHash, loadSecretKey } from '../tezos';
import { Markdown } from './Markdown';

export function ProfilePage({ tezos, cfg, address }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
}) {
  const { address: target } = useParams<{ address: string }>();
  const [data, setData] = useState<{ user: User; bits: Bit[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  async function reload() {
    if (!target) return;
    setLoading(true);
    try { setData(await getUser(target)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); setEditing(false); }, [target]);

  if (loading) return <p className="muted">loading…</p>;

  if (!data) {
    const isOwn = target === address;
    if (isOwn && tezos && target) {
      return <RegisterPrompt tezos={tezos} cfg={cfg} address={target} onDone={reload} />;
    }
    return (
      <div className="bit">
        <p className="muted">This address has no Politicus profile yet.</p>
        <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
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
        <div className="meta">
          <span className="creator" style={{ fontSize: 16 }}>{u.username}</span>
          {u.moderated && (
            <span className="error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Flag size={14} /> moderated
            </span>
          )}
        </div>
        {u.bio && <div className="content" style={{ marginTop: 8 }}>{u.bio}</div>}
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
            onDone={() => { setEditing(false); reload(); }}
            onCancel={() => setEditing(false)}
          />
        )}
        {isOwn && <BackupKey />}
      </div>

      <h3 style={{ fontSize: 14, color: '#888', marginTop: 24, marginBottom: 8 }}>
        {data.bits.length} bit{data.bits.length === 1 ? '' : 's'}
      </h3>
      {data.bits.length === 0 && <p className="muted">no bits yet.</p>}
      {data.bits.map(b => (
        <Link key={b.bid} to={`/bit/${b.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span>{new Date(b.creation_time).toLocaleString()}</span>
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
    </div>
  );
}

function EditProfile({
  tezos, cfg, user, onDone, onCancel,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  user: User;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!username.trim()) { setErr('username cannot be empty'); return; }
    setBusy(true); setErr('');
    try {
      await updateProfile(tezos, cfg, { username, bio });
      onDone();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f1014',
    border: '1px solid #2a2a32',
    color: 'inherit',
    padding: 6,
    borderRadius: 4,
    fontFamily: 'inherit',
    marginBottom: 8,
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a32' }}>
      <input
        style={fieldStyle}
        placeholder="username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        disabled={busy}
      />
      <textarea
        style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' as const }}
        placeholder="bio"
        value={bio}
        onChange={e => setBio(e.target.value)}
        disabled={busy}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={busy}>{busy ? 'saving…' : 'save'}</button>
        <button onClick={onCancel} disabled={busy} className="secondary">cancel</button>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
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
    <details style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a2a32' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#aaa' }}>
        Backup private key
      </summary>
      <p style={{ fontSize: 13, color: '#aaa', marginTop: 8 }}>
        Anyone with this key controls your account. Save it somewhere safe; don't share it.
      </p>
      <input
        readOnly
        value={revealed ? sk : '•'.repeat(54)}
        type="text"
        onFocus={e => revealed && e.target.select()}
        style={{
          width: '100%',
          background: '#0f1014',
          border: '1px solid #2a2a32',
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
  tezos, cfg, address, onDone,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  address: string;
  onDone: () => void;
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
    background: '#0f1014',
    border: '1px solid #2a2a32',
    color: 'inherit',
    padding: 6,
    borderRadius: 4,
    fontFamily: 'inherit',
    marginBottom: 8,
  };

  return (
    <div className="bit">
      <h2 style={{ marginTop: 0 }}>Welcome!</h2>
      <p style={{ color: '#aaa', fontSize: 14, lineHeight: 1.5 }}>
        Your account is created, but you haven't registered with Politicus yet. Set up your profile to start posting.
      </p>
      <div className="muted" style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 16, wordBreak: 'break-all' }}>
        {address}
      </div>
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
