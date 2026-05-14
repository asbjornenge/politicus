import { useState } from 'react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config } from '../api';
import { postContent } from '../api';
import { createBit, isUserRegistered, registerUser, readVariable } from '../tezos';

export function Compose({
  tezos,
  cfg,
  address,
  onPosted,
}: {
  tezos: TezosToolkit;
  cfg: Config;
  address: string;
  onPosted: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function post() {
    setErr(''); setStatus(''); setBusy(true);
    try {
      const registered = await isUserRegistered(tezos, cfg, address);
      if (!registered) {
        setStatus('not registered — registering as anonymous first...');
        const placeholderHash = `00${address.slice(-62)}`.padStart(64, '0');
        await registerUser(tezos, cfg, { brightidHash: placeholderHash, username: address.slice(0, 8), bio: '' });
      }

      setStatus('uploading content...');
      const hash = await postContent(text);

      const cost = await readVariable(tezos, cfg, 'BitCost');
      setStatus(`creating Bit on-chain (${cost} mutez)...`);
      const opHash = await createBit(tezos, cfg, hash);
      setStatus(`✓ posted (${opHash.slice(0, 12)}…). indexer will pick it up in a few seconds.`);
      setText('');
      onPosted();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compose">
      <textarea
        placeholder="post a bit..."
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={busy}
      />
      <div className="actions">
        <span className="muted">{status || `${text.length} chars`}</span>
        <button onClick={post} disabled={busy || text.length === 0}>
          {busy ? 'posting…' : 'post'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
