import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag, MessageCircle } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, BitDetail } from '../api';
import { getBit } from '../api';
import { voteBit, createModContentAddPetition, isUserRegistered, registerUser } from '../tezos';
import { Compose } from './Compose';

export function BitPage({ tezos, cfg, address }: { tezos: TezosToolkit; cfg: Config; address: string }) {
  const { bid } = useParams<{ bid: string }>();
  const [data, setData] = useState<BitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [replying, setReplying] = useState(false);
  const [showThread, setShowThread] = useState(true);

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
      setNotice('moderation petition created. switch to the petitions page to vote.');
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="muted">loading…</p>;
  if (!data) return <p className="error">bit not found</p>;
  const b = data.bit;

  const ancestors = data.ancestors ?? [];

  return (
    <div>
      {ancestors.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              thread: {ancestors.length} bit{ancestors.length === 1 ? '' : 's'} above
            </span>
            <button className="secondary" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => setShowThread(t => !t)}>
              {showThread ? 'hide' : 'show'}
            </button>
          </div>
          {showThread && ancestors.map(a => (
            <Link key={a.bid} to={`/bit/${a.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="bit" style={{ borderLeft: '3px solid #3a3a45', opacity: 0.85 }}>
                <div className="meta">
                  <span className="creator">{a.creator_username ?? a.creator.slice(0, 12) + '…'}</span>
                  <span>{new Date(a.creation_time).toLocaleString()}</span>
                </div>
                <div className="content">
                  {a.content_moderated ? (
                    <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> moderated</span>
                  ) : a.content ? (
                    a.content.length > 280 ? a.content.slice(0, 280).replace(/\s+\S*$/, '') + '…' : a.content
                  ) : (
                    <span className="muted">no content</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="bit" style={{ borderLeft: '3px solid #4a5fd6' }}>
        <div className="meta">
          <Link to={`/user/${b.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
            {b.creator_username ?? b.creator.slice(0, 16) + '…'}
          </Link>
          <span>{new Date(b.creation_time).toLocaleString()}</span>
        </div>
        <div className="content" style={{ fontSize: 16 }}>
          {b.content_moderated ? (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> content moderated — bytes withheld by indexer</span>
          ) : b.creator_moderated ? (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> creator moderated</span>
          ) : b.content ?? (
            <span className="muted">(content not uploaded — hash: {b.content_hash.slice(0, 12)}…)</span>
          )}
        </div>
        <div className="footer">
          <button onClick={() => vote(true)} disabled={busy}><ChevronUp size={14} /> {b.yay}</button>
          <button onClick={() => vote(false)} disabled={busy} className="secondary"><ChevronDown size={14} /> {b.nay}</button>
          <button onClick={() => setReplying(r => !r)} disabled={busy} className="secondary"><MessageCircle size={14} /> reply</button>
          <button onClick={moderate} disabled={busy} className="secondary" title="propose to moderate this bit"><Flag size={14} /></button>
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

      {replying && (
        <div style={{ marginTop: 16 }}>
          <Compose
            tezos={tezos}
            cfg={cfg}
            address={address}
            parent={b.bid}
            onPosted={() => { setReplying(false); reload(); }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}

      {data.replies.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: '#888', marginTop: 24, marginBottom: 8 }}>
            {data.replies.length} repl{data.replies.length === 1 ? 'y' : 'ies'}
          </h3>
          {data.replies.map(r => (
            <div key={r.bid} className="bit">
              <div className="meta">
                <Link to={`/user/${r.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {r.creator_username ?? r.creator.slice(0, 12) + '…'}
                </Link>
                <Link to={`/bit/${r.bid}`} className="muted" style={{ textDecoration: 'none' }}>
                  {new Date(r.creation_time).toLocaleString()}
                </Link>
              </div>
              <div className="content">
                {r.content_moderated ? <span className="muted">⚑ moderated</span> : r.content ?? <span className="muted">no content</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {data.votes.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: '#888', marginTop: 24, marginBottom: 8 }}>{data.votes.length} vote{data.votes.length === 1 ? '' : 's'}</h3>
          <div className="bit">
            {data.votes.map(v => (
              <div key={v.voter + v.vote_time} style={{ fontSize: 13, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {v.direction ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {v.votes} by {v.voter.slice(0, 16)}…
                </span>
                <span className="muted">{new Date(v.vote_time).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
