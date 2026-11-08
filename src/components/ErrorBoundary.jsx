import React from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Home,
  RefreshCw,
} from 'lucide-react';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { diagnosticsText, rememberError, sanitizeDiagnosticText } from '../lib/errors.mjs';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

/**
 * Top-level & route-level React error boundary.
 * Catches thrown render errors and lazy chunk load failures so the console
 * never collapses into a blank white/dark screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false, copyWarning: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    rememberError(error, 'UI component crash');
    console.error('myClinicLicenseAuthority boundary caught error:', error, info?.componentStack);
  }

  async handleCopyDiagnostics() {
    const stackSnippet = sanitizeDiagnosticText(this.state.error?.stack ?? '');
    const report = [
      diagnosticsText({
        app: APP_VERSION,
        schema: SCHEMA_VERSION,
        route:
          typeof window !== 'undefined'
            ? window.location.hash.replace(/^#\/?/, '')
            : '',
      }),
      stackSnippet ? `\nstack:\n${stackSnippet}` : '',
    ].join('\n');

    const res = await copyTextToClipboard(report);
    if (res.ok) {
      this.setState({ copied: true, copyWarning: '' });
    } else {
      this.setState({ copied: false, copyWarning: res.error });
    }
  }

  handleResetToDashboard() {
    this.setState({ error: null, copied: false, copyWarning: '' });
    if (typeof window !== 'undefined') {
      window.location.hash = '#/dashboard';
    }
  }

  render() {
    const { error, copied, copyWarning } = this.state;
    if (!error) return this.props.children;

    const rawMessage = sanitizeDiagnosticText(
      String(error?.message ?? error ?? 'Unexpected rendering error'),
    );
    const isChunkLoadError =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        rawMessage,
      );

    return (
      <div
        style={{
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--text-primary)',
        }}
        className="flex min-h-screen items-center justify-center p-6"
      >
        <div className="console-panel w-full max-w-xl space-y-4 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <span
              style={{
                backgroundColor: 'var(--danger-soft)',
                border: '1px solid rgba(244, 63, 94, 0.35)',
                color: 'var(--danger-text)',
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            >
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold">
                {isChunkLoadError
                  ? 'A new console update is available'
                  : 'This screen encountered an unexpected error'}
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                {isChunkLoadError
                  ? 'The page bundle changed after a fresh deployment or your connection dropped while loading a screen. Reload the console to load the latest files.'
                  : 'Your licenses and database records are safe in Supabase. Reload the console or return to Licenses — if it happens again, copy the sanitized diagnostics below.'}
              </p>
            </div>
          </div>

          <pre
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
            className="max-h-40 overflow-auto rounded-xl p-3.5 font-mono text-[11px] whitespace-pre-wrap break-words"
          >
            {rawMessage}
            {'\n\n'}
            {`myClinicLicenseAuthority v${APP_VERSION} · schema v${SCHEMA_VERSION}`}
          </pre>

          {copyWarning ? (
            <p style={{ color: 'var(--warn-text)' }} className="text-xs">
              {copyWarning}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload console
            </button>

            <button
              type="button"
              onClick={() => this.handleResetToDashboard()}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
            >
              <Home className="h-3.5 w-3.5" />
              Back to Licenses
            </button>

            <button
              type="button"
              onClick={() => this.handleCopyDiagnostics()}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied diagnostics
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy diagnostics
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
