import { useEffect, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, X, Bold, Italic, Link as LinkIcon, Quote, Code,
  Image as ImageIcon, Eye, Edit3, FilePlus, FileText, ChevronDown,
} from 'lucide-react';
import { Markdown } from './Markdown';
import { formatTez } from '../utils';

type Draft = { id: string; text: string; updated_at: number };

function keyPrefix(addr: string, scope: string) {
  return `politicus_draft:${addr}:${scope}:`;
}

function loadDrafts(addr: string | null, scope: string): Draft[] {
  if (!addr) return [];
  const prefix = keyPrefix(addr, scope);
  const out: Draft[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const raw = JSON.parse(localStorage.getItem(k) || '{}');
      out.push({ id: k.slice(prefix.length), text: raw.text || '', updated_at: raw.updated_at || 0 });
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => b.updated_at - a.updated_at);
}

function persistDraft(addr: string, scope: string, id: string, text: string) {
  localStorage.setItem(keyPrefix(addr, scope) + id, JSON.stringify({ text, updated_at: Date.now() }));
}

function removeDraft(addr: string, scope: string, id: string) {
  localStorage.removeItem(keyPrefix(addr, scope) + id);
}

function migrateLegacy(addr: string, scope: string): Draft | null {
  const legacyKey = `politicus_draft:${addr}:${scope}`;
  const v = localStorage.getItem(legacyKey);
  if (!v) return null;
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  persistDraft(addr, scope, id, v);
  localStorage.removeItem(legacyKey);
  return { id, text: v, updated_at: Date.now() };
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function snippet(s: string, n = 50) {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine || 'empty';
}

function relTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function Compose({
  onSubmit,
  parent,
  onCancel,
  placeholder,
  address,
  costMutez,
  balance,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  parent?: string;
  onCancel?: () => void;
  placeholder?: string;
  address?: string | null;
  costMutez?: string | null;
  balance?: number | null;
}) {
  const costTez = costMutez ? Number(costMutez) / 1_000_000 : null;
  const insufficient = costTez !== null && balance !== null && balance !== undefined && balance < costTez;
  const submitLabel = parent ? 'reply' : 'post';
  const submitText = costTez !== null ? `${submitLabel} · ${formatTez(costTez)} ꜩ` : submitLabel;
  const submitTitle = insufficient ? `insufficient balance — need ${formatTez(costTez!)} ꜩ` : undefined;
  const scope = parent ?? 'feed';
  const addr = address ?? null;

  const [drafts, setDrafts] = useState<Draft[]>(() => {
    if (!addr) return [];
    const migrated = migrateLegacy(addr, scope);
    const list = loadDrafts(addr, scope);
    return migrated && !list.some(d => d.id === migrated.id) ? [migrated, ...list] : list;
  });
  const [currentId, setCurrentId] = useState<string | null>(() => drafts[0]?.id ?? null);
  const [text, setText] = useState<string>(() => drafts[0]?.text ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!addr) return;
    if (text.length === 0) {
      if (currentId) {
        removeDraft(addr, scope, currentId);
        setDrafts(prev => prev.filter(d => d.id !== currentId));
        setCurrentId(null);
      }
      return;
    }
    let id = currentId;
    if (!id) {
      id = genId();
      setCurrentId(id);
    }
    persistDraft(addr, scope, id, text);
    setDrafts(prev => {
      const others = prev.filter(d => d.id !== id);
      return [{ id: id!, text, updated_at: Date.now() }, ...others];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function loadDraft(d: Draft) {
    setCurrentId(d.id);
    setText(d.text);
    setDraftsOpen(false);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function newDraft() {
    setCurrentId(null);
    setText('');
    setDraftsOpen(false);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function discardCurrent() {
    if (addr && currentId) {
      removeDraft(addr, scope, currentId);
      setDrafts(prev => prev.filter(d => d.id !== currentId));
    }
    setCurrentId(null);
    setText('');
  }

  function deleteFromList(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!addr) return;
    removeDraft(addr, scope, id);
    setDrafts(prev => prev.filter(d => d.id !== id));
    if (currentId === id) {
      setCurrentId(null);
      setText('');
    }
  }

  async function submit() {
    if (!text.trim()) return;
    const t = text;
    if (addr && currentId) removeDraft(addr, scope, currentId);
    setDrafts(prev => prev.filter(d => d.id !== currentId));
    setCurrentId(null);
    setText('');
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
    const next = text.slice(0, start) + prefix + text.slice(start, end) + suffix + text.slice(end);
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
    setText(before + block.split('\n').map(l => prefix + l).join('\n') + after);
    requestAnimationFrame(() => ta.focus());
  }

  function insertAtCursor(snippet: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setText(text.slice(0, start) + snippet + text.slice(end));
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
    const snippetStr = `[${sel}](${url})`;
    setText(text.slice(0, start) + snippetStr + text.slice(end));
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

  function DraftsButton() {
    if (!addr || drafts.length === 0) return null;
    return (
      <div className="drafts-wrap">
        <button
          className="secondary drafts-toggle"
          onClick={() => setDraftsOpen(o => !o)}
          title="open drafts"
        >
          <FileText size={13} /> drafts ({drafts.length}) <ChevronDown size={12} />
        </button>
        {draftsOpen && (
          <div className="drafts-panel">
            {drafts.map(d => (
              <div
                key={d.id}
                className={`drafts-item${currentId === d.id ? ' active' : ''}`}
                onClick={() => loadDraft(d)}
              >
                <div className="drafts-snippet">{snippet(d.text)}</div>
                <span className="drafts-time">{relTime(d.updated_at)}</span>
                <button
                  className="secondary icon-only drafts-del"
                  onClick={e => deleteFromList(d.id, e)}
                  title="delete draft"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function NewButton({ className }: { className?: string }) {
    if (!addr) return null;
    if (text.length === 0 && drafts.length === 0) return null;
    return (
      <button
        className={`secondary icon-only ${className ?? ''}`}
        onClick={newDraft}
        disabled={submitting || text.length === 0}
        title="new draft"
      >
        <FilePlus size={14} />
      </button>
    );
  }

  if (!fullscreen) {
    return (
      <div className="compose">
        {addr && drafts.length > 0 && (
          <div className="compose-drafts-bar">
            <DraftsButton />
          </div>
        )}
        <textarea
          ref={taRef}
          placeholder={placeholder ?? (parent ? 'reply...' : 'post a bit...')}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={submitting}
        />
        <div className="actions">
          <span className="muted">{text.length} chars</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <NewButton />
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
            <button onClick={submit} disabled={submitting || text.trim().length === 0 || insufficient} title={submitTitle}>
              {submitText}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true">
      <div className={`editor-modal${mobilePreview ? ' preview-on' : ''}`}>
        <div className="editor-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="editor-title">{parent ? 'reply' : 'new bit'}</span>
            <DraftsButton />
            <NewButton />
          </div>
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
            {addr && currentId && <span style={{ marginLeft: 8 }}>· auto-saved</span>}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="secondary"
              onClick={discardCurrent}
              disabled={submitting || (text.length === 0 && !currentId)}
              title="discard this draft"
            >
              <X size={14} /> discard
            </button>
            <button onClick={submit} disabled={submitting || text.trim().length === 0 || insufficient} title={submitTitle}>
              {submitText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
