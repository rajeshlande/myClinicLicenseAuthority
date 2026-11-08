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
 * Structured error banner showing what failed, a plain-English step-by-step fix,
 * optional Retry / Dismiss actions, and a collapsible technical detail block.
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
        border: '1px solid rgba(244, 63, 94, 0.35)',
        color: 'var(--danger-text)',
      }}
      className={`rounded-xl p-3.5 text-xs ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold leading-snug">{explained.message}</p>
              {explained.fixLabel ? (
                <span
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.35)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium"
                >
                  <Wrench className="h-2.5 w-2.5" />
                  {explained.fixLabel}
                </span>
              ) : null}
            </div>

            {explained.hint ? (
              <p style={{ opacity: 0.92 }} className="leading-relaxed">
                <strong>How to fix:</strong> {explained.hint}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.45)',
                    border: '1px solid rgba(244, 63, 94, 0.4)',
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
                  className="inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2 opacity-85 hover:opacity-100"
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
              <pre
                style={{
                  backgroundColor: 'rgba(2, 6, 23, 0.55)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                }}
                className="mt-2 max-h-32 overflow-auto rounded-lg p-2.5 font-mono text-[11px] whitespace-pre-wrap break-words"
              >
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
            className="rounded-md p-1 opacity-75 transition hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ErrorAlert;
