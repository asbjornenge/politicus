import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Users, FileText } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, Syndicate } from '../api';
import { listSyndicates } from '../api';
import { sendCreateSyndicate, ensureRegistered } from '../tezos';
import { formatTez } from '../utils';
import { Markdown } from './Markdown';

export function Syndicates({
  tezos, cfg, address, balance, kernelVars, requestWallet,
}: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  balance: number | null;
  kernelVars: Record<string, string>;
  requestWallet: () => void;
}) {
  const [syndicates, setSyndicates] = useState<Syndicate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function reload() {
    setLoading(true);
    try { setSyndicates(await listSyndicates()); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div>
      {tezos && address ? (
        showCreate ? (
          <CreateSyndicate
            tezos={tezos}
            cfg={cfg}
            address={address}
            balance={balance}
            costMutez={kernelVars.SyndicateCreationCost ?? null}
            onDone={() => { setShowCreate(false); reload(); }}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <div className="compose" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted">Create a syndicate — publish under a shared masthead.</span>
            <button onClick={() => setShowCreate(true)}>+ new syndicate</button>
          </div>
        )
      ) : (
        <div className="compose" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted">Sign in to create a syndicate</span>
          <button onClick={requestWallet}>Join</button>
        </div>
      )}

      {loading && syndicates.length === 0 && <p className="muted">loading…</p>}
      {!loading && syndicates.length === 0 && <p className="muted">no syndicates yet. be the first.</p>}

      {syndicates.map(s => (
        <Link key={s.sid} to={`/syndicate/${s.sid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span className="creator" style={{ fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={14} /> {s.name}
              </span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                <span><Users size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />{s.member_count}</span>
                <span><FileText size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />{s.bit_count}</span>
              </span>
            </div>
            {s.bio && <div className="content"><Markdown truncate>{s.bio}</Markdown></div>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function CreateSyndicate({
  tezos, cfg, address, balance, costMutez, onDone, onCancel,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  address: string;
  balance: number | null;
  costMutez: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const costTez = costMutez ? Number(costMutez) / 1_000_000 : null;
  const insufficient = costTez !== null && balance !== null && balance < costTez;

  async function submit() {
    if (!name.trim()) { setErr('name required'); return; }
    setBusy(true); setErr('');
    try {
      setStatus('ensuring registered…');
      await ensureRegistered(tezos, cfg, address, setStatus);
      setStatus('signing transaction…');
      const op = await sendCreateSyndicate(tezos, cfg, name.trim(), bio.trim());
      setStatus(`in mempool (${op.hash.slice(0, 10)}…)`);
      await op.confirmation();
      setStatus('confirmed, waiting for indexer…');
      setTimeout(onDone, 4000);
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
    <div className="compose">
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        New syndicate
      </div>
      <input
        style={fieldStyle}
        placeholder="syndicate name (e.g. Daily Post)"
        value={name}
        onChange={e => setName(e.target.value)}
        disabled={busy}
      />
      <textarea
        style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' as const }}
        placeholder="bio / mission (markdown OK)"
        value={bio}
        onChange={e => setBio(e.target.value)}
        disabled={busy}
      />
      <div className="actions">
        <span className="muted">
          You become first admin + member. Closed membership — only admins add others.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} disabled={busy} className="secondary">cancel</button>
          <button
            onClick={submit}
            disabled={busy || !name.trim() || insufficient}
            title={insufficient ? `need ${formatTez(costTez!)} ꜩ` : undefined}
          >
            {busy ? 'creating…' : (costTez !== null ? `create · ${formatTez(costTez)} ꜩ` : 'create')}
          </button>
        </div>
      </div>
      {status && <div className="muted" style={{ marginTop: 8, fontStyle: 'italic', fontSize: 12 }}>{status}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
