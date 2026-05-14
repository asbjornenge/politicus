import { useEffect, useState } from 'react';
import type { TezosToolkit } from '@taquito/taquito';
import { listBits } from '../api';
import type { Bit, Config } from '../api';
import { voteBit } from '../tezos';

export function Feed({ tezos, cfg, refreshSignal }: { tezos: TezosToolkit; cfg: Config; refreshSignal: number }) {
  const [bits, setBits] = useState<Bit[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const b = await listBits();
      setBits(b);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [refreshSignal]);

  useEffect(() => {
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, []);

  async function vote(bid: string, dir: boolean) {
    setVoting(bid);
    try {
      await voteBit(tezos, cfg, bid, dir, 1);
      await reload();
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setVoting(null);
    }
  }

  if (loading && bits.length === 0) return <p className="muted">loading feed…</p>;
  if (bits.length === 0) return <p className="muted">no bits yet. post something.</p>;

  return (
    <div>
      {bits.map(b => (
        <div key={b.bid} className="bit">
          <div className="meta">
            <span className="creator">
              {b.creator_username ?? b.creator.slice(0, 12) + '…'}
            </span>
            <span>{new Date(b.creation_time).toLocaleString()}</span>
          </div>
          <div className="content">
            {b.content ?? <span className="muted">(content not yet uploaded to API — hash: {b.content_hash.slice(0, 12)}…)</span>}
          </div>
          <div className="footer">
            <button onClick={() => vote(b.bid, true)} disabled={voting === b.bid}>↑ {b.yay}</button>
            <button onClick={() => vote(b.bid, false)} disabled={voting === b.bid} className="secondary">↓ {b.nay}</button>
            <span className="muted">{b.bid.slice(0, 12)}…</span>
          </div>
        </div>
      ))}
    </div>
  );
}
