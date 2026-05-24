import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Building2, Users, ChevronUp, ChevronDown, Flag, Shield } from 'lucide-react';
import type { TezosToolkit } from '@taquito/taquito';
import type { Config, SyndicateDetail } from '../api';
import { getSyndicate } from '../api';
import { formatBitDate } from '../utils';
import { Markdown } from './Markdown';

export function SyndicatePage({ tezos: _tezos, cfg: _cfg, address }: {
  tezos: TezosToolkit | null;
  cfg: Config;
  address: string | null;
}) {
  const { sid } = useParams<{ sid: string }>();
  const [data, setData] = useState<SyndicateDetail | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!sid) return;
    setLoading(true);
    try { setData(await getSyndicate(sid, address ?? undefined)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [sid, address]);

  if (loading && !data) return <p className="muted">loading…</p>;
  if (!data) return <p className="muted">syndicate not found.</p>;

  const { syndicate: s, members, bits } = data;
  const isMember = address && members.some(m => m.address === address);
  const isAdmin = address && members.some(m => m.address === address && m.is_admin);

  return (
    <div>
      <div className="bit">
        <div className="meta">
          <span className="creator" style={{ fontSize: 18, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={16} /> {s.name}
          </span>
          {isAdmin ? (
            <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Shield size={12} /> admin
            </span>
          ) : isMember ? (
            <span className="muted" style={{ fontSize: 12 }}>member</span>
          ) : null}
        </div>
        {s.bio && <div className="content" style={{ marginTop: 8 }}><Markdown>{s.bio}</Markdown></div>}
        <div className="muted" style={{ fontSize: 12, marginTop: 12, display: 'flex', gap: 14 }}>
          <span><Users size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{s.member_count} members ({s.admin_count} admin)</span>
          <span>{s.bit_count} bits</span>
        </div>
      </div>

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>members</h3>
      <div className="bit" style={{ padding: 12 }}>
        {members.map(m => (
          <div key={m.address} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
            <Link to={`/user/${m.address}`} style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {m.is_admin && <Shield size={12} style={{ color: 'var(--accent-soft)' }} />}
              <span>{m.username ?? m.address.slice(0, 12) + '…'}</span>
            </Link>
            <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{m.address.slice(0, 12)}…</span>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 24, marginBottom: 8 }}>
        bits ({bits.length})
      </h3>
      {bits.length === 0 && <p className="muted">no bits published under this syndicate yet.</p>}
      {bits.map(b => (
        <Link key={b.bid} to={`/bit/${b.bid}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bit">
            <div className="meta">
              <span className="creator">{b.creator_username ?? b.creator.slice(0, 12) + '…'}</span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <span title={new Date(b.creation_time).toLocaleString()}>{formatBitDate(b.creation_time)}</span>
                <ChevronUp size={14} /> {b.yay} <ChevronDown size={14} /> {b.nay}
              </span>
            </div>
            <div className="content">
              {b.content_moderated || b.creator_moderated ? (
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Flag size={14} /> moderated
                </span>
              ) : b.content ? (
                <Markdown truncate>{b.content}</Markdown>
              ) : (
                <span className="muted">no content</span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
