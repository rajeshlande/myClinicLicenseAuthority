import React, { useRef, useState } from 'react';
import { Bold, Code, Eye, Italic, List, PenLine } from 'lucide-react';
import { appendBillingStamp, wrapTextSelection } from '../lib/notes.mjs';
import RichNotesView from './RichNotesView.jsx';

export default function RichNotesField({ value, onChange }) {
  const textareaRef = useRef(null);
  const [previewMode, setPreviewMode] = useState(false);

  const handleMarker = (marker, placeholder) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const updated = wrapTextSelection(value, start, end, marker, placeholder);
    onChange(updated.text);
    setPreviewMode(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          updated.selectionStart,
          updated.selectionEnd,
        );
      }
    });
  };

  const handleStamp = (kind) => {
    const next = appendBillingStamp(value, kind);
    onChange(next);
    setPreviewMode(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(next.length, next.length);
      }
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label
          htmlFor="billing-rich-notes"
          style={{ color: 'var(--text-secondary)' }}
          className="block text-xs font-medium"
        >
          PO &amp; Manual Collection Reference
        </label>
        <button
          type="button"
          onClick={() => setPreviewMode((p) => !p)}
          style={{ color: 'var(--accent-primary)' }}
          className="inline-flex items-center gap-1 text-[11px] font-semibold hover:opacity-80"
        >
          {previewMode ? (
            <>
              <PenLine className="h-3 w-3" /> Edit Markdown
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" /> Preview AST
            </>
          )}
        </button>
      </div>

      <div
        style={{
          backgroundColor: 'var(--bg-well)',
          border: '1px solid var(--border-subtle)',
        }}
        className="mt-1.5 overflow-hidden rounded-xl"
      >
        <div
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          className="flex flex-wrap items-center justify-between gap-1 px-2.5 py-1.5"
        >
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Bold (**text**)"
              onClick={() => handleMarker('**', 'bold')}
              style={{ color: 'var(--text-secondary)' }}
              className="rounded p-1 hover:opacity-100"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Italic (*text*)"
              onClick={() => handleMarker('*', 'italic')}
              style={{ color: 'var(--text-secondary)' }}
              className="rounded p-1 hover:opacity-100"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Bullet item"
              onClick={() => handleStamp('bullet')}
              style={{ color: 'var(--text-secondary)' }}
              className="rounded p-1 hover:opacity-100"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Reference code (`REF`)"
              onClick={() => handleMarker('`', 'REF-000')}
              style={{ color: 'var(--text-secondary)' }}
              className="rounded p-1 hover:opacity-100"
            >
              <Code className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            {[
              { id: 'po', label: '+ PO#' },
              { id: 'utr', label: '+ UTR' },
              { id: 'gstin', label: '+ GSTIN' },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleStamp(chip.id)}
                className="console-btn-secondary rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {previewMode ? (
          <div className="min-h-[96px] p-3">
            {value.trim() ? (
              <RichNotesView notes={value} />
            ) : (
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                No billing notes entered yet.
              </p>
            )}
          </div>
        ) : (
          <textarea
            id="billing-rich-notes"
            ref={textareaRef}
            rows={4}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Record PO#, UPI/NEFT UTR reference, GSTIN, or branch notes..."
            style={{ color: 'var(--text-primary)' }}
            className="block w-full resize-y bg-transparent px-3 py-2.5 text-xs leading-relaxed focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
