import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from './components/AppShell.jsx';
import {
  detectRecoveryFlowFromUrl,
  isAuthorizedAdminUser,
  readLocalAdminSession,
  signOutLocalAdminSession,
} from './lib/auth.mjs';
import { resolveAuthorityBackend } from './lib/supabase.js';
import {
  applyDocumentTheme,
  nextTheme,
  resolveInitialTheme,
} from './lib/theme.mjs';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
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
  const [session, setSession] = useState(() => {
    const initialBackend = resolveAuthorityBackend();
    return initialBackend.mode === 'local' ? readLocalAdminSession() : null;
  });
  const [authLoading, setAuthLoading] = useState(
    () => resolveAuthorityBackend().mode === 'cloud',
  );
  const [recoveryMode, setRecoveryMode] = useState(() =>
    detectRecoveryFlowFromUrl(),
  );
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [issueDrawerSignal, setIssueDrawerSignal] = useState(0);
  const [theme, setTheme] = useState(() => {
    const initial = resolveInitialTheme();
    applyDocumentTheme(initial);
    return initial;
  });

  useEffect(() => {
    const onHashChange = () => {
      if (detectRecoveryFlowFromUrl()) {
        setRecoveryMode(true);
      }
      setRoute(readCurrentRoute());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (backend.mode !== 'cloud' || !backend.supabase?.auth) {
      setSession(readLocalAdminSession());
      setAuthLoading(false);
      return undefined;
    }

    let mounted = true;
    setAuthLoading(true);

    backend.supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) {
          setSession(data?.session ?? null);
          setAuthLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setAuthLoading(false);
        }
      });

    const { data: listener } = backend.supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mounted) return;
        setSession(nextSession ?? null);
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
        }
        if (event === 'SIGNED_OUT') {
          setRecoveryMode(false);
        }
      },
    );

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, [backend]);

  const refreshBackend = useCallback(() => {
    const next = resolveAuthorityBackend();
    setBackend(next);
    if (next.mode === 'local') {
      setSession(readLocalAdminSession());
    }
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

  const handleSignOut = useCallback(async () => {
    if (backend.mode === 'cloud' && backend.supabase?.auth) {
      await backend.supabase.auth.signOut();
    } else {
      signOutLocalAdminSession();
    }
    setSession(null);
    setRecoveryMode(false);
  }, [backend]);

  const handleRecoveryCompleted = useCallback(() => {
    setRecoveryMode(false);
    if (window.location.hash.startsWith('#/reset-password')) {
      window.location.hash = '#/dashboard';
    }
  }, []);

  const spinnerFallback = (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-secondary)',
      }}
      className="flex min-h-screen items-center justify-center text-xs font-medium"
    >
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
      Verifying zero-trust operator session...
    </div>
  );

  if (authLoading) {
    return spinnerFallback;
  }

  const isAuthorized =
    isAuthorizedAdminUser(session?.user) &&
    !(backend.mode === 'cloud' && recoveryMode);

  if (!isAuthorized) {
    return (
      <Suspense fallback={spinnerFallback}>
        <LoginPage
          backend={backend}
          session={session}
          recoveryMode={recoveryMode}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onBackendChanged={refreshBackend}
          onSessionRefreshed={setSession}
          onRecoveryCompleted={handleRecoveryCompleted}
        />
      </Suspense>
    );
  }

  return (
    <AppShell
      activeRoute={route}
      backendMode={backend.mode}
      operatorEmail={session?.user?.email ?? ''}
      theme={theme}
      onToggleTheme={handleToggleTheme}
      onQuickIssueLicense={handleQuickIssueLicense}
      onSignOut={handleSignOut}
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
            session={session}
            onBackendChanged={refreshBackend}
            onSignOut={handleSignOut}
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
