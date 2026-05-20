import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Check, X as XIcon, Loader2 } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Petition } from '../api';
import { getPetition } from '../api';
import { sendVotePetition, sendResolvePetition, ensureRegistered } from '../tezos';
import { KERNEL_VARS, formatValue } from '../kernelVars';

export function PetitionPage({ tezos, cfg, address, requestWallet }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  requestWallet: () => void;
}) {
  const { pid } = useParams<{ pid: string }>();
  const [p, setP] = useState<Petition | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState<{
    kind: 'up' | 'down' | 'resolve';
    status?: string;
    match?: (p: Petition) => boolean;
    startedAt?: number;
  } | null>(null);

  function patchActiveOp(patch: Partial<NonNullable<typeof activeOp>>) {
    setActiveOp(prev => prev ? { ...prev, ...patch } : null);
  }
  const [err, setErr] = useState('');

  const isWatching = Boolean(activeOp?.match);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await getPetition(pid, address ?? undefined);
        if (cancelled) return;
        setP(fresh);
        setLoading(false);
        setActiveOp(prev => {
          if (!prev?.match || !fresh) return prev;
          if (prev.match(fresh)) return null;
          if (prev.startedAt && Date.now() - prev.startedAt > 80_000) return null;
          return prev;
        });
      } catch (e) {
        if (!cancelled) console.error('poll error', e);
      }
    };
    tick();
    const handle = setInterval(tick, isWatching ? 2000 : 8000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [pid, isWatching]);

  async function vote(dir: boolean) {
    if (!pid || !p) return;
    if (!tezos || !address) { requestWallet(); return; }
    const beforeYay = p.yay;
    const beforeNay = p.nay;
    setActiveOp({ kind: dir ? 'up' : 'down', status: 'preparing…' }); setErr('');
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendVotePetition(tezos, cfg, pid, dir, 1);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setActiveOp({
        kind: dir ? 'up' : 'down',
        status: 'waiting for indexer…',
        match: (px: Petition) => px.yay !== beforeYay || px.nay !== beforeNay,
        startedAt: Date.now(),
      });
    } catch (e: any) { setErr(e.message ?? String(e)); setActiveOp(null); }
  }

  async function resolve() {
    if (!pid) return;
    if (!tezos) { requestWallet(); return; }
    setActiveOp({ kind: 'resolve', status: 'signing transaction…' }); setErr('');
    try {
      const op = await sendResolvePetition(tezos, cfg, pid);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setActiveOp({
        kind: 'resolve',
        status: 'waiting for indexer…',
        match: (px: Petition) => px.resolved,
        startedAt: Date.now(),
      });
    } catch (e: any) { setErr(e.message ?? String(e)); setActiveOp(null); }
  }

  if (loading) return <p className="muted">loading…</p>;
  if (!p) return <p className="error">petition not found</p>;

  const now = Date.now();
  const closesAt = new Date(p.closes_at).getTime();
  const isOpen = !p.resolved && closesAt > now;
  const canResolve = !p.resolved && closesAt <= now;
  const statusLabel: React.ReactNode = p.resolved
    ? p.passed
      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={14} /> passed</span>
      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><XIcon size={14} /> failed</span>
    : isOpen ? 'open for voting' : 'ready to resolve';
  const minsLeft = Math.max(0, Math.round((closesAt - now) / 60000));

  return (
    <div>
      <div className="bit">
        <div className="meta">
          <Link to={`/user/${p.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
            {p.creator_username ?? p.creator.slice(0, 16) + '…'}
          </Link>
          <span className={p.passed ? 'success' : p.resolved ? 'error' : ''}>{statusLabel}</span>
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
              <button
                onClick={() => vote(true)}
                disabled={activeOp !== null || p.my_vote === 'up'}
                className={p.my_vote === 'up' ? 'voted' : ''}
                title={p.my_vote === 'up' ? 'you already voted up' : undefined}
              >
                {activeOp?.kind === 'up' ? <Loader2 size={14} className="spinner" /> : <ChevronUp size={14} />}
                {p.yay}
              </button>
              <button
                onClick={() => vote(false)}
                disabled={activeOp !== null || p.my_vote === 'down'}
                className={p.my_vote === 'down' ? 'voted' : ''}
                title={p.my_vote === 'down' ? 'you already voted down' : undefined}
              >
                {activeOp?.kind === 'down' ? <Loader2 size={14} className="spinner" /> : <ChevronDown size={14} />}
                {p.nay}
              </button>
              <span className="muted">closes in ~{minsLeft}m</span>
            </>
          )}
          {!isOpen && (
            <span className="muted">yay {p.yay} / nay {p.nay} · {p.unique_voters} voters</span>
          )}
          {canResolve && (
            <button onClick={resolve} disabled={activeOp !== null}>
              {activeOp?.kind === 'resolve' && <Loader2 size={14} className="spinner" />}
              resolve
            </button>
          )}
          {activeOp?.status && (
            <span className="muted" style={{ fontStyle: 'italic' }}>{activeOp.status}</span>
          )}
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
