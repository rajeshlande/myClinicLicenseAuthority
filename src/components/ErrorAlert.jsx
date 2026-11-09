import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wrench,
  X,
} from 'lucide-react';
import { explainError } from '../lib/errors.mjs';

/**
 * Structured error banner mapped to the Blushed Brick palette:
 * Bg: error.light (#f2dadb) | Text: error.dark (#73292b) | Accent: error (#bc4749).
 */
export function ErrorAlert({
  error,
  context = 'Action failed',
  onRetry = null,
  onDismiss = null,
  className = '',
}) {
  const [showDetail, setShowDetail] = useState(false);

  if (!error) return null;

  const explained =
    typeof error === 'object' && error !== null && error.message && error.hint
      ? error
      : explainError(error, { context });

  const hasDistinctDetail =
    Boolean(explained.detail) &&
    explained.detail !== explained.message &&
    !explained.message.includes(explained.detail);

  return (
    <div
      role="alert"
      style={{
        backgroundColor: 'var(--danger-soft)',
        border: '1px solid var(--danger-border)',
        color: 'var(--danger-text)',
      }}
      className={`rounded-xl p-3.5 text-xs ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle
            style={{ color: 'var(--danger-main)' }}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold leading-snug">{explained.message}</p>
              {explained.fixLabel ? (
                <span
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--danger-border)',
                    color: 'var(--danger-text)',
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold"
                >
                  <Wrench className="h-2.5 w-2.5" />
                  {explained.fixLabel}
                </span>
              ) : null}
            </div>

            {explained.hint ? (
              <p className="leading-relaxed">
                <strong>How to fix:</strong> {explained.hint}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--danger-border)',
                    color: 'var(--danger-text)',
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-90"
                >
                  <RefreshCw className="h-3 w-3" />
                  Try again
                </button>
              ) : null}

              {hasDistinctDetail ? (
                <button
                  type="button"
                  onClick={() => setShowDetail((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold underline underline-offset-2 opacity-90 hover:opacity-100"
                >
                  {showDetail ? (
                    <>
                      <ChevronUp className="h-3 w-3" /> Hide technical details
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" /> Show technical details
                    </>
                  )}
                </button>
              ) : null}
            </div>

            {showDetail && hasDistinctDetail ? (
              <pre className="console-code mt-2 max-h-32 overflow-auto rounded-lg p-2.5 font-mono text-[11px] whitespace-pre-wrap break-words">
                {explained.code ? `[${explained.code}] ` : ''}
                {explained.detail}
              </pre>
            ) : null}
          </div>
        </div>

        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="rounded-lg p-1 opacity-75 transition hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ErrorAlert;
