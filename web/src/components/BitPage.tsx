import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag, MessageCircle, Loader2, X as XIcon } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, BitDetail } from '../api';
import { getBit, postContent } from '../api';
import {
  sendVoteBit, sendCreateBit, sendCreateModContentAddPetition,
  ensureRegistered,
} from '../tezos';
import { Compose } from './Compose';
import { PendingPost, type PendingItem } from './PendingPost';
import { Markdown } from './Markdown';
import { formatBitDate, formatTez, pendingVoteTotal, quadraticCostTez } from '../utils';


export function BitPage({ tezos, cfg, address, balance, kernelVars, requestWallet }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  balance: number | null;
  kernelVars: Record<string, string>;
  requestWallet: () => void;
}) {
  const { bid } = useParams<{ bid: string }>();
  const [data, setData] = useState<BitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState<{
    kind: 'up' | 'down' | 'mod';
    status?: string;
    match?: (b: any) => boolean;
    startedAt?: number;
  } | null>(null);

  function patchActiveOp(patch: Partial<NonNullable<typeof activeOp>>) {
    setActiveOp(prev => prev ? { ...prev, ...patch } : null);
  }
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [replying, setReplying] = useState(false);
  const [pendingVote, setPendingVote] = useState<{ direction: 'up' | 'down'; count: number } | null>(null);

  function bumpPendingVote(dir: 'up' | 'down') {
    setPendingVote(prev => !prev || prev.direction !== dir ? { direction: dir, count: 1 } : { direction: dir, count: prev.count + 1 });
  }
  const [showThread, setShowThread] = useState(true);
  const [pendingReplies, setPendingReplies] = useState<PendingItem<any>[]>([]);

  function updatePending(id: string, patch: Partial<PendingItem<any>>) {
    setPendingReplies(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  const isWatching = pendingReplies.some(p => Boolean(p.match)) || Boolean(activeOp?.match);

  useEffect(() => {
    if (!bid) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await getBit(bid, address ?? undefined);
        if (cancelled || !fresh) return;
        setData(fresh);
        setLoading(false);
        setPendingReplies(prev => prev.flatMap(p => {
          if (!p.match) return [p];
          if (fresh.replies.some(p.match)) return [];
          if (p.matchStartedAt && Date.now() - p.matchStartedAt > 80_000) {
            return [{ ...p, match: undefined, status: '', error: 'indexer is taking longer than expected.' }];
          }
          return [p];
        }));
        setActiveOp(prev => {
          if (!prev?.match) return prev;
          if (prev.match(fresh.bit)) return null;
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
  }, [bid, isWatching]);

  async function submitPendingVote() {
    if (!bid || !data || !pendingVote) return;
    if (!tezos || !address) { requestWallet(); return; }
    const beforeYay = data.bit.yay;
    const beforeNay = data.bit.nay;
    const total = pendingVoteTotal(data.bit.my_vote, data.bit.my_votes, pendingVote.direction, pendingVote.count);
    const dir = pendingVote.direction === 'up';
    setActiveOp({ kind: dir ? 'up' : 'down', status: 'preparing…' }); setErr('');
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendVoteBit(tezos, cfg, bid, dir, total);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setPendingVote(null);
      setActiveOp({
        kind: dir ? 'up' : 'down',
        status: 'waiting for indexer…',
        match: (b: any) => b.yay !== beforeYay || b.nay !== beforeNay,
        startedAt: Date.now(),
      });
    } catch (e: any) { setErr(e.message ?? String(e)); setActiveOp(null); }
  }

  async function moderate() {
    if (!data) return;
    if (!tezos || !address) { requestWallet(); return; }
    if (!confirm(`Propose moderation for this Bit? Costs PetitionContentModerationAddCost.`)) return;
    setActiveOp({ kind: 'mod', status: 'preparing…' }); setErr('');
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendCreateModContentAddPetition(tezos, cfg, data.bit.content_hash);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setNotice('moderation petition created. switch to the petitions page to vote.');
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setActiveOp(null); }
  }

  async function handleReply(text: string) {
    if (!bid || !data) return;
    if (!tezos || !address) { requestWallet(); return; }
    const id = crypto.randomUUID();
    setReplying(false);
    setPendingReplies(prev => [...prev, { id, text, status: 'preparing…' }]);
    try {
      const beforeBids = new Set((data.replies ?? []).filter(b => b.creator === address).map(b => b.bid));

      await ensureRegistered(tezos, cfg, address, s => updatePending(id, { status: s }));

      updatePending(id, { status: 'uploading content…' });
      const contentHash = await postContent(text);

      updatePending(id, { status: 'signing transaction…' });
      const op = await sendCreateBit(tezos, cfg, contentHash, bid);

      updatePending(id, { status: `in mempool (${op.hash.slice(0, 10)}…), waiting for confirmation…` });
      await op.confirmation();

      updatePending(id, {
        status: 'confirmed, waiting for indexer…',
        match: (r: any) => r.creator === address && !beforeBids.has(r.bid),
        matchStartedAt: Date.now(),
      });
    } catch (e: any) {
      updatePending(id, { error: e.message ?? String(e) });
    }
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
            <div key={a.bid} className="bit" style={{ borderLeft: '3px solid var(--border-strong)', opacity: 0.85 }}>
              <div className="meta">
                <Link to={`/user/${a.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {a.creator_username ?? a.creator.slice(0, 12) + '…'}
                </Link>
                <span title={new Date(a.creation_time).toLocaleString()}>{formatBitDate(a.creation_time)}</span>
              </div>
              <div className="content">
                {a.content_moderated ? (
                  <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> moderated</span>
                ) : a.content ? (
                  <Markdown truncate>{a.content}</Markdown>
                ) : (
                  <span className="muted">no content</span>
                )}
              </div>
              <div className="footer">
                <Link to={`/bit/${a.bid}`} className="bit-hash" title="open bit page">
                  {a.bid.slice(0, 12)}…
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="bit" style={{ borderLeft: '3px solid var(--accent)' }}>
        <div className="meta">
          <Link to={`/user/${b.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
            {b.creator_username ?? b.creator.slice(0, 16) + '…'}
          </Link>
          <span title={new Date(b.creation_time).toLocaleString()}>{formatBitDate(b.creation_time)}</span>
        </div>
        <div className="content" style={{ fontSize: 16 }}>
          {b.content_moderated ? (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> content moderated — bytes withheld by indexer</span>
          ) : b.creator_moderated ? (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> creator moderated</span>
          ) : b.content ? (
            <Markdown>{b.content}</Markdown>
          ) : (
            <span className="muted">(content not uploaded — hash: {b.content_hash.slice(0, 12)}…)</span>
          )}
        </div>
        <div className="footer">
          {(() => {
            const pv = pendingVote;
            const total = pv ? pendingVoteTotal(b.my_vote, b.my_votes, pv.direction, pv.count) : 0;
            const cost = pv ? quadraticCostTez(kernelVars.BitVoteCost, total) : null;
            const insufficient = cost !== null && balance !== null && balance < cost;
            const busy = activeOp !== null;
            return (
              <>
                <button
                  onClick={() => bumpPendingVote('up')}
                  disabled={busy}
                  className={(b.my_vote === 'up' ? 'voted' : '') + (pv?.direction === 'up' ? ' pending' : '')}
                  title={b.my_vote === 'up' && b.my_votes ? `you voted up with ${b.my_votes}` : 'upvote'}
                >
                  {busy && activeOp?.kind === 'up' ? <Loader2 size={14} className="spinner" /> : <ChevronUp size={14} />}
                  {b.yay}
                  {pv?.direction === 'up' && <span className="vote-pending">+{pv.count}</span>}
                </button>
                <button
                  onClick={() => bumpPendingVote('down')}
                  disabled={busy}
                  className={(b.my_vote === 'down' ? 'voted' : '') + (pv?.direction === 'down' ? ' pending' : '')}
                  title={b.my_vote === 'down' && b.my_votes ? `you voted down with ${b.my_votes}` : 'downvote'}
                >
                  {busy && activeOp?.kind === 'down' ? <Loader2 size={14} className="spinner" /> : <ChevronDown size={14} />}
                  {b.nay}
                  {pv?.direction === 'down' && <span className="vote-pending">+{pv.count}</span>}
                </button>
                {pv && cost !== null && (
                  <>
                    <button
                      onClick={submitPendingVote}
                      disabled={busy || insufficient}
                      title={insufficient ? `need ${formatTez(cost)} ꜩ` : `submit ${pv.direction} vote (total ${total})`}
                    >
                      vote · {formatTez(cost)} ꜩ
                    </button>
                    <button
                      onClick={() => setPendingVote(null)}
                      disabled={busy}
                      className="icon-only"
                      title="clear pending vote"
                    >
                      <XIcon size={12} />
                    </button>
                  </>
                )}
              </>
            );
          })()}
          <button
            onClick={() => {
              if (!tezos || !address) { requestWallet(); return; }
              setReplying(r => !r);
            }}
            disabled={activeOp !== null}
          >
            <MessageCircle size={14} /> reply
          </button>
          <button onClick={moderate} disabled={activeOp !== null} title="propose to moderate this bit">
            {activeOp?.kind === 'mod' ? <Loader2 size={14} className="spinner" /> : <Flag size={14} />}
          </button>
          {activeOp?.status && (
            <span className="muted" style={{ fontStyle: 'italic' }}>{activeOp.status}</span>
          )}
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
            parent={b.bid}
            onSubmit={handleReply}
            onCancel={() => setReplying(false)}
            address={address}
            costMutez={kernelVars.BitCost ?? null}
            balance={balance}
          />
        </div>
      )}

      {(data.replies.length > 0 || pendingReplies.length > 0) && (
        <>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>
            {data.replies.length + pendingReplies.length} repl{(data.replies.length + pendingReplies.length) === 1 ? 'y' : 'ies'}
          </h3>
          {pendingReplies.map(p => (
            <PendingPost
              key={p.id}
              item={p}
              onDismiss={() => setPendingReplies(prev => prev.filter(x => x.id !== p.id))}
            />
          ))}
          {data.replies.map(r => (
            <div key={r.bid} className="bit">
              <div className="meta">
                <Link to={`/user/${r.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {r.creator_username ?? r.creator.slice(0, 12) + '…'}
                </Link>
                <span title={new Date(r.creation_time).toLocaleString()}>{formatBitDate(r.creation_time)}</span>
              </div>
              <div className="content">
                {r.content_moderated ? (
                  <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Flag size={14} /> moderated</span>
                ) : r.content ? (
                  <Markdown>{r.content}</Markdown>
                ) : (
                  <span className="muted">no content</span>
                )}
              </div>
              <div className="footer">
                <Link to={`/bit/${r.bid}`} className="bit-hash" title="open bit page">
                  {r.bid.slice(0, 12)}…
                </Link>
              </div>
            </div>
          ))}
        </>
      )}

      {data.votes.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>{data.votes.length} vote{data.votes.length === 1 ? '' : 's'}</h3>
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
