import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag, Loader2, X as XIcon, Building2 } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import { listBits, postContent, listMySyndicates } from '../api';
import type { Bit, Config, Syndicate } from '../api';
import {
  sendVoteBit, sendCreateBit, sendCreateModContentAddPetition,
  ensureRegistered,
} from '../tezos';
import { Compose } from './Compose';
import { PendingPost, type PendingItem } from './PendingPost';
import { Markdown } from './Markdown';
import { formatBitDate, formatTez, pendingVoteTotal, quadraticCostTez } from '../utils';

type PendingVote = { direction: 'up' | 'down'; count: number };

export function Feed({ tezos, cfg, address, balance, kernelVars, requestWallet }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  balance: number | null;
  kernelVars: Record<string, string>;
  requestWallet: () => void;
}) {
  const [bits, setBits] = useState<Bit[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState<{
    bid: string;
    kind: 'up' | 'down' | 'mod';
    status?: string;
    match?: (b: Bit) => boolean;
    startedAt?: number;
  } | null>(null);

  function patchActiveOp(patch: Partial<NonNullable<typeof activeOp>>) {
    setActiveOp(prev => prev ? { ...prev, ...patch } : null);
  }
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingItem<Bit>[]>([]);
  const [pendingVotes, setPendingVotes] = useState<Record<string, PendingVote>>({});
  const [mySyndicates, setMySyndicates] = useState<Array<Syndicate & { is_admin: boolean }>>([]);

  useEffect(() => {
    if (!address) { setMySyndicates([]); return; }
    listMySyndicates(address).then(setMySyndicates).catch(() => {});
  }, [address]);

  function bumpPendingVote(bid: string, dir: 'up' | 'down') {
    setPendingVotes(prev => {
      const cur = prev[bid];
      if (!cur || cur.direction !== dir) return { ...prev, [bid]: { direction: dir, count: 1 } };
      return { ...prev, [bid]: { direction: dir, count: cur.count + 1 } };
    });
  }
  function clearPendingVote(bid: string) {
    setPendingVotes(prev => {
      const next = { ...prev };
      delete next[bid];
      return next;
    });
  }

  function updatePending(id: string, patch: Partial<PendingItem<Bit>>) {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }
  function removePending(id: string) {
    setPending(prev => prev.filter(p => p.id !== id));
  }

  const isWatching = pending.some(p => Boolean(p.match)) || Boolean(activeOp?.match);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await listBits(address ?? undefined);
        if (cancelled) return;
        setBits(fresh);
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

  async function handleSubmit(text: string, syndicate: string | null) {
    if (!tezos || !address) { requestWallet(); return; }
    const id = crypto.randomUUID();
    setPending(prev => [{ id, text, status: 'preparing…' }, ...prev]);

    try {
      const beforeBids = new Set(bits.filter(b => b.creator === address).map(b => b.bid));

      await ensureRegistered(tezos, cfg, address, s => updatePending(id, { status: s }));

      updatePending(id, { status: 'uploading content…' });
      const contentHash = await postContent(text);

      updatePending(id, { status: 'signing transaction…' });
      const op = await sendCreateBit(tezos, cfg, contentHash, null, syndicate);

      updatePending(id, { status: `in mempool (${op.hash.slice(0, 10)}…), waiting for confirmation…` });
      await op.confirmation();

      updatePending(id, {
        status: 'confirmed, waiting for indexer…',
        match: (b: Bit) => b.creator === address && !beforeBids.has(b.bid),
        matchStartedAt: Date.now(),
      });
    } catch (e: any) {
      updatePending(id, { error: e.message ?? String(e) });
    }
  }

  async function submitPendingVote(bid: string) {
    if (!tezos || !address) { requestWallet(); return; }
    const p = pendingVotes[bid];
    if (!p) return;
    const before = bits.find(b => b.bid === bid);
    const beforeYay = before?.yay ?? 0;
    const beforeNay = before?.nay ?? 0;
    const total = pendingVoteTotal(before?.my_vote ?? null, before?.my_votes ?? null, p.direction, p.count);
    const dir = p.direction === 'up';
    setActiveOp({ bid, kind: dir ? 'up' : 'down', status: 'preparing…' });
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendVoteBit(tezos, cfg, bid, dir, total);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      clearPendingVote(bid);
      setActiveOp({
        bid,
        kind: dir ? 'up' : 'down',
        status: 'waiting for indexer…',
        match: (b: Bit) => b.bid === bid && (b.yay !== beforeYay || b.nay !== beforeNay),
        startedAt: Date.now(),
      });
    } catch (e: any) {
      alert(e.message ?? String(e));
      setActiveOp(null);
    }
  }

  async function moderate(bit: Bit) {
    if (!tezos || !address) { requestWallet(); return; }
    if (!confirm(`Propose moderation for this Bit?\n\nThis creates a petition. Costs PetitionContentModerationAddCost.`)) return;
    setActiveOp({ bid: bit.bid, kind: 'mod', status: 'preparing…' }); setNotice('');
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendCreateModContentAddPetition(tezos, cfg, bit.content_hash);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
      setNotice('moderation petition created. switch to the petitions tab to vote and resolve.');
      setActiveOp(null);
    } catch (e: any) {
      alert(e.message ?? String(e));
      setActiveOp(null);
    }
  }

  return (
    <div>
      {tezos && address ? (
        <Compose
          onSubmit={handleSubmit}
          address={address}
          costMutez={kernelVars.BitCost ?? null}
          balance={balance}
          syndicates={mySyndicates}
        />
      ) : (
        <div className="compose" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted">Sign in to post a bit</span>
          <button onClick={requestWallet}>Join</button>
        </div>
      )}
      {notice && <div className="success" style={{ marginBottom: 12 }}>{notice}</div>}
      {pending.map(p => (
        <PendingPost key={p.id} item={p} onDismiss={() => removePending(p.id)} />
      ))}
      {loading && bits.length === 0 && pending.length === 0 && <p className="muted">loading feed…</p>}
      {bits.length === 0 && !loading && pending.length === 0 && <p className="muted">no bits yet. post something.</p>}
      {bits.map(b => (
        <div key={b.bid} className="bit">
          <div className="meta">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {b.syndicate ? (
                <>
                  <Link
                    to={`/syndicate/${b.syndicate}`}
                    className="creator"
                    style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Building2 size={13} /> {b.syndicate_name ?? 'syndicate'}
                  </Link>
                  <span className="muted" style={{ fontSize: 11 }}>
                    by{' '}
                    <Link to={`/user/${b.creator}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {b.creator_username ?? b.creator.slice(0, 12) + '…'}
                    </Link>
                  </span>
                </>
              ) : (
                <Link to={`/user/${b.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {b.creator_username ?? b.creator.slice(0, 12) + '…'}
                </Link>
              )}
            </span>
            <span title={new Date(b.creation_time).toLocaleString()}>{formatBitDate(b.creation_time)}</span>
          </div>
          <div className="content">
            {b.content_moderated ? (
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Flag size={14} /> content moderated — bytes withheld by indexer (hash: {b.content_hash.slice(0, 12)}…)
              </span>
            ) : b.creator_moderated ? (
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Flag size={14} /> creator moderated — content withheld
              </span>
            ) : b.content ? (
              <Markdown truncate>{b.content}</Markdown>
            ) : (
              <span className="muted">(content not yet uploaded — hash: {b.content_hash.slice(0, 12)}…)</span>
            )}
          </div>
          <div className="footer">
            {(() => {
              const pv = pendingVotes[b.bid];
              const total = pv ? pendingVoteTotal(b.my_vote, b.my_votes, pv.direction, pv.count) : 0;
              const cost = pv ? quadraticCostTez(kernelVars.BitVoteCost, total) : null;
              const insufficient = cost !== null && balance !== null && balance < cost;
              const busy = activeOp?.bid === b.bid;
              return (
                <>
                  <button
                    onClick={() => bumpPendingVote(b.bid, 'up')}
                    disabled={busy}
                    className={(b.my_vote === 'up' ? 'voted' : '') + (pv?.direction === 'up' ? ' pending' : '')}
                    title={b.my_vote === 'up' && b.my_votes ? `you voted up with ${b.my_votes}` : 'upvote'}
                  >
                    {busy && activeOp?.kind === 'up' ? <Loader2 size={14} className="spinner" /> : <ChevronUp size={14} />}
                    {b.yay}
                    {pv?.direction === 'up' && <span className="vote-pending">+{pv.count}</span>}
                  </button>
                  <button
                    onClick={() => bumpPendingVote(b.bid, 'down')}
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
                        onClick={() => submitPendingVote(b.bid)}
                        disabled={busy || insufficient}
                        title={insufficient ? `need ${formatTez(cost)} ꜩ` : `submit ${pv.direction} vote (total ${total})`}
                      >
                        vote · {formatTez(cost)} ꜩ
                      </button>
                      <button
                        onClick={() => clearPendingVote(b.bid)}
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
            <button onClick={() => moderate(b)} disabled={activeOp?.bid === b.bid} title="propose to moderate this bit">
              {activeOp?.bid === b.bid && activeOp.kind === 'mod' ? <Loader2 size={14} className="spinner" /> : <Flag size={14} />}
            </button>
            {activeOp?.bid === b.bid && activeOp.status && (
              <span className="muted" style={{ fontStyle: 'italic' }}>{activeOp.status}</span>
            )}
            <Link to={`/bit/${b.bid}`} className="bit-hash" title="open bit page">
              {b.bid.slice(0, 12)}…
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
