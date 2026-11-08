import React, { useState } from 'react';
import {
  BookOpen,
  Container,
  FlaskConical,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Licenses', icon: KeyRound },
  { id: 'guide', label: 'Step-by-Step Guide', icon: BookOpen },
  { id: 'node-agent', label: 'Deployment', icon: Container },
  { id: 'simulator', label: 'Key Tools', icon: FlaskConical },
  { id: 'setup', label: 'Settings', icon: Settings },
];

const ROUTE_TITLES = {
  dashboard: 'Licenses',
  guide: 'Step-by-Step Guide',
  'node-agent': 'Deployment',
  simulator: 'Key Tools',
  setup: 'Settings',
};

export function AppShell({
  activeRoute,
  isOnline = true,
  operatorEmail,
  theme,
  onToggleTheme,
  onQuickIssueLicense,
  onSignOut,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = ROUTE_TITLES[activeRoute] ?? ROUTE_TITLES.dashboard;

  const navigateTo = (id) => {
    window.location.hash = `#/${id}`;
    setMobileOpen(false);
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex h-14 items-center justify-between px-4"
        >
          <a
            href="https://github.com/rajeshlande/myClinicLicenseAuthority"
            target="_blank"
            rel="noreferrer"
            title="myClinicLicenseAuthority on GitHub"
            className="flex min-w-0 items-center gap-2.5"
          >
            <div
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            >
              <ShieldCheck
                style={{ color: 'var(--accent-primary)' }}
                className="h-4 w-4"
              />
            </div>
            <span
              style={{ color: 'var(--text-primary)' }}
              className="truncate text-xs font-semibold tracking-tight"
            >
              myClinicLicenseAuthority
            </span>
          </a>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="console-btn-secondary rounded-lg p-1.5"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {onQuickIssueLicense ? (
          <div className="px-3 pt-4 pb-2">
            <button
              type="button"
              onClick={() => {
                onQuickIssueLicense();
                if (isMobile) setMobileOpen(false);
              }}
              className="console-btn-primary flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              Issue License
            </button>
          </div>
        ) : null}

        <nav className="mt-2 space-y-1 px-2.5" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                style={
                  active
                    ? {
                        backgroundColor: 'var(--accent-soft)',
                        border: '1px solid var(--accent-border)',
                        color: 'var(--text-primary)',
                      }
                    : {
                        border: '1px solid transparent',
                        color: 'var(--text-secondary)',
                      }
                }
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-all hover:opacity-95"
              >
                <Icon
                  style={{
                    color: active
                      ? 'var(--accent-primary)'
                      : 'var(--text-muted)',
                  }}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div
        style={{ borderTop: '1px solid var(--border-subtle)' }}
        className="space-y-2.5 p-3.5"
      >
        {operatorEmail ? (
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="truncate px-1 text-xs"
            title={operatorEmail}
          >
            {operatorEmail}
          </p>
        ) : null}

        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            className="console-btn-secondary inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="flex min-h-screen w-full overflow-x-hidden"
    >
      <aside
        style={{
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
        className="hidden w-60 shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block"
      >
        {renderSidebarContent(false)}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs"
          />
          <aside
            style={{
              backgroundColor: 'var(--bg-sidebar)',
              borderRight: '1px solid var(--border-default)',
            }}
            className="relative z-10 w-64 max-w-[82vw]"
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header
          style={{
            backgroundColor: 'var(--bg-header)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          className="sticky top-0 z-20 backdrop-blur-md"
        >
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="console-btn-secondary rounded-lg p-2 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>

              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                {title}
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!isOnline ? (
                <span
                  style={{
                    backgroundColor: 'var(--warning-soft)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: 'var(--warning-text)',
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium"
                >
                  <WifiOff className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Offline</span>
                </span>
              ) : null}

              {activeRoute !== 'guide' ? (
                <button
                  type="button"
                  onClick={() => navigateTo('guide')}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                >
                  <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Guide</span>
                </button>
              ) : null}

              {onQuickIssueLicense ? (
                <button
                  type="button"
                  onClick={onQuickIssueLicense}
                  className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold lg:hidden"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Issue
                </button>
              ) : null}

              <button
                type="button"
                onClick={onToggleTheme}
                title={
                  theme === 'dark'
                    ? 'Switch to Light Mode'
                    : 'Switch to Dark Mode'
                }
                aria-label="Toggle color theme"
                className="console-btn-secondary flex h-8 w-8 items-center justify-center rounded-lg"
              >
                {theme === 'dark' ? (
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <Moon className="h-3.5 w-3.5 text-slate-600" />
                )}
              </button>

              {onSignOut ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;
