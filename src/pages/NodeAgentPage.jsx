import React, { useMemo, useState } from 'react';
import {
  Blocks,
  Check,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { buildMyClinicAutoSyncKit } from '../lib/auto-sync-client.mjs';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { describeClinicIdentity } from '../lib/entitlements.mjs';

export function NodeAgentPage({ backend, selectedLicense = null }) {
  const [activeTab, setActiveTab] = useState('env');
  const [copiedId, setCopiedId] = useState(null);
  const [copyWarning, setCopyWarning] = useState('');

  const centralUrl =
    String(backend?.health?.url ?? '')
      .trim()
      .replace(/\/+$/, '') || 'https://YOUR_CENTRAL_PROJECT_REF.supabase.co';
  const centralAnonKey =
    String(backend?.health?.anonKey ?? '').trim() ||
    'sb_publishable_YOUR_CENTRAL_ANON_KEY';

  const kit = useMemo(
    () =>
      buildMyClinicAutoSyncKit({
        centralUrl,
        centralAnonKey,
      }),
    [centralUrl, centralAnonKey],
  );

  const workflowSnippet = useMemo(
    () => `# In myClinic/.github/workflows/pages.yml -> Build step env:
      - name: Build
        env:
          VITE_BASE: \${{ vars.VITE_BASE }}
          VITE_SUPABASE_URL: \${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: \${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_CENTRAL_SUPABASE_URL: \${{ vars.VITE_CENTRAL_SUPABASE_URL }}
          VITE_CENTRAL_SUPABASE_ANON_KEY: \${{ vars.VITE_CENTRAL_SUPABASE_ANON_KEY }}
        run: npm run build`,
    [],
  );

  const tabs = [
    {
      id: 'env',
      label: '1. .env.production',
      icon: Sparkles,
      filename: 'myClinic/.env.production',
      description:
        'Only two public build variables are needed across ALL clinics. Never paste a service_role or sb_secret_ key here.',
      code: kit.envVars,
    },
    {
      id: 'module',
      label: '2. Auto-Sync Engine',
      icon: FileCode2,
      filename: 'myClinic/src/lib/central-subscription.mjs',
      description:
        'Drop-in client module: calls Central sync_clinic_subscription RPC with cross-Supabase JWT isolation and a 7-day SHA-256 sealed offline cache.',
      code: kit.clientModule,
    },
    {
      id: 'vite',
      label: '3. Vite Obfuscator',
      icon: Lock,
      filename: 'myClinic/vite.config.js',
      description:
        'Scoped production obfuscator: scrambles ONLY the subscription guard files while keeping React 19 & the Indian drug directory fast.',
      code: kit.viteObfuscatorSnippet,
    },
    {
      id: 'workflow',
      label: '4. GitHub Pages CI',
      icon: GitBranch,
      filename: 'myClinic/.github/workflows/pages.yml',
      description:
        'Forward VITE_CENTRAL_SUPABASE_URL and VITE_CENTRAL_SUPABASE_ANON_KEY from GitHub Repository Variables during npm run build.',
      code: workflowSnippet,
    },
  ];

  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const selectedIdentity = selectedLicense
    ? describeClinicIdentity(selectedLicense)
    : null;

  async function handleCopy(id, text) {
    setCopyWarning('');
    const res = await copyTextToClipboard(text);
    if (!res.ok) {
      setCopyWarning(res.error);
      return;
    }
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 2000);
  }

  return (
    <div className="space-y-5">
      {/* Top Overview Banner */}
      <section className="console-panel relative overflow-hidden rounded-2xl p-5 sm:p-6">
        <span className="cf-top-stripe absolute inset-x-0 top-0 h-[3px]" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="badge-accent inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-semibold">
              <Blocks className="h-3.5 w-3.5" />
              Universal Client Build · Ship 1 Build to Every Clinic
            </div>
            <h2 className="mt-3 text-lg font-bold tracking-tight sm:text-xl">
              myClinic Keyless Auto-Sync Integration Kit
            </h2>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="mt-1 text-xs leading-relaxed sm:text-sm"
            >
              Configure <code className="font-mono">myClinic</code> once using
              the 4 snippets below. Every clinic deployment automatically syncs
              its plan, seats, and expiration by <strong>Owner Email</strong>{' '}
              and <strong>Website URL</strong> — zero per-clinic secrets or Edge
              Functions.
            </p>
          </div>

          {selectedIdentity ? (
            <div className="console-well rounded-xl px-3.5 py-2.5 text-xs">
              <div
                style={{ color: 'var(--text-secondary)' }}
                className="font-mono text-[10px] font-bold uppercase"
              >
                Selected Clinic
              </div>
              <div className="mt-0.5 font-bold">{selectedIdentity.primary}</div>
              <div
                style={{ color: 'var(--brand-text)' }}
                className="font-mono text-[10.5px] font-semibold"
              >
                {selectedIdentity.modeLabel}
              </div>
            </div>
          ) : null}
        </div>

        {copyWarning ? (
          <p style={{ color: 'var(--warn-text)' }} className="mt-3 text-xs font-medium">
            {copyWarning}
          </p>
        ) : null}
      </section>

      {/* 4-Step Tabbed Code Workbench */}
      <section className="console-panel overflow-hidden rounded-2xl">
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="no-scrollbar flex overflow-x-auto px-3 pt-3 sm:px-5"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={
                  active
                    ? {
                        borderBottom: '2.5px solid var(--brand-primary)',
                        color: 'var(--text-primary)',
                      }
                    : {
                        borderBottom: '2.5px solid transparent',
                        color: 'var(--text-secondary)',
                      }
                }
                className="inline-flex shrink-0 items-center gap-2 px-3.5 py-2.5 text-xs font-bold transition-colors"
              >
                <Icon
                  style={{
                    color: active ? 'var(--brand-text)' : 'var(--text-secondary)',
                  }}
                  className="h-3.5 w-3.5"
                />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-xs font-bold">
                <Code2
                  style={{ color: 'var(--brand-text)' }}
                  className="h-4 w-4 shrink-0"
                />
                <span className="break-all">{current.filename}</span>
              </div>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                {current.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleCopy(current.id, current.code)}
              className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
            >
              {copiedId === current.id ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Snippet
                </>
              )}
            </button>
          </div>

          <div className="console-code overflow-hidden rounded-xl">
            <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-relaxed">
              {current.code}
            </pre>
          </div>
        </div>
      </section>

      {/* Architecture Assurance Strip */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="console-panel rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold">
            <ShieldCheck
              style={{ color: 'var(--ok-main)' }}
              className="h-4 w-4"
            />
            Cross-Supabase Isolation
          </div>
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 text-xs leading-relaxed"
          >
            Uses raw <code className="font-mono">fetch</code> with only
            Central&apos;s publishable key — never leaks clinic user JWTs or
            creates duplicate GoTrue clients.
          </p>
        </div>

        <div className="console-panel rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Lock style={{ color: 'var(--brand-text)' }} className="h-4 w-4" />
            Scoped Obfuscation Only
          </div>
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 text-xs leading-relaxed"
          >
            Obfuscates only subscription guard files so mobile PWA startup and
            Indian drug search stay instantaneous.
          </p>
        </div>

        <div className="console-panel rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Sparkles
              style={{ color: 'var(--info-main)' }}
              className="h-4 w-4"
            />
            Patient Data Never Held Hostage
          </div>
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 text-xs leading-relaxed"
          >
            When paused or expired, <code className="font-mono">myClinic</code>{' '}
            blocks writes while keeping patient charts readable and exportable.
          </p>
        </div>
      </div>
    </div>
  );
}

export default NodeAgentPage;
