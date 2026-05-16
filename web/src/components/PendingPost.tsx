import { Loader2 } from 'lucide-react';

export type PendingItem<T = any> = {
  id: string;
  text: string;
  status: string;
  error?: string;
  match?: (item: T) => boolean;
  matchStartedAt?: number;
};

export function PendingPost({ item, onDismiss }: { item: PendingItem<any>; onDismiss?: () => void }) {
  return (
    <div
      className="bit"
      style={{
        opacity: item.error ? 1 : 0.85,
        borderLeft: item.error ? '3px solid #ff6b6b' : '3px dashed #5a6fe6',
      }}
    >
      <div className="meta">
        <span className="creator" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!item.error && <Loader2 size={12} className="spinner" />}
          {item.error ? 'failed' : 'posting…'}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>{item.error ? '' : item.status}</span>
      </div>
      <div className="content">{item.text}</div>
      {item.error && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="error">{item.error}</span>
          {onDismiss && (
            <button className="secondary" onClick={onDismiss}>dismiss</button>
          )}
        </div>
      )}
    </div>
  );
}
