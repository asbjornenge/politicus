import { useEffect, useState } from 'react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Petition } from '../api';
import { listPetitions } from '../api';
import { createSetVariablePetition, votePetition, resolvePetition, isUserRegistered, registerUser } from '../tezos';

export function Petitions({
  tezos,
  cfg,
  address,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  address: string;
}) {
  const [petitions, setPetitions] = useState<Petition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function reload() {
    setLoading(true);
    try {
      setPetitions(await listPetitions());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, []);

  async function ensureRegistered() {
    const r = await isUserRegistered(tezos, cfg, address);
    if (!r) {
      const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
      await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
    }
  }

  async function vote(pid: string, dir: boolean) {
    setBusy(pid); setErr('');
    try {
      await ensureRegistered();
      await votePetition(tezos, cfg, pid, dir, 1);
      await reload();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally { setBusy(null); }
  }

  async function resolve(pid: string) {
    setBusy(pid); setErr('');
    try {
      await resolvePetition(tezos, cfg, pid);
      await reload();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally { setBusy(null); }
  }

  return (
    <div>
      <CreatePetition tezos={tezos} cfg={cfg} address={address} onCreated={reload} />
      {err && <div className="error">{err}</div>}
      {loading && petitions.length === 0 && <p className="muted">loading petitions…</p>}
      {petitions.length === 0 && !loading && <p className="muted">no petitions yet.</p>}
      {petitions.map(p => (
        <PetitionRow
          key={p.pid}
          p={p}
          busy={busy === p.pid}
          onYay={() => vote(p.pid, true)}
          onNay={() => vote(p.pid, false)}
          onResolve={() => resolve(p.pid)}
        />
      ))}
    </div>
  );
}

function PetitionRow({
  p, busy, onYay, onNay, onResolve,
}: {
  p: Petition;
  busy: boolean;
  onYay: () => void;
  onNay: () => void;
  onResolve: () => void;
}) {
  const now = Date.now();
  const closesAt = new Date(p.closes_at).getTime();
  const isOpen = !p.resolved && closesAt > now;
  const canResolve = !p.resolved && closesAt <= now;
  const status = p.resolved ? (p.passed ? '✓ passed' : '✗ failed') : (isOpen ? 'open' : 'ready to resolve');

  const ratio = p.yay + p.nay > 0 ? Math.round((p.yay / (p.yay + p.nay)) * 100) : 0;
  const minsLeft = Math.max(0, Math.round((closesAt - now) / 60000));

  return (
    <div className="bit">
      <div className="meta">
        <span className="creator">{p.creator_username ?? p.creator.slice(0, 12) + '…'}</span>
        <span className={p.passed ? 'success' : (p.resolved ? 'error' : '')}>{status}</span>
      </div>
      <div className="content">
        <strong>{prettyAction(p.action_type)}</strong>{' '}
        {renderPayload(p.action_type, p.action_payload)}
      </div>
      <div className="footer">
        {isOpen && (
          <>
            <button onClick={onYay} disabled={busy}>↑ {p.yay}</button>
            <button onClick={onNay} disabled={busy} className="secondary">↓ {p.nay}</button>
          </>
        )}
        {!isOpen && (
          <span className="muted">yay {p.yay} / nay {p.nay} ({ratio}% yay) · {p.unique_voters} voters</span>
        )}
        {canResolve && <button onClick={onResolve} disabled={busy}>{busy ? '…' : 'resolve'}</button>}
        {isOpen && <span className="muted">closes in ~{minsLeft}m</span>}
        <span className="muted">{p.pid.slice(0, 10)}…</span>
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
    const key = payload['1'] ?? payload[0];
    const value = payload['2'] ?? payload[1];
    return <code>{key} = {value}</code>;
  }
  if (typeof payload === 'string') return <code>{payload.slice(0, 24)}…</code>;
  return <code>{JSON.stringify(payload).slice(0, 80)}</code>;
}

function CreatePetition({
  tezos, cfg, address, onCreated,
}: {
  tezos: TezosToolkit; cfg: Config; address: string; onCreated: () => void;
}) {
  const [key, setKey] = useState('BitCost');
  const [value, setValue] = useState('100000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');

  async function submit() {
    setBusy(true); setErr(''); setStatus('');
    try {
      const r = await isUserRegistered(tezos, cfg, address);
      if (!r) {
        setStatus('registering...');
        const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
        await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error('invalid value');
      setStatus(`creating petition Set_variable(${key}, ${n})...`);
      await createSetVariablePetition(tezos, cfg, key, n);
      setStatus(`✓ created. indexer will pick up in a few seconds.`);
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="compose">
      <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>
        Create petition: change a kernel variable
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, background: '#0f1014', border: '1px solid #2a2a32', color: 'inherit', padding: 6, borderRadius: 4 }}
          placeholder="variable key (e.g. BitCost)"
          value={key}
          onChange={e => setKey(e.target.value)}
          disabled={busy}
        />
        <input
          style={{ flex: 1, background: '#0f1014', border: '1px solid #2a2a32', color: 'inherit', padding: 6, borderRadius: 4 }}
          placeholder="new value"
          value={value}
          onChange={e => setValue(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="actions">
        <span className="muted">{status || `costs PetitionUpdateVariableCost`}</span>
        <button onClick={submit} disabled={busy || !key || !value}>
          {busy ? 'creating…' : 'propose'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
