import { useState } from 'react';
import { saveSecretKey } from '../tezos';

export function WalletGate({ onLoaded }: { onLoaded: () => void }) {
  const [sk, setSk] = useState('');
  const [err, setErr] = useState('');

  function load() {
    if (!sk.startsWith('edsk')) {
      setErr('expected an ed25519 secret key (starts with edsk)');
      return;
    }
    saveSecretKey(sk);
    onLoaded();
  }

  return (
    <div className="wallet-gate">
      <h2>Load wallet</h2>
      <p>
        Paste a Tezos ed25519 secret key (<code>edsk...</code>). For dev only —
        the key is stored in browser localStorage. Use your <code>.env</code>'s{' '}
        <code>POLITICUS_PRIVATE_KEY</code> for testing.
      </p>
      <input
        type="password"
        placeholder="edsk..."
        value={sk}
        onChange={e => { setSk(e.target.value); setErr(''); }}
      />
      {err && <div className="error">{err}</div>}
      <button onClick={load} disabled={!sk}>Load</button>
    </div>
  );
}
