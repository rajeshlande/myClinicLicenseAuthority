import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function SlideOverDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  widthClass = 'sm:max-w-xl',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
      />

      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-float)',
          color: 'var(--text-primary)',
        }}
        className={`relative z-10 flex h-full w-full ${widthClass} flex-col overflow-hidden`}
      >
        <div className="cf-top-stripe h-[3px] w-full shrink-0" />

        <header
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6"
        >
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold tracking-tight">
              {title}
            </h2>
            {subtitle ? (
              <p
                style={{ color: 'var(--text-muted)' }}
                className="mt-0.5 text-xs leading-relaxed"
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {children}
        </div>

        {footer ? (
          <footer
            style={{
              backgroundColor: 'var(--bg-well)',
              borderTop: '1px solid var(--border-subtle)',
            }}
            className="px-4 py-3.5 sm:px-6"
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export default SlideOverDrawer;
