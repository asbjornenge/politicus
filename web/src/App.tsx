import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import type { TezosToolkit } from '@taquito/taquito';
import { Compose } from './components/Compose';
import { Feed } from './components/Feed';
import { Petitions } from './components/Petitions';
import { BitPage } from './components/BitPage';
import { PetitionPage } from './components/PetitionPage';
import { ProfilePage } from './components/ProfilePage';
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

  const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    background: isActive ? '#4a5fd6' : 'transparent',
    color: isActive ? 'white' : '#aaa',
    border: isActive ? 'none' : '1px solid #3a3a45',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    textDecoration: 'none',
  });

  return (
    <HashRouter>
      <header>
        <h1><NavLink to="/" style={{ color: 'inherit', textDecoration: 'none' }}>politicus</NavLink></h1>
        <div>
          <NavLink to={`/user/${address}`} className="me" style={{ color: 'inherit', textDecoration: 'none' }}>
            {address.slice(0, 12)}…
          </NavLink>
          <button className="secondary" onClick={logout} style={{ marginLeft: 8 }}>logout</button>
        </div>
      </header>
      <nav style={{ display: 'flex', gap: 12, marginBottom: 20, borderBottom: '1px solid #2a2a32', paddingBottom: 8 }}>
        <NavLink to="/" end style={navLinkStyle}>feed</NavLink>
        <NavLink to="/petitions" style={navLinkStyle}>petitions</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={
          <>
            <Compose
              tezos={tezos}
              cfg={cfg}
              address={address}
              onPosted={() => setRefreshSignal(s => s + 1)}
            />
            <Feed tezos={tezos} cfg={cfg} address={address} refreshSignal={refreshSignal} />
          </>
        } />
        <Route path="/petitions" element={<Petitions tezos={tezos} cfg={cfg} address={address} />} />
        <Route path="/bit/:bid" element={<BitPage tezos={tezos} cfg={cfg} address={address} />} />
        <Route path="/petition/:pid" element={<PetitionPage tezos={tezos} cfg={cfg} address={address} />} />
        <Route path="/user/:address" element={<ProfilePage tezos={tezos} cfg={cfg} address={address} />} />
      </Routes>
    </HashRouter>
  );
}
