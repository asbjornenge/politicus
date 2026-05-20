import { useEffect, useState } from 'react';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import { InMemorySigner } from '@taquito/signer';
import { saveSecretKey } from '../tezos';

type Step = 'welcome' | 'new' | 'paste';

export function WalletGate({ onLoaded, onCancel }: { onLoaded: () => void; onCancel?: () => void }) {
  const [step, setStep] = useState<Step>('welcome');

  if (step === 'welcome') {
    return <Welcome onNew={() => setStep('new')} onPaste={() => setStep('paste')} onCancel={onCancel} />;
  }
  if (step === 'new') {
    return <NewAccount onDone={onLoaded} onBack={() => setStep('welcome')} />;
  }
  return <PasteKey onDone={onLoaded} onBack={() => setStep('welcome')} />;
}

function Welcome({ onNew, onPaste, onCancel }: { onNew: () => void; onPaste: () => void; onCancel?: () => void }) {
  return (
    <div className="wallet-gate">
      <h2>Join Politicus</h2>
      <p>To post, vote, or moderate you need a Tezos key. Choose one:</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        <button onClick={onNew} style={{ padding: '10px 16px', fontSize: 14 }}>
          I'm new — create a key for me
        </button>
        <button onClick={onPaste} className="secondary" style={{ padding: '10px 16px', fontSize: 14 }}>
          I have an account — paste my private key
        </button>
        {onCancel && (
          <button onClick={onCancel} className="secondary" style={{ padding: '8px 16px', fontSize: 13, marginTop: 8 }}>
            Maybe later — just let me look around
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>
        Either way, your private key is stored in this browser's localStorage. Dev mode only —
        a real wallet integration (Beacon / Temple / Kukai) is coming.
      </p>
    </div>
  );
}

function NewAccount({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [keypair, setKeypair] = useState<{ sk: string; address: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const seed = new Uint8Array(32);
      crypto.getRandomValues(seed);
      const sk = b58Encode(seed, PrefixV2.Ed25519Seed);
      const signer = await InMemorySigner.fromSecretKey(sk);
      const address = await signer.publicKeyHash();
      setKeypair({ sk, address });
    })();
  }, []);

  function complete() {
    if (!keypair) return;
    saveSecretKey(keypair.sk);
    onDone();
  }

  async function copyKey() {
    if (!keypair) return;
    try {
      await navigator.clipboard.writeText(keypair.sk);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (!keypair) {
    return (
      <div className="wallet-gate">
        <p className="muted">generating keypair…</p>
      </div>
    );
  }

  return (
    <div className="wallet-gate">
      <h2>Your new account</h2>
      <p style={{ fontSize: 13, color: '#aaa' }}>
        Your address (public — share freely):
      </p>
      <input readOnly value={keypair.address} onFocus={e => e.target.select()} />

      <p style={{ fontSize: 13, color: '#aaa', marginTop: 16 }}>
        Your private key — <strong>save this somewhere safe before continuing</strong>.
        Anyone with this key controls your account.
      </p>
      <input
        readOnly
        value={revealed ? keypair.sk : '•'.repeat(54)}
        type="text"
        onFocus={e => revealed && e.target.select()}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="secondary" onClick={() => setRevealed(r => !r)}>
          {revealed ? 'hide' : 'reveal'}
        </button>
        <button className="secondary" onClick={copyKey}>
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#aaa', marginTop: 16 }}>
        To post you'll need some test tez. Get some from the{' '}
        <a href="https://faucet.shadownet.teztnets.com" target="_blank" rel="noopener noreferrer" style={{ color: '#6a8fff' }}>
          Shadownet faucet
        </a>{' '}
        (paste your address there).
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13 }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
        I've saved my private key
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={complete} disabled={!saved}>Continue</button>
        <button onClick={onBack} className="secondary">Back</button>
      </div>
    </div>
  );
}

function PasteKey({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [sk, setSk] = useState('');
  const [err, setErr] = useState('');

  function load() {
    if (!sk.startsWith('edsk')) {
      setErr('expected an ed25519 secret key (starts with edsk)');
      return;
    }
    saveSecretKey(sk);
    onDone();
  }

  return (
    <div className="wallet-gate">
      <h2>Load existing account</h2>
      <p>
        Paste your Tezos ed25519 secret key (<code>edsk...</code>). Stored in browser localStorage.
      </p>
      <input
        type="password"
        placeholder="edsk..."
        value={sk}
        onChange={e => { setSk(e.target.value); setErr(''); }}
        autoFocus
      />
      {err && <div className="error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={load} disabled={!sk}>Load</button>
        <button onClick={onBack} className="secondary">Back</button>
      </div>
    </div>
  );
}
