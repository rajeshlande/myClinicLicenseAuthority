import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from './components/AppShell.jsx';
import { resolveAuthorityBackend } from './lib/supabase.js';
import {
  applyDocumentTheme,
  nextTheme,
  resolveInitialTheme,
} from './lib/theme.mjs';

const EntitlementsPage = lazy(() => import('./pages/EntitlementsPage.jsx'));
const ValidatorLabPage = lazy(() => import('./pages/ValidatorLabPage.jsx'));
const NodeAgentPage = lazy(() => import('./pages/NodeAgentPage.jsx'));
const SetupPage = lazy(() => import('./pages/SetupPage.jsx'));

function readCurrentRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (['dashboard', 'simulator', 'node-agent', 'setup'].includes(raw)) {
    return raw;
  }
  return 'dashboard';
}

export default function App() {
  const [route, setRoute] = useState(readCurrentRoute);
  const [backend, setBackend] = useState(resolveAuthorityBackend);
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [issueDrawerSignal, setIssueDrawerSignal] = useState(0);
  const [theme, setTheme] = useState(() => {
    const initial = resolveInitialTheme();
    applyDocumentTheme(initial);
    return initial;
  });

  useEffect(() => {
    const onHashChange = () => setRoute(readCurrentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const refreshBackend = useCallback(() => {
    setBackend(resolveAuthorityBackend());
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((cur) => {
      const updated = nextTheme(cur);
      applyDocumentTheme(updated);
      return updated;
    });
  }, []);

  const handleQuickIssueLicense = useCallback(() => {
    if (readCurrentRoute() !== 'dashboard') {
      window.location.hash = '#/dashboard';
    }
    setIssueDrawerSignal((n) => n + 1);
  }, []);

  return (
    <AppShell
      activeRoute={route}
      backendMode={backend.mode}
      theme={theme}
      onToggleTheme={handleToggleTheme}
      onQuickIssueLicense={handleQuickIssueLicense}
    >
      <Suspense
        fallback={
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="flex items-center justify-center py-24 text-xs font-medium"
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
            Loading security module...
          </div>
        }
      >
        {route === 'simulator' ? (
          <ValidatorLabPage backend={backend} />
        ) : route === 'node-agent' ? (
          <NodeAgentPage
            backend={backend}
            selectedLicense={selectedLicense}
          />
        ) : route === 'setup' ? (
          <SetupPage
            backend={backend}
            onBackendChanged={refreshBackend}
          />
        ) : (
          <EntitlementsPage
            backend={backend}
            issueDrawerSignal={issueDrawerSignal}
            onSelectLicenseForKit={setSelectedLicense}
          />
        )}
      </Suspense>
    </AppShell>
  );
}
