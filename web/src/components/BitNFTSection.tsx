import { useEffect, useState } from 'react';
import { Coins, Loader2, Sparkles } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Bit, Config, NFTCollection, NFTEdition } from '../api';
import { getEditionsForBit, getMyCollection } from '../api';
import {
  originateBitNFTCollection, sendRegisterCollection, sendMintEdition, sendBuyEdition,
} from '../tezos';
import { formatTez } from '../utils';

export function BitNFTSection({
  bit, tezos, cfg, address, balance,
}: {
  bit: Bit;
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
  balance: number | null;
}) {
  const [editions, setEditions] = useState<NFTEdition[]>([]);
  const [collection, setCollection] = useState<NFTCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMint, setShowMint] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [busyTokenId, setBusyTokenId] = useState<number | null>(null);

  const isOwn = address === bit.creator;

  async function reload() {
    setLoading(true);
    try {
      setEditions(await getEditionsForBit(bit.bid));
      if (isOwn && bit.creator) setCollection(await getMyCollection(bit.creator));
      else setCollection(null);
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [bit.bid, address]);

  async function handleMint(totalEditions: number, mintPriceTez: number, royaltyBps: number) {
    if (!tezos || !address) return;
    setErr(''); setStatus('preparing…');
    try {
      let collAddr = collection?.address;
      if (!collAddr) {
        setStatus('originating your collection…');
        const op = await originateBitNFTCollection(tezos, cfg, { kind: 'user', address });
        await op.confirmation();
        collAddr = op.contractAddress!;
        setStatus('registering collection with factory…');
        const reg = await sendRegisterCollection(tezos, cfg, collAddr, { kind: 'user', address });
        await reg.confirmation();
      }
      setStatus('minting edition…');
      const mintOp = await sendMintEdition(
        tezos, collAddr, bit.bid, totalEditions, Math.round(mintPriceTez * 1_000_000), royaltyBps,
      );
      await mintOp.confirmation();
      setStatus('waiting for indexer…');
      setShowMint(false);
      setTimeout(reload, 6000);
      setTimeout(() => setStatus(''), 8000);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setStatus('');
    }
  }

  async function handleBuy(e: NFTEdition) {
    if (!tezos || !address) return;
    setErr(''); setStatus('preparing…'); setBusyTokenId(e.token_id);
    try {
      setStatus('signing buy transaction…');
      const op = await sendBuyEdition(tezos, e.collection_address, e.token_id, e.mint_price);
      await op.confirmation();
      setStatus('waiting for indexer…');
      setTimeout(reload, 6000);
      setTimeout(() => { setStatus(''); setBusyTokenId(null); }, 8000);
    } catch (err: any) {
      setErr(err.message ?? String(err));
      setStatus(''); setBusyTokenId(null);
    }
  }

  if (loading) return null;
  if (editions.length === 0 && !isOwn) return null;

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={14} /> Editions
      </h3>

      {editions.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 10 }}>
          No editions yet. Mint this bit as a collectible — readers can buy a numbered copy as a signal of patronage.
        </p>
      )}

      {editions.map(e => (
        <div key={e.token_id} className="bit" style={{ marginBottom: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 14 }}>
                Edition #{e.token_id} — {e.sold}/{e.total_editions} sold
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                royalty {(e.royalty_bps / 100).toFixed(1)}% · platform primary fee {(e.treasury_primary_bps / 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                {formatTez(e.mint_price / 1_000_000)} ꜩ
              </span>
              {!isOwn && tezos && address && (
                <button
                  onClick={() => handleBuy(e)}
                  disabled={busyTokenId !== null || e.sold >= e.total_editions || (balance !== null && balance < e.mint_price / 1_000_000)}
                  title={e.sold >= e.total_editions ? 'sold out' : balance !== null && balance < e.mint_price / 1_000_000 ? 'insufficient balance' : 'buy edition'}
                >
                  {busyTokenId === e.token_id
                    ? <Loader2 size={14} className="spinner" />
                    : <><Coins size={14} /> {e.sold >= e.total_editions ? 'sold out' : 'buy'}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {isOwn && tezos && (
        <div style={{ marginTop: 10 }}>
          {showMint ? (
            <MintEditionForm
              onSubmit={handleMint}
              onCancel={() => setShowMint(false)}
              busy={!!status}
            />
          ) : (
            <button onClick={() => setShowMint(true)}>
              <Sparkles size={14} /> {editions.length === 0 ? 'Mint as collectible' : 'Mint another edition'}
            </button>
          )}
        </div>
      )}

      {status && <div className="muted" style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic' }}>{status}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function MintEditionForm({
  onSubmit, onCancel, busy,
}: {
  onSubmit: (total: number, priceTez: number, royaltyBps: number) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [total, setTotal] = useState('1');
  const [price, setPrice] = useState('5');
  const [royalty, setRoyalty] = useState('5');

  const totalN = Math.max(1, Math.floor(Number(total) || 1));
  const priceN = Math.max(0, Number(price) || 0);
  const royaltyBps = Math.max(0, Math.min(2500, Math.round((Number(royalty) || 0) * 100)));

  const fieldStyle: React.CSSProperties = {
    flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'inherit', padding: 6, borderRadius: 4, fontFamily: 'inherit', fontSize: 13,
  };

  return (
    <div className="compose" style={{ marginTop: 4 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
        First time? A small collection contract is originated under your address (~0.5 ꜩ origination), then editions live there.
        Platform takes its primary-fee cut (snapshotted now, immutable per edition).
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--text-muted)' }}>
          Total editions
          <input style={fieldStyle} value={total} onChange={e => setTotal(e.target.value)} disabled={busy} />
        </label>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--text-muted)' }}>
          Price (ꜩ)
          <input style={fieldStyle} value={price} onChange={e => setPrice(e.target.value)} disabled={busy} />
        </label>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--text-muted)' }}>
          Royalty (%) ≤ 25
          <input style={fieldStyle} value={royalty} onChange={e => setRoyalty(e.target.value)} disabled={busy} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSubmit(totalN, priceN, royaltyBps)} disabled={busy}>
          {busy ? 'minting…' : 'mint'}
        </button>
        <button onClick={onCancel} className="secondary" disabled={busy}>cancel</button>
      </div>
    </div>
  );
}
