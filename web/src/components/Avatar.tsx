import { Building2, User as UserIcon } from 'lucide-react';

export function Avatar({
  cid, gateway, size = 40, kind = 'user',
}: {
  cid: string | null | undefined;
  gateway: string;
  size?: number;
  kind?: 'user' | 'syndicate';
}) {
  const styleShared: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: kind === 'syndicate' ? 4 : '50%',
    flexShrink: 0,
  };
  if (!cid) {
    return (
      <span
        style={{
          ...styleShared,
          background: 'var(--bg-pre)',
          border: '1px solid var(--border)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
        }}
      >
        {kind === 'syndicate' ? <Building2 size={size * 0.5} /> : <UserIcon size={size * 0.5} />}
      </span>
    );
  }
  return (
    <img
      src={`${gateway}/${cid}`}
      alt=""
      style={{ ...styleShared, objectFit: 'cover', background: 'var(--bg-pre)' }}
    />
  );
}
