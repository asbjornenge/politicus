import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { User, LogOut, AlertCircle } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import { formatTez, LOW_BALANCE_TEZ } from './utils';
import { Feed } from './components/Feed';
import { Petitions } from './components/Petitions';
import { BitPage } from './components/BitPage';
import { PetitionPage } from './components/PetitionPage';
import { ProfilePage } from './components/ProfilePage';
import { AboutPage } from './components/AboutPage';
import { WalletGate } from './components/WalletGate';
import { getConfig } from './api';
import type { Config } from './api';
import { loadSecretKey, buildToolkit, clearSecretKey } from './tezos';

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [tezos, setTezos] = useState<TezosToolkit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [walletPromptOpen, setWalletPromptOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
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

  useEffect(() => {
    if (!tezos || !address) { setBalance(null); return; }
    let cancelled = false;
    async function fetchBalance() {
      try {
        const b = await tezos!.tz.getBalance(address!);
        if (!cancelled) setBalance(b.toNumber() / 1_000_000);
      } catch { /* ignore */ }
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);
    const onFocus = () => fetchBalance();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [tezos, address]);

  function logout() {
    clearSecretKey();
    setTezos(null); setAddress(null);
    setBalance(null);
  }

  const requestWallet = () => setWalletPromptOpen(true);

  if (err) return <p className="error">failed to load config: {err}</p>;
  if (!cfg) return <p className="muted">loading…</p>;

  const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    color: isActive ? 'var(--text)' : 'var(--text-muted)',
    padding: '8px 4px',
    marginBottom: -1,
    borderBottom: isActive ? '2px solid var(--text)' : '2px solid transparent',
    textDecoration: 'none',
    fontSize: 14,
  });

  return (
    <HashRouter>
      <header>
        <NavLink to="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <img src="/seal.png" alt="" className="brand-mark" />
          <div className="brand-text">
            <h1>politicus</h1>
            <hr className="brand-rule" />
            <p className="tagline">Signed, civic, durable.</p>
          </div>
        </NavLink>
        <div className="user-actions">
          {address ? (
            <>
              <NavLink
                to={`/user/${address}`}
                className={`me${balance !== null && balance < LOW_BALANCE_TEZ ? ' low' : ''}`}
                title={`${address}${balance !== null ? ` — ${formatTez(balance)} ꜩ` : ''}`}
              >
                {balance !== null && balance < LOW_BALANCE_TEZ ? <AlertCircle size={14} /> : <User size={14} />}
                <span className="hide-mobile">{address.slice(0, 8)}…</span>
                {balance !== null && (
                  <span className="balance hide-mobile">{formatTez(balance)} ꜩ</span>
                )}
              </NavLink>
              <button className="secondary" onClick={logout} title="logout">
                <LogOut size={14} />
                <span className="hide-mobile">logout</span>
              </button>
            </>
          ) : (
            <button onClick={requestWallet}>Join / Login</button>
          )}
        </div>
      </header>
      <nav style={{ display: 'flex', gap: 24, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <NavLink to="/" end style={navLinkStyle}>feed</NavLink>
        <NavLink to="/petitions" style={navLinkStyle}>petitions</NavLink>
        <NavLink to="/about" style={navLinkStyle}>about</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Feed tezos={tezos} cfg={cfg} address={address} requestWallet={requestWallet} />} />
        <Route path="/petitions" element={<Petitions tezos={tezos} cfg={cfg} address={address} requestWallet={requestWallet} />} />
        <Route path="/bit/:bid" element={<BitPage tezos={tezos} cfg={cfg} address={address} requestWallet={requestWallet} />} />
        <Route path="/petition/:pid" element={<PetitionPage tezos={tezos} cfg={cfg} address={address} requestWallet={requestWallet} />} />
        <Route path="/user/:address" element={<ProfilePage tezos={tezos} cfg={cfg} address={address} balance={balance} />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
      {walletPromptOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <WalletGate
            onLoaded={() => { setWalletPromptOpen(false); window.location.reload(); }}
            onCancel={() => setWalletPromptOpen(false)}
            faucetUrl={cfg.faucetUrl}
          />
        </div>
      )}
    </HashRouter>
  );
}
