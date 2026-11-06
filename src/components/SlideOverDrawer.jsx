import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function SlideOverDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  widthClass = 'max-w-xl',
  children,
  footer,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-subtle)',
        }}
        className={`animate-drawer-in relative z-10 flex h-full w-full ${widthClass} flex-col shadow-2xl`}
      >
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex items-start justify-between gap-4 px-6 py-4"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                style={{ color: 'var(--text-primary)' }}
                className="text-base font-semibold tracking-tight"
              >
                {title}
              </h2>
              {badge}
            </div>
            {subtitle ? (
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-0.5 text-xs"
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
            }}
            className="px-6 py-4"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
