import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Sparkles, Loader2 } from 'lucide-react';
import type { IssueSummary } from '../api';
import { listIssues, generateIssue } from '../api';

export function Issues({ address, requestWallet }: { address: string | null; requestWallet: () => void }) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGen, setShowGen] = useState(false);

  async function loadArchive() {
    setLoading(true);
    try { setIssues(await listIssues(50)); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadArchive(); }, []);

  return (
    <div>
      <div className="compose" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
            <Newspaper size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Custom issues
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Compose your own edition with a different time window or search filter.
          </div>
        </div>
        {address
          ? <button onClick={() => setShowGen(s => !s)}><Sparkles size={14} /> Generate</button>
          : <button onClick={requestWallet}>Sign in</button>}
      </div>

      {showGen && address && (
        <GenerateForm
          onDone={() => { setShowGen(false); loadArchive(); }}
          onCancel={() => setShowGen(false)}
          creator={address}
        />
      )}

      {loading && issues.length === 0 && <p className="muted">loading…</p>}
      {!loading && issues.length === 0 && <p className="muted">No custom issues composed yet.</p>}

      {issues.map(iss => (
        <Link key={iss.id} to={`/issues/${iss.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span className="creator">{iss.title}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {new Date(iss.time_window_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {' – '}
                {new Date(iss.time_window_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
            {iss.intro && (
              <div style={{ fontFamily: 'var(--font-italic)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
                {iss.intro}
              </div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              {iss.filter_query && <span>q: "{iss.filter_query}" · </span>}
              composed {new Date(iss.created_at).toLocaleString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function GenerateForm({
  onDone, onCancel, creator,
}: {
  onDone: () => void;
  onCancel: () => void;
  creator: string;
}) {
  const [windowDays, setWindowDays] = useState('7');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');

  async function submit() {
    setBusy(true); setErr(''); setStatus('composing…');
    try {
      const res = await generateIssue({
        window_days: Math.max(1, Math.min(30, Number(windowDays) || 7)),
        query: query.trim() || undefined,
        creator,
      });
      if ('error' in res) { setErr(res.detail ?? res.error); return; }
      onDone();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); setStatus(''); }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'inherit', padding: 6, borderRadius: 4, fontFamily: 'inherit', fontSize: 13,
  };

  return (
    <div className="compose">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--text-muted)' }}>
          Window (days)
          <input style={fieldStyle} value={windowDays} onChange={e => setWindowDays(e.target.value)} disabled={busy} />
        </label>
        <label style={{ flex: 2, minWidth: 200, fontSize: 12, color: 'var(--text-muted)' }}>
          Search (optional)
          <input
            style={fieldStyle}
            placeholder="keyword"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={busy}>
          {busy ? <><Loader2 size={14} className="spinner" /> composing…</> : 'compose'}
        </button>
        <button onClick={onCancel} disabled={busy} className="secondary">cancel</button>
      </div>
      {status && <div className="muted" style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic' }}>{status}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
