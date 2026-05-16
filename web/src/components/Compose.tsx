import { useState } from 'react';

export function Compose({
  onSubmit,
  parent,
  onCancel,
  placeholder,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  parent?: string;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    const t = text;
    setText('');
    setSubmitting(true);
    try {
      await onSubmit(t);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="compose">
      <textarea
        placeholder={placeholder ?? (parent ? 'reply...' : 'post a bit...')}
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={submitting}
      />
      <div className="actions">
        <span className="muted">{text.length} chars</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && (
            <button onClick={onCancel} disabled={submitting} className="secondary">cancel</button>
          )}
          <button onClick={submit} disabled={submitting || text.trim().length === 0}>
            {parent ? 'reply' : 'post'}
          </button>
        </div>
      </div>
    </div>
  );
}
