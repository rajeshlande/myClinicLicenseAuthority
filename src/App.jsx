import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import {
  detectRecoveryFlowFromUrl,
  isAuthorizedAdminUser,
} from './lib/auth.mjs';
import { rememberError } from './lib/errors.mjs';
import { resolveAuthorityBackend } from './lib/supabase.js';
import {
  applyDocumentTheme,
  nextTheme,
  resolveInitialTheme,
} from './lib/theme.mjs';

const EntitlementsPage = lazy(() => import('./pages/EntitlementsPage.jsx'));
const ActivityPage = lazy(() => import('./pages/ActivityPage.jsx'));
const GuidePage = lazy(() => import('./pages/GuidePage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const NodeAgentPage = lazy(() => import('./pages/NodeAgentPage.jsx'));
const SetupPage = lazy(() => import('./pages/SetupPage.jsx'));
const ValidatorLabPage = lazy(() => import('./pages/ValidatorLabPage.jsx'));

const ROUTE_META = {
  dashboard: {
    title: 'Clinics & Plans',
    subtitle:
      'Keyless Central Auto-Sync — manage clinic subscriptions by Owner Email, Website URL, or both.',
  },
  guide: {
    title: 'Quickstart Guide',
    subtitle:
      '2-side setup for Central Supabase (Schema v2) and universal myClinic client auto-sync.',
  },
  'node-agent': {
    title: 'Client SDK & Obfuscator',
    subtitle:
      'Universal myClinic integration snippets + scoped production Vite obfuscator.',
  },
  simulator: {
    title: 'Sync & Security Lab',
    subtitle:
      'Live sync_clinic_subscription RPC tester and Central database firewall verification.',
  },
  setup: {
    title: 'Settings & Health',
    subtitle:
      'Central Supabase endpoint, 3-point health check, operator password, and sanitized diagnostics.',
  },
};

function parseHashRoute(hash) {
  const cleaned = String(hash || '')
    .replace(/^#\/?/, '')
    .split('?')[0]
    .trim()
    .toLowerCase();
  if (cleaned === 'guide' || cleaned === 'docs' || cleaned === 'onboarding') {
    return 'guide';
  }
  if (cleaned === 'node-agent' || cleaned === 'sdk') return 'node-agent';
  if (cleaned === 'simulator' || cleaned === 'validator-lab') return 'simulator';
  if (cleaned === 'setup' || cleaned === 'settings') return 'setup';
  return 'dashboard';
}

function PageFallback() {
  return (
    <div
      style={{ color: 'var(--text-secondary)' }}
      className="flex min-h-[280px] items-center justify-center gap-2.5 text-xs font-medium"
    >
      <div
        style={{
          borderColor: 'var(--border-strong)',
          borderTopColor: 'var(--brand-primary)',
        }}
        className="h-4 w-4 animate-spin rounded-full border-2"
      />
      <span>Loading module...</span>
    </div>
  );
}

export default function App() {
  const [backendVersion, setBackendVersion] = useState(0);
  const [backend, setBackend] = useState(() => resolveAuthorityBackend());

  const [theme, setTheme] = useState(() => {
    const initial = resolveInitialTheme(
      typeof window !== 'undefined' ? window.localStorage : null,
    );
    if (typeof document !== 'undefined') {
      applyDocumentTheme(
        initial,
        document,
        typeof window !== 'undefined' ? window.localStorage : null,
      );
    }
    return initial;
  });

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(() =>
    Boolean(backend.configured && backend.supabase),
  );
  const [recoveryMode, setRecoveryMode] = useState(() =>
    typeof window !== 'undefined'
      ? detectRecoveryFlowFromUrl(window.location)
      : false,
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );

  const [activeRoute, setActiveRoute] = useState(() =>
    typeof window !== 'undefined'
      ? parseHashRoute(window.location.hash)
      : 'dashboard',
  );
  const [issueDrawerSignal, setIssueDrawerSignal] = useState(0);
  const [selectedLicenseForKit, setSelectedLicenseForKit] = useState(null);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = nextTheme(prev);
      if (typeof document !== 'undefined') {
        applyDocumentTheme(
          next,
          document,
          typeof window !== 'undefined' ? window.localStorage : null,
        );
      }
      return next;
    });
  }, []);

  const refreshBackend = useCallback(() => {
    const next = resolveAuthorityBackend();
    setBackend(next);
    setBackendVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      if (detectRecoveryFlowFromUrl(window.location)) {
        setRecoveryMode(true);
      }
      setActiveRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const client = backend.supabase;
    if (!backend.configured || !client) {
      setSession(null);
      setAuthLoading(false);
      return undefined;
    }

    let cancelled = false;
    setAuthLoading(true);

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          rememberError(error, 'Restore operator session');
        }
        setSession(data?.session ?? null);
        setAuthLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        rememberError(err, 'Restore operator session');
        setSession(null);
        setAuthLoading(false);
      });

    const { data: listener } = client.auth.onAuthStateChange(
      (event, nextSession) => {
        if (cancelled) return;
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
      cancelled = true;
      listener?.subscription?.unsubscribe();
    };
  }, [backend, backendVersion]);

  const navigate = useCallback((routeId) => {
    window.location.hash = `#/${routeId}`;
    setActiveRoute(routeId);
  }, []);

  const handleTriggerNewEntitlement = useCallback(() => {
    if (activeRoute !== 'dashboard') {
      navigate('dashboard');
    }
    setIssueDrawerSignal((n) => n + 1);
  }, [activeRoute, navigate]);

  const handleSignOut = useCallback(async () => {
    try {
      if (backend.supabase) {
        await backend.supabase.auth.signOut();
      }
    } catch (err) {
      rememberError(err, 'Sign out');
    } finally {
      setSession(null);
      setRecoveryMode(false);
    }
  }, [backend]);

  if (authLoading) {
    return (
      <div
        style={{
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--text-secondary)',
        }}
        className="cf-grid-bg flex min-h-screen items-center justify-center gap-3 text-xs font-medium"
      >
        <div
          style={{
            borderColor: 'var(--border-strong)',
            borderTopColor: 'var(--brand-primary)',
          }}
          className="h-4 w-4 animate-spin rounded-full border-2"
        />
        <span>Verifying Central operator session...</span>
      </div>
    );
  }

  const isAuthenticatedAdmin =
    backend.configured &&
    Boolean(session?.user) &&
    isAuthorizedAdminUser(session.user) &&
    !recoveryMode;

  if (!isAuthenticatedAdmin) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <LoginPage
            backend={backend}
            session={session}
            isOnline={isOnline}
            recoveryMode={recoveryMode}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            onBackendChanged={refreshBackend}
            onSessionRefreshed={(nextSession) => setSession(nextSession)}
            onRecoveryCompleted={() => {
              setRecoveryMode(false);
              if (
                typeof window !== 'undefined' &&
                window.location.hash.includes('type=recovery')
              ) {
                window.location.hash = '#/dashboard';
              }
            }}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const meta = ROUTE_META[activeRoute] ?? ROUTE_META.dashboard;

  return (
    <ErrorBoundary>
      <AppShell
        activeRoute={activeRoute}
        onNavigate={navigate}
        routeTitle={meta.title}
        routeSubtitle={meta.subtitle}
        backendHealth={backend.health}
        operatorEmail={session?.user?.email ?? ''}
        isOnline={isOnline}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onSignOut={handleSignOut}
        onNewEntitlement={handleTriggerNewEntitlement}
      >
        <Suspense fallback={<PageFallback />}>
          {activeRoute === 'dashboard' && (
            <EntitlementsPage
              backend={backend}
              issueDrawerSignal={issueDrawerSignal}
              onSelectLicenseForKit={(row) => setSelectedLicenseForKit(row)}
              onOpenGuide={() => navigate('guide')}
              operatorEmail={session?.user?.email ?? ''}
            />
          )}
          {activeRoute === 'activity' && <ActivityPage backend={backend} />}
          {activeRoute === 'guide' && (
            <GuidePage
              backend={backend}
              session={session}
              onNavigate={navigate}
            />
          )}
          {activeRoute === 'node-agent' && (
            <NodeAgentPage
              backend={backend}
              selectedLicense={selectedLicenseForKit}
            />
          )}
          {activeRoute === 'simulator' && (
            <ValidatorLabPage
              backend={backend}
              selectedLicense={selectedLicenseForKit}
            />
          )}
          {activeRoute === 'setup' && (
            <SetupPage
              backend={backend}
              session={session}
              onBackendChanged={refreshBackend}
              onSignOut={handleSignOut}
            />
          )}
        </Suspense>
      </AppShell>
    </ErrorBoundary>
  );
}
