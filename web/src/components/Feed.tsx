import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import { listBits, postContent } from '../api';
import type { Bit, Config } from '../api';
import {
  voteBit, sendCreateBit, sendCreateModContentAddPetition,
  ensureRegistered,
} from '../tezos';
import { Compose } from './Compose';
import { PendingPost, type PendingItem } from './PendingPost';

const PREVIEW_CHARS = 280;

function ContentPreview({ text }: { text: string; bid: string }) {
  if (text.length <= PREVIEW_CHARS) return <>{text}</>;
  const cut = text.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '');
  return <>{cut}…</>;
}

export function Feed({ tezos, cfg, address }: { tezos: TezosToolkit; cfg: Config; address: string }) {
  const [bits, setBits] = useState<Bit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingItem<Bit>[]>([]);

  function updatePending(id: string, patch: Partial<PendingItem<Bit>>) {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }
  function removePending(id: string) {
    setPending(prev => prev.filter(p => p.id !== id));
  }

  const isWatching = pending.some(p => Boolean(p.match));

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await listBits();
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
      } catch (e) {
        if (!cancelled) console.error('poll error', e);
      }
    };
    tick();
    const handle = setInterval(tick, isWatching ? 2000 : 8000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [isWatching]);

  async function handleSubmit(text: string) {
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
    setBusy(bid);
    try {
      await ensureRegistered(tezos, cfg, address);
      await voteBit(tezos, cfg, bid, dir, 1);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function moderate(bit: Bit) {
    if (!confirm(`Propose moderation for this Bit?\n\nThis creates a petition. Costs PetitionContentModerationAddCost.`)) return;
    setBusy(bit.bid); setNotice('');
    try {
      await ensureRegistered(tezos, cfg, address);
      const op = await sendCreateModContentAddPetition(tezos, cfg, bit.content_hash);
      await op.confirmation();
      setNotice('moderation petition created. switch to the petitions tab to vote and resolve.');
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Compose onSubmit={handleSubmit} />
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
              <ContentPreview text={b.content} bid={b.bid} />
            ) : (
              <span className="muted">(content not yet uploaded — hash: {b.content_hash.slice(0, 12)}…)</span>
            )}
          </div>
          <div className="footer">
            <button onClick={() => vote(b.bid, true)} disabled={busy === b.bid}><ChevronUp size={14} /> {b.yay}</button>
            <button onClick={() => vote(b.bid, false)} disabled={busy === b.bid} className="secondary"><ChevronDown size={14} /> {b.nay}</button>
            <button onClick={() => moderate(b)} disabled={busy === b.bid} className="secondary" title="propose to moderate this bit"><Flag size={14} /></button>
            <Link
              to={`/bit/${b.bid}`}
              className="muted"
              style={{ fontFamily: 'monospace', textDecoration: 'none' }}
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
