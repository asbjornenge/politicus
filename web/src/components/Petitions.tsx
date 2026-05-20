import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Check, X as XIcon, Loader2 } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Petition } from '../api';
import { listPetitions } from '../api';
import {
  sendCreateSetVariablePetition, sendVotePetition, sendResolvePetition,
  ensureRegistered, readVariable,
} from '../tezos';
import { KERNEL_VARS, groupedKernelVars, formatValue } from '../kernelVars';
import { PendingPost, type PendingItem } from './PendingPost';


export function Petitions({
  tezos,
  cfg,
  address,
  requestWallet,
}: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  requestWallet: () => void;
}) {
  const [petitions, setPetitions] = useState<Petition[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState<{
    pid: string;
    kind: 'up' | 'down' | 'resolve';
    status?: string;
    match?: (p: Petition) => boolean;
    startedAt?: number;
  } | null>(null);

  function patchActiveOp(patch: Partial<NonNullable<typeof activeOp>>) {
    setActiveOp(prev => prev ? { ...prev, ...patch } : null);
  }
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<PendingItem<Petition>[]>([]);

  function updatePending(id: string, patch: Partial<PendingItem<Petition>>) {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }
  function removePending(id: string) {
    setPending(prev => prev.filter(p => p.id !== id));
  }

  async function reload() {
    setPetitions(await listPetitions(address ?? undefined));
  }

  const isWatching = pending.some(p => Boolean(p.match)) || Boolean(activeOp?.match);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await listPetitions(address ?? undefined);
        if (cancelled) return;
        setPetitions(fresh);
        setLoading(false);
        setPending(prev => prev.flatMap(p => {
          if (!p.match) return [p];
          if (fresh.some(p.match)) return [];
          if (p.matchStartedAt && Date.now() - p.matchStartedAt > 80_000) {
            return [{ ...p, match: undefined, status: '', error: 'indexer is taking longer than expected.' }];
          }
          return [p];
        }));
        setActiveOp(prev => {
          if (!prev?.match) return prev;
          if (fresh.some(prev.match)) return null;
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
  }, [isWatching]);

  async function vote(pid: string, dir: boolean) {
    if (!tezos || !address) { requestWallet(); return; }
    const before = petitions.find(p => p.pid === pid);
    const beforeYay = before?.yay ?? 0;
    const beforeNay = before?.nay ?? 0;
    setActiveOp({ pid, kind: dir ? 'up' : 'down', status: 'preparing…' }); setErr('');
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendVotePetition(tezos, cfg, pid, dir, 1);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setActiveOp({
        pid, kind: dir ? 'up' : 'down',
        status: 'waiting for indexer…',
        match: (p: Petition) => p.pid === pid && (p.yay !== beforeYay || p.nay !== beforeNay),
        startedAt: Date.now(),
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setActiveOp(null);
    }
  }

  async function resolve(pid: string) {
    if (!tezos) { requestWallet(); return; }
    setActiveOp({ pid, kind: 'resolve', status: 'signing transaction…' }); setErr('');
    try {
      const op = await sendResolvePetition(tezos, cfg, pid);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setActiveOp({
        pid, kind: 'resolve',
        status: 'waiting for indexer…',
        match: (p: Petition) => p.pid === pid && p.resolved,
        startedAt: Date.now(),
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setActiveOp(null);
    }
  }

  async function handleCreate(key: string, value: number) {
    if (!tezos || !address) { requestWallet(); return; }
    const id = crypto.randomUUID();
    setPending(prev => [{ id, text: `${key} → ${value}`, status: 'preparing…' }, ...prev]);
    try {
      const beforePids = new Set(petitions.filter(p => p.creator === address).map(p => p.pid));

      await ensureRegistered(tezos, cfg, address, s => updatePending(id, { status: s }));

      updatePending(id, { status: 'signing transaction…' });
      const op = await sendCreateSetVariablePetition(tezos, cfg, key, value);

      updatePending(id, { status: `in mempool (${op.hash.slice(0, 10)}…), waiting for confirmation…` });
      await op.confirmation();

      updatePending(id, {
        status: 'confirmed, waiting for indexer…',
        match: (p: Petition) => p.creator === address && !beforePids.has(p.pid),
        matchStartedAt: Date.now(),
      });
    } catch (e: any) {
      updatePending(id, { error: e.message ?? String(e) });
    }
  }

  return (
    <div>
      {tezos && address ? (
        <CreatePetition tezos={tezos} cfg={cfg} onCreate={handleCreate} />
      ) : (
        <div className="compose" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted">Sign in to propose a kernel change</span>
          <button onClick={requestWallet}>Join</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {pending.map(p => (
        <PendingPost key={p.id} item={p} onDismiss={() => removePending(p.id)} />
      ))}
      {loading && petitions.length === 0 && pending.length === 0 && <p className="muted">loading petitions…</p>}
      {petitions.length === 0 && !loading && pending.length === 0 && <p className="muted">no petitions yet.</p>}
      {petitions.map(p => (
        <PetitionRow
          key={p.pid}
          p={p}
          activeOp={activeOp?.pid === p.pid ? activeOp.kind : null}
          activeStatus={activeOp?.pid === p.pid ? activeOp.status : undefined}
          onYay={() => vote(p.pid, true)}
          onNay={() => vote(p.pid, false)}
          onResolve={() => resolve(p.pid)}
        />
      ))}
    </div>
  );
}

function PetitionRow({
  p, activeOp, activeStatus, onYay, onNay, onResolve,
}: {
  p: Petition;
  activeOp: 'up' | 'down' | 'resolve' | null;
  activeStatus?: string;
  onYay: () => void;
  onNay: () => void;
  onResolve: () => void;
}) {
  const busy = activeOp !== null;
  const now = Date.now();
  const closesAt = new Date(p.closes_at).getTime();
  const isOpen = !p.resolved && closesAt > now;
  const canResolve = !p.resolved && closesAt <= now;
  const statusLabel: React.ReactNode = p.resolved
    ? p.passed
      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={14} /> passed</span>
      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><XIcon size={14} /> failed</span>
    : isOpen ? 'open' : 'ready to resolve';

  const ratio = p.yay + p.nay > 0 ? Math.round((p.yay / (p.yay + p.nay)) * 100) : 0;
  const minsLeft = Math.max(0, Math.round((closesAt - now) / 60000));

  return (
    <div className="bit">
      <div className="meta">
        <Link to={`/user/${p.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
          {p.creator_username ?? p.creator.slice(0, 12) + '…'}
        </Link>
        <span className={p.passed ? 'success' : (p.resolved ? 'error' : '')}>{statusLabel}</span>
      </div>
      <div className="content">
        <strong>{prettyAction(p.action_type)}</strong>{' '}
        {renderPayload(p.action_type, p.action_payload)}
      </div>
      <div className="footer">
        {isOpen && (
          <>
            <button
              onClick={onYay}
              disabled={busy || p.my_vote === 'up'}
              title={p.my_vote === 'up' ? 'you already voted up' : undefined}
            >
              {activeOp === 'up' ? <Loader2 size={14} className="spinner" /> : <ChevronUp size={14} />}
              {p.yay}
            </button>
            <button
              onClick={onNay}
              disabled={busy || p.my_vote === 'down'}
              className="secondary"
              title={p.my_vote === 'down' ? 'you already voted down' : undefined}
            >
              {activeOp === 'down' ? <Loader2 size={14} className="spinner" /> : <ChevronDown size={14} />}
              {p.nay}
            </button>
          </>
        )}
        {!isOpen && (
          <span className="muted">yay {p.yay} / nay {p.nay} ({ratio}% yay) · {p.unique_voters} voters</span>
        )}
        {canResolve && (
          <button onClick={onResolve} disabled={busy}>
            {activeOp === 'resolve' && <Loader2 size={14} className="spinner" />}
            resolve
          </button>
        )}
        {activeStatus && (
          <span className="muted" style={{ fontStyle: 'italic' }}>{activeStatus}</span>
        )}
        {isOpen && !activeStatus && <span className="muted">closes in ~{minsLeft}m</span>}
        <Link
          to={`/petition/${p.pid}`}
          className="muted"
          style={{ fontFamily: 'monospace', textDecoration: 'none', marginLeft: 'auto' }}
          title="open petition page"
        >
          {p.pid.slice(0, 10)}…
        </Link>
      </div>
    </div>
  );
}

function prettyAction(t: string) {
  return {
    set_variable: 'Set variable',
    mod_content_add: 'Moderate content',
    mod_content_del: 'Un-moderate content',
    mod_user_add: 'Moderate user',
    mod_user_del: 'Un-moderate user',
  }[t] ?? t;
}

function renderPayload(t: string, payload: any) {
  if (payload == null) return null;
  if (t === 'set_variable') {
    const key = payload?.string ?? payload?.['1'] ?? payload?.[0];
    const value = payload?.nat ?? payload?.['2'] ?? payload?.[1];
    return <code>{key} = {value}</code>;
  }
  if (t === 'mod_content_add' || t === 'mod_content_del') {
    const hash = typeof payload === 'string' ? payload : payload?.bytes;
    return <code>{hash?.slice(0, 24)}…</code>;
  }
  if (t === 'mod_user_add' || t === 'mod_user_del') {
    const addr = typeof payload === 'string' ? payload : payload?.address;
    return <code>{addr}</code>;
  }
  if (typeof payload === 'string') return <code>{payload.slice(0, 24)}…</code>;
  return <code>{JSON.stringify(payload).slice(0, 80)}</code>;
}

function CreatePetition({
  tezos, cfg, onCreate,
}: {
  tezos: TezosToolkit; cfg: Config; onCreate: (key: string, value: number) => void | Promise<void>;
}) {
  const [key, setKey] = useState('BitCost');
  const [value, setValue] = useState('');
  const [currentValue, setCurrentValue] = useState<bigint | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const meta = KERNEL_VARS.find(v => v.key === key)!;
  const grouped = groupedKernelVars();

  useEffect(() => {
    let cancelled = false;
    setLoadingCurrent(true);
    setCurrentValue(null);
    readVariable(tezos, cfg, key)
      .then(v => { if (!cancelled) setCurrentValue(v); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCurrent(false); });
    return () => { cancelled = true; };
  }, [key, tezos, cfg]);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error('invalid value');
      setValue('');
      await onCreate(key, n);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally { setBusy(false); }
  }

  const selectStyle = {
    flex: 1,
    background: '#0f1014',
    border: '1px solid #2a2a32',
    color: 'inherit' as const,
    padding: 6,
    borderRadius: 4,
    font: 'inherit',
  };

  return (
    <div className="compose">
      <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>
        Propose a kernel-variable change
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select style={selectStyle} value={key} onChange={e => setKey(e.target.value)} disabled={busy}>
          {Object.entries(grouped).map(([group, vars]) => (
            <optgroup key={group} label={group}>
              {vars.map(v => (
                <option key={v.key} value={v.key}>{v.key}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          style={{ ...selectStyle, fontFamily: 'monospace' }}
          placeholder={`new value in ${meta.unit}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          disabled={busy}
        />
      </div>
      <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.4, marginBottom: 6 }}>
        {meta.description}
      </div>
      <div style={{ fontSize: 12, color: '#888', fontFamily: 'monospace', marginBottom: 8 }}>
        current: {loadingCurrent ? '…' : currentValue !== null ? formatValue(currentValue, meta.unit) : 'unknown'}
      </div>
      <div className="actions">
        <span className="muted">costs PetitionUpdateVariableCost</span>
        <button onClick={submit} disabled={busy || !value}>
          {busy ? 'submitting…' : 'propose'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
