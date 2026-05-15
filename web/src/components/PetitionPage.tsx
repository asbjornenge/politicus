import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Petition } from '../api';
import { getPetition } from '../api';
import { votePetition, resolvePetition, isUserRegistered, registerUser } from '../tezos';
import { KERNEL_VARS, formatValue } from '../kernelVars';

export function PetitionPage({ tezos, cfg, address }: { tezos: TezosToolkit; cfg: Config; address: string }) {
  const { pid } = useParams<{ pid: string }>();
  const [p, setP] = useState<Petition | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reload() {
    if (!pid) return;
    setLoading(true);
    try { setP(await getPetition(pid)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [pid]);

  async function ensureRegistered() {
    const r = await isUserRegistered(tezos, cfg, address);
    if (!r) {
      const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
      await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
    }
  }

  async function vote(dir: boolean) {
    if (!pid) return;
    setBusy(true); setErr('');
    try {
      await ensureRegistered();
      await votePetition(tezos, cfg, pid, dir, 1);
      await reload();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function resolve() {
    if (!pid) return;
    setBusy(true); setErr('');
    try {
      await resolvePetition(tezos, cfg, pid);
      await reload();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="muted">loading…</p>;
  if (!p) return <p className="error">petition not found</p>;

  const now = Date.now();
  const closesAt = new Date(p.closes_at).getTime();
  const isOpen = !p.resolved && closesAt > now;
  const canResolve = !p.resolved && closesAt <= now;
  const status = p.resolved ? (p.passed ? '✓ passed' : '✗ failed') : isOpen ? 'open for voting' : 'ready to resolve';
  const minsLeft = Math.max(0, Math.round((closesAt - now) / 60000));

  return (
    <div>
      <div className="bit">
        <div className="meta">
          <Link to={`/user/${p.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
            {p.creator_username ?? p.creator.slice(0, 16) + '…'}
          </Link>
          <span className={p.passed ? 'success' : p.resolved ? 'error' : ''}>{status}</span>
        </div>
        <div className="content" style={{ fontSize: 16 }}>
          <strong>{prettyAction(p.action_type)}</strong>
          <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 14 }}>
            {renderPayload(p.action_type, p.action_payload)}
          </div>
        </div>
        <div className="footer">
          {isOpen && (
            <>
              <button onClick={() => vote(true)} disabled={busy}>↑ {p.yay}</button>
              <button onClick={() => vote(false)} disabled={busy} className="secondary">↓ {p.nay}</button>
              <span className="muted">closes in ~{minsLeft}m</span>
            </>
          )}
          {!isOpen && (
            <span className="muted">yay {p.yay} / nay {p.nay} · {p.unique_voters} voters</span>
          )}
          {canResolve && <button onClick={resolve} disabled={busy}>{busy ? '…' : 'resolve'}</button>}
        </div>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>
          <div>pid:&nbsp; {p.pid}</div>
          <div>creator: {p.creator}</div>
          <div>opened: {new Date(p.creation_time).toLocaleString()}</div>
          <div>closes: {new Date(p.closes_at).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

function prettyAction(t: string) {
  return {
    set_variable: 'Set kernel variable',
    mod_content_add: 'Moderate content',
    mod_content_del: 'Un-moderate content',
    mod_user_add: 'Moderate user',
    mod_user_del: 'Un-moderate user',
  }[t] ?? t;
}

function renderPayload(t: string, payload: any) {
  if (payload == null) return null;
  if (t === 'set_variable') {
    const key = payload?.string;
    const value = payload?.nat;
    const meta = KERNEL_VARS.find(v => v.key === key);
    if (meta && value !== undefined) {
      return <span>{key} → {formatValue(BigInt(value), meta.unit)}</span>;
    }
    return <span>{key} = {value}</span>;
  }
  if (t === 'mod_content_add' || t === 'mod_content_del') {
    const hash = typeof payload === 'string' ? payload : payload?.bytes;
    return <span>content_hash {hash}</span>;
  }
  if (t === 'mod_user_add' || t === 'mod_user_del') {
    const addr = typeof payload === 'string' ? payload : payload?.address;
    return <span>user {addr}</span>;
  }
  return <span>{JSON.stringify(payload)}</span>;
}
