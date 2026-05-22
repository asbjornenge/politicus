import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X, Bold, Italic, Link as LinkIcon, Quote, Code, Image as ImageIcon, Eye, Edit3 } from 'lucide-react';
import { Markdown } from './Markdown';

function draftKey(address: string | null, parent: string | undefined): string | null {
  if (!address) return null;
  return `politicus_draft:${address}:${parent ?? 'feed'}`;
}

export function Compose({
  onSubmit,
  parent,
  onCancel,
  placeholder,
  address,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  parent?: string;
  onCancel?: () => void;
  placeholder?: string;
  address?: string | null;
}) {
  const dKey = draftKey(address ?? null, parent);
  const [text, setText] = useState(() => (dKey ? localStorage.getItem(dKey) ?? '' : ''));
  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restored, setRestored] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (dKey && text.length > 0 && !restored) setRestored(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dKey) return;
    if (text.length === 0) localStorage.removeItem(dKey);
    else localStorage.setItem(dKey, text);
  }, [dKey, text]);

  function clearDraft() {
    if (dKey) localStorage.removeItem(dKey);
  }

  async function submit() {
    if (!text.trim()) return;
    const t = text;
    setText('');
    clearDraft();
    setSubmitting(true);
    setFullscreen(false);
    try {
      await onSubmit(t);
    } finally {
      setSubmitting(false);
    }
  }

  function applyWrap(prefix: string, suffix: string = prefix) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);
    const next = before + prefix + sel + suffix + after;
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }

  function applyLinePrefix(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const before = text.slice(0, lineStart);
    const block = text.slice(lineStart, end);
    const after = text.slice(end);
    const next = before + block.split('\n').map(l => prefix + l).join('\n') + after;
    setText(next);
    requestAnimationFrame(() => ta.focus());
  }

  function insertAtCursor(snippet: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertLink() {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = text.slice(start, end) || 'text';
    const url = window.prompt('URL', 'https://') || '';
    if (!url) return;
    const snippet = `[${sel}](${url})`;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => ta.focus());
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json();
      insertAtCursor(`\n![](${url})\n`);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!fullscreen) {
    return (
      <div className="compose">
        <textarea
          ref={taRef}
          placeholder={placeholder ?? (parent ? 'reply...' : 'post a bit...')}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={submitting}
        />
        <div className="actions">
          <span className="muted">
            {text.length} chars
            {restored && text.length > 0 && <span style={{ marginLeft: 8 }}>· draft restored</span>}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setFullscreen(true)}
              disabled={submitting}
              className="secondary icon-only"
              title="fullscreen editor"
            >
              <Maximize2 size={14} />
            </button>
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

  return (
    <>
      <div className="editor-overlay" role="dialog" aria-modal="true">
        <div className={`editor-modal${mobilePreview ? ' preview-on' : ''}`}>
          <div className="editor-head">
            <span className="editor-title">{parent ? 'reply' : 'new bit'}</span>
            <button className="secondary icon-only" onClick={() => setFullscreen(false)} title="exit fullscreen">
              <Minimize2 size={14} />
            </button>
          </div>
          <div className="editor-toolbar">
            <button className="secondary icon-only" title="bold" onClick={() => applyWrap('**')}><Bold size={14} /></button>
            <button className="secondary icon-only" title="italic" onClick={() => applyWrap('*')}><Italic size={14} /></button>
            <button className="secondary icon-only" title="link" onClick={insertLink}><LinkIcon size={14} /></button>
            <button className="secondary icon-only" title="quote" onClick={() => applyLinePrefix('> ')}><Quote size={14} /></button>
            <button className="secondary icon-only" title="code" onClick={() => applyWrap('`')}><Code size={14} /></button>
            <button
              className="secondary icon-only"
              title="upload image"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <ImageIcon size={14} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadImage(f);
              }}
            />
            {uploading && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>uploading…</span>}
            <button
              className="secondary icon-only mobile-only"
              title={mobilePreview ? 'edit' : 'preview'}
              onClick={() => setMobilePreview(p => !p)}
              style={{ marginLeft: 'auto' }}
            >
              {mobilePreview ? <Edit3 size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="editor-body">
            <textarea
              ref={taRef}
              className="editor-textarea"
              placeholder={placeholder ?? (parent ? 'reply...' : 'post a bit...')}
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={submitting}
            />
            <div className="editor-preview">
              {text.trim() ? <Markdown>{text}</Markdown> : <span className="muted">preview…</span>}
            </div>
          </div>
          <div className="editor-foot">
            <span className="muted">
              {text.length} chars
              {restored && text.length > 0 && <span style={{ marginLeft: 8 }}>· draft auto-saved</span>}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="secondary"
                onClick={() => { setText(''); clearDraft(); }}
                disabled={submitting || text.length === 0}
                title="discard draft"
              >
                <X size={14} /> discard
              </button>
              <button onClick={submit} disabled={submitting || text.trim().length === 0}>
                {parent ? 'reply' : 'post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
