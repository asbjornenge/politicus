import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Bit, User } from '../api';
import { getUser } from '../api';
import { updateProfile } from '../tezos';

export function ProfilePage({ tezos, cfg, address }: { tezos: TezosToolkit; cfg: Config; address: string }) {
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
  if (!data) return <p className="error">user not found</p>;

  const isOwn = target === address;
  const u = data.user;

  return (
    <div>
      <div className="bit">
        <div className="meta">
          <span className="creator" style={{ fontSize: 16 }}>{u.username}</span>
          {u.moderated && <span className="error">⚑ moderated</span>}
        </div>
        {u.bio && <div className="content" style={{ marginTop: 8 }}>{u.bio}</div>}
        <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 12, wordBreak: 'break-all' }}>
          {u.address}
        </div>
        {isOwn && !editing && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setEditing(true)}>edit profile</button>
          </div>
        )}
        {isOwn && editing && (
          <EditProfile
            tezos={tezos}
            cfg={cfg}
            user={u}
            onDone={() => { setEditing(false); reload(); }}
            onCancel={() => setEditing(false)}
          />
        )}
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
              <span className="muted">↑ {b.yay} / ↓ {b.nay}</span>
            </div>
            <div className="content">
              {b.content_moderated ? <span className="muted">⚑ moderated</span> : b.content?.slice(0, 200) ?? <span className="muted">no content</span>}
              {b.content && b.content.length > 200 && '…'}
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
