import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import type { Bit } from '../api';
import { formatBitDate } from '../utils';

export function BitMeta({ bit, right }: { bit: Bit; right?: React.ReactNode }) {
  return (
    <div className="meta">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {bit.syndicate ? (
          <>
            <Link
              to={`/syndicate/${bit.syndicate}`}
              className="creator"
              style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={e => e.stopPropagation()}
            >
              <Building2 size={13} /> {bit.syndicate_name ?? 'syndicate'}
            </Link>
            <span className="muted" style={{ fontSize: 11 }}>
              by{' '}
              <Link
                to={`/user/${bit.creator}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
                onClick={e => e.stopPropagation()}
              >
                {bit.creator_username ?? bit.creator.slice(0, 12) + '…'}
              </Link>
            </span>
          </>
        ) : (
          <Link
            to={`/user/${bit.creator}`}
            className="creator"
            style={{ color: 'inherit', textDecoration: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            {bit.creator_username ?? bit.creator.slice(0, 12) + '…'}
          </Link>
        )}
      </span>
      {right ?? (
        <span title={new Date(bit.creation_time).toLocaleString()}>{formatBitDate(bit.creation_time)}</span>
      )}
    </div>
  );
}
