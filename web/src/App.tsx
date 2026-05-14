import { useEffect, useState } from 'react';
import type { TezosToolkit } from '@taquito/taquito';
import { Compose } from './components/Compose';
import { Feed } from './components/Feed';
import { WalletGate } from './components/WalletGate';
import { getConfig } from './api';
import type { Config } from './api';
import { loadSecretKey, buildToolkit, clearSecretKey } from './tezos';

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [tezos, setTezos] = useState<TezosToolkit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const c = await getConfig();
        setCfg(c);
        const sk = loadSecretKey();
        if (sk) {
          const { tezos, address } = await buildToolkit(c, sk);
          setTezos(tezos); setAddress(address);
        }
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, []);

  function logout() {
    clearSecretKey();
    setTezos(null); setAddress(null);
  }

  if (err) return <p className="error">failed to load config: {err}</p>;
  if (!cfg) return <p className="muted">loading…</p>;

  if (!tezos || !address) {
    return <WalletGate onLoaded={() => window.location.reload()} />;
  }

  return (
    <>
      <header>
        <h1>politicus</h1>
        <div>
          <span className="me">{address.slice(0, 12)}…</span>
          <button className="secondary" onClick={logout} style={{ marginLeft: 8 }}>logout</button>
        </div>
      </header>
      <Compose
        tezos={tezos}
        cfg={cfg}
        address={address}
        onPosted={() => setRefreshSignal(s => s + 1)}
      />
      <Feed tezos={tezos} cfg={cfg} refreshSignal={refreshSignal} />
    </>
  );
}
