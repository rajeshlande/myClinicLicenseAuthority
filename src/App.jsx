import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from './components/AppShell.jsx';
import {
  detectRecoveryFlowFromUrl,
  isAuthorizedAdminUser,
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
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(
    () => resolveAuthorityBackend().configured,
  );
  const [isOnline, setIsOnline] = useState(
    () => globalThis.navigator?.onLine !== false,
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

  // Auto-reconnect Supabase session refresh whenever internet connectivity resumes
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (backend.supabase?.auth) {
        backend.supabase.auth.startAutoRefresh?.();
        backend.supabase.auth
          .getSession()
          .then(({ data }) => {
            if (data?.session) setSession(data.session);
          })
          .catch(() => {});
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      backend.supabase?.auth?.stopAutoRefresh?.();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [backend]);

  useEffect(() => {
    if (!backend.configured || !backend.supabase?.auth) {
      setSession(null);
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

  const handleSignOut = useCallback(async () => {
    if (backend.supabase?.auth) {
      await backend.supabase.auth.signOut();
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
      Auto-connecting to Cloud Supabase Authority...
    </div>
  );

  if (authLoading) {
    return spinnerFallback;
  }

  const isAuthorized =
    backend.configured &&
    isAuthorizedAdminUser(session?.user) &&
    !recoveryMode;

  if (!isAuthorized) {
    return (
      <Suspense fallback={spinnerFallback}>
        <LoginPage
          backend={backend}
          session={session}
          isOnline={isOnline}
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
      isOnline={isOnline}
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
            isOnline={isOnline}
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
