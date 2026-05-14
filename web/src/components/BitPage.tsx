import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, BitDetail } from '../api';
import { getBit } from '../api';
import { voteBit, createModContentAddPetition, isUserRegistered, registerUser } from '../tezos';

export function BitPage({ tezos, cfg, address }: { tezos: TezosToolkit; cfg: Config; address: string }) {
  const { bid } = useParams<{ bid: string }>();
  const [data, setData] = useState<BitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    if (!bid) return;
    setLoading(true);
    try { setData(await getBit(bid)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [bid]);

  async function ensureRegistered() {
    const r = await isUserRegistered(tezos, cfg, address);
    if (!r) {
      const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
      await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
    }
  }

  async function vote(dir: boolean) {
    if (!bid) return;
    setBusy(true); setErr('');
    try {
      await ensureRegistered();
      await voteBit(tezos, cfg, bid, dir, 1);
      await reload();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function moderate() {
    if (!data) return;
    if (!confirm(`Propose moderation for this Bit? Costs PetitionContentModerationAddCost.`)) return;
    setBusy(true); setErr('');
    try {
      await ensureRegistered();
      await createModContentAddPetition(tezos, cfg, data.bit.content_hash);
      setNotice('✓ moderation petition created. switch to the petitions page to vote.');
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="muted">loading…</p>;
  if (!data) return <p className="error">bit not found</p>;
  const b = data.bit;

  return (
    <div>
      <Link to="/" className="muted" style={{ fontSize: 13 }}>← back to feed</Link>
      <div className="bit" style={{ marginTop: 12 }}>
        <div className="meta">
          <span className="creator">{b.creator_username ?? b.creator.slice(0, 16) + '…'}</span>
          <span>{new Date(b.creation_time).toLocaleString()}</span>
        </div>
        <div className="content" style={{ fontSize: 16 }}>
          {b.content_moderated ? (
            <span className="muted">⚑ content moderated — bytes withheld by indexer</span>
          ) : b.creator_moderated ? (
            <span className="muted">⚑ creator moderated</span>
          ) : b.content ?? (
            <span className="muted">(content not uploaded — hash: {b.content_hash.slice(0, 12)}…)</span>
          )}
        </div>
        <div className="footer">
          <button onClick={() => vote(true)} disabled={busy}>↑ {b.yay}</button>
          <button onClick={() => vote(false)} disabled={busy} className="secondary">↓ {b.nay}</button>
          <button onClick={moderate} disabled={busy} className="secondary" title="propose to moderate this bit">⚑</button>
        </div>
        <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>
          <div>bid:&nbsp; {b.bid}</div>
          <div>hash: {b.content_hash}</div>
          <div>creator: {b.creator}</div>
          {b.parent && (
            <div>parent: <Link to={`/bit/${b.parent}`}>{b.parent}</Link></div>
          )}
        </div>
        {notice && <div className="success" style={{ marginTop: 10 }}>{notice}</div>}
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      {data.replies.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: '#888', marginTop: 24, marginBottom: 8 }}>
            {data.replies.length} repl{data.replies.length === 1 ? 'y' : 'ies'}
          </h3>
          {data.replies.map(r => (
            <Link key={r.bid} to={`/bit/${r.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="bit">
                <div className="meta">
                  <span className="creator">{r.creator_username ?? r.creator.slice(0, 12) + '…'}</span>
                  <span>{new Date(r.creation_time).toLocaleString()}</span>
                </div>
                <div className="content">
                  {r.content_moderated ? <span className="muted">⚑ moderated</span> : r.content ?? <span className="muted">no content</span>}
                </div>
              </div>
            </Link>
          ))}
        </>
      )}

      {data.votes.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: '#888', marginTop: 24, marginBottom: 8 }}>{data.votes.length} vote{data.votes.length === 1 ? '' : 's'}</h3>
          <div className="bit">
            {data.votes.map(v => (
              <div key={v.voter + v.vote_time} style={{ fontSize: 13, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{v.direction ? '↑' : '↓'} {v.votes} by {v.voter.slice(0, 16)}…</span>
                <span className="muted">{new Date(v.vote_time).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
