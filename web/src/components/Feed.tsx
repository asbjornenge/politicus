import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag, Loader2 } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import { listBits, postContent } from '../api';
import type { Bit, Config } from '../api';
import {
  sendVoteBit, sendCreateBit, sendCreateModContentAddPetition,
  ensureRegistered,
} from '../tezos';
import { Compose } from './Compose';
import { PendingPost, type PendingItem } from './PendingPost';
import { Markdown } from './Markdown';

export function Feed({ tezos, cfg, address, requestWallet }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
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

  async function handleSubmit(text: string) {
    if (!tezos || !address) { requestWallet(); return; }
    const id = crypto.randomUUID();
    setPending(prev => [{ id, text, status: 'preparing…' }, ...prev]);

    try {
      const beforeBids = new Set(bits.filter(b => b.creator === address).map(b => b.bid));

      await ensureRegistered(tezos, cfg, address, s => updatePending(id, { status: s }));

      updatePending(id, { status: 'uploading content…' });
      const contentHash = await postContent(text);

      updatePending(id, { status: 'signing transaction…' });
      const op = await sendCreateBit(tezos, cfg, contentHash);

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

  async function vote(bid: string, dir: boolean) {
    if (!tezos || !address) { requestWallet(); return; }
    const before = bits.find(b => b.bid === bid);
    const beforeYay = before?.yay ?? 0;
    const beforeNay = before?.nay ?? 0;
    setActiveOp({ bid, kind: dir ? 'up' : 'down', status: 'preparing…' });
    try {
      await ensureRegistered(tezos, cfg, address, s => patchActiveOp({ status: s }));
      patchActiveOp({ status: 'signing transaction…' });
      const op = await sendVoteBit(tezos, cfg, bid, dir, 1);
      patchActiveOp({ status: `in mempool (${op.hash.slice(0, 10)}…)` });
      await op.confirmation();
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
        <Compose onSubmit={handleSubmit} />
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
            <Link to={`/user/${b.creator}`} className="creator" style={{ color: 'inherit', textDecoration: 'none' }}>
              {b.creator_username ?? b.creator.slice(0, 12) + '…'}
            </Link>
            <span>{new Date(b.creation_time).toLocaleString()}</span>
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
            <button
              onClick={() => vote(b.bid, true)}
              disabled={activeOp?.bid === b.bid || b.my_vote === 'up'}
              title={b.my_vote === 'up' ? 'you already voted up' : undefined}
            >
              {activeOp?.bid === b.bid && activeOp.kind === 'up' ? <Loader2 size={14} className="spinner" /> : <ChevronUp size={14} />}
              {b.yay}
            </button>
            <button
              onClick={() => vote(b.bid, false)}
              disabled={activeOp?.bid === b.bid || b.my_vote === 'down'}
              className="secondary"
              title={b.my_vote === 'down' ? 'you already voted down' : undefined}
            >
              {activeOp?.bid === b.bid && activeOp.kind === 'down' ? <Loader2 size={14} className="spinner" /> : <ChevronDown size={14} />}
              {b.nay}
            </button>
            <button onClick={() => moderate(b)} disabled={activeOp?.bid === b.bid} className="secondary" title="propose to moderate this bit">
              {activeOp?.bid === b.bid && activeOp.kind === 'mod' ? <Loader2 size={14} className="spinner" /> : <Flag size={14} />}
            </button>
            {activeOp?.bid === b.bid && activeOp.status && (
              <span className="muted" style={{ fontStyle: 'italic' }}>{activeOp.status}</span>
            )}
            <Link
              to={`/bit/${b.bid}`}
              className="muted"
              style={{ fontFamily: 'monospace', textDecoration: 'none', marginLeft: 'auto' }}
              title="open bit page"
            >
              {b.bid.slice(0, 12)}…
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
