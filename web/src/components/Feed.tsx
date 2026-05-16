import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Flag } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import { listBits } from '../api';
import type { Bit, Config } from '../api';
import { voteBit, createModContentAddPetition, isUserRegistered, registerUser } from '../tezos';

const PREVIEW_CHARS = 280;

function ContentPreview({ text }: { text: string; bid: string }) {
  if (text.length <= PREVIEW_CHARS) return <>{text}</>;
  const cut = text.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '');
  return <>{cut}…</>;
}

export function Feed({ tezos, cfg, address, refreshSignal }: { tezos: TezosToolkit; cfg: Config; address: string; refreshSignal: number }) {
  const [bits, setBits] = useState<Bit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

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

  async function ensureRegistered() {
    const r = await isUserRegistered(tezos, cfg, address);
    if (!r) {
      const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
      await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
    }
  }

  async function vote(bid: string, dir: boolean) {
    setBusy(bid);
    try {
      await voteBit(tezos, cfg, bid, dir, 1);
      await reload();
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function moderate(bit: Bit) {
    if (!confirm(`Propose moderation for this Bit?\n\nThis creates a petition to add ${bit.content_hash.slice(0, 12)}… to the moderation registry. Others must vote yay to pass.\n\nCosts PetitionContentModerationAddCost (1 tez on test config).`)) return;
    setBusy(bit.bid); setNotice('');
    try {
      await ensureRegistered();
      await createModContentAddPetition(tezos, cfg, bit.content_hash);
      setNotice('moderation petition created. switch to the petitions tab to vote and resolve.');
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading && bits.length === 0) return <p className="muted">loading feed…</p>;
  if (bits.length === 0) return <p className="muted">no bits yet. post something.</p>;

  return (
    <div>
      {notice && <div className="success" style={{ marginBottom: 12 }}>{notice}</div>}
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
