import React, { useEffect, useState } from 'react';
import {
  Activity,
  Blocks,
  BookOpen,
  Building2,
  ChevronRight,
  Cloud,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';
import {
  getGlobalSearchQuery,
  setGlobalSearchQuery,
  subscribeGlobalSearch,
} from '../lib/global-search.mjs';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Clinics & Plans',
    shortLabel: 'Clinics',
    icon: Building2,
    section: 'Control Plane',
  },
  {
    id: 'guide',
    label: 'Quickstart Guide',
    shortLabel: 'Guide',
    icon: BookOpen,
    section: 'Control Plane',
  },
  {
    id: 'node-agent',
    label: 'Client SDK & Obfuscator',
    shortLabel: 'Client SDK',
    icon: Blocks,
    section: 'Client Sync',
  },
  {
    id: 'simulator',
    label: 'Sync & Security Lab',
    shortLabel: 'Sync Lab',
    icon: Activity,
    section: 'Client Sync',
  },
  {
    id: 'setup',
    label: 'Settings & Health',
    shortLabel: 'Settings',
    icon: Settings,
    section: 'System',
  },
];

// Grouped in first-appearance order so the sidebar reads like the reference
// UI: a few labelled clusters of pills instead of one flat list.
const NAV_GROUPS = NAV_ITEMS.reduce((groups, item) => {
  const group = groups.find((entry) => entry.section === item.section);
  if (group) {
    group.items.push(item);
  } else {
    groups.push({ section: item.section, items: [item] });
  }
  return groups;
}, []);

const ROUTE_TITLES = {
  dashboard: {
    crumb: 'Subscriptions / Fleet Registry',
    title: 'Clinics & Subscriptions',
  },
  guide: {
    crumb: 'Onboarding / 2-Side Setup',
    title: '2-Side Keyless Auto-Sync Guide',
  },
  'node-agent': {
    crumb: 'Client Sync / Integration Kit',
    title: 'myClinic Client SDK & Obfuscator',
  },
  simulator: {
    crumb: 'Security / Live RPC & Firewall',
    title: 'Live Auto-Sync & Security Lab',
  },
  setup: {
    crumb: 'Account / Endpoint & Diagnostics',
    title: 'Settings & 3-Point Health',
  },
};

function NavGroupList({ activeRoute, onNavigate }) {
  return (
    <div className="space-y-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.section}>
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="px-2.5 pb-1.5 font-mono text-[10px] font-bold tracking-wider uppercase"
          >
            {group.section}
          </div>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activeRoute === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--accent-badge-bg)',
                            color: 'var(--accent-badge-text)',
                          }
                        : {
                            color: 'var(--text-secondary)',
                          }
                    }
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[var(--bg-sidebar)]"
                  >
                    <Icon
                      style={{
                        color: active
                          ? 'var(--accent-badge-text)'
                          : 'var(--text-secondary)',
                      }}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OperatorCard({ operatorEmail, theme, onToggleTheme, onSignOut }) {
  const initials = operatorEmail
    ? operatorEmail.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'CA'
    : 'CA';
  return (
    <div className="console-well rounded-2xl p-3">
      <div className="flex items-center gap-2.5">
        <span
          style={{
            backgroundColor: 'var(--accent-badge-bg)',
            color: 'var(--accent-badge-text)',
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="font-mono text-[9.5px] font-semibold uppercase"
          >
            Central Admin
          </div>
          <div className="truncate text-xs font-semibold">
            {operatorEmail || 'not signed in'}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle color theme"
          className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        >
          {theme === 'dark' ? (
            <Sun
              style={{ color: 'var(--warn-main)' }}
              className="h-3.5 w-3.5"
            />
          ) : (
            <Moon
              style={{ color: 'var(--brand-primary)' }}
              className="h-3.5 w-3.5"
            />
          )}
        </button>
        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            className="console-btn-secondary inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AppShell({
  activeRoute,
  onNavigate,
  operatorEmail = '',
  isOnline = true,
  theme = 'light',
  onToggleTheme,
  onSignOut,
  children,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState(getGlobalSearchQuery);

  useEffect(() => setMobileMenuOpen(false), [activeRoute]);
  useEffect(() => subscribeGlobalSearch(setGlobalQuery), []);

  const pushGlobalQuery = (value) => {
    setGlobalQuery(value);
    setGlobalSearchQuery(value);
  };

  const routeInfo = ROUTE_TITLES[activeRoute] ?? ROUTE_TITLES.dashboard;

  return (
    <div
      style={{ color: 'var(--text-primary)' }}
      className="relative flex min-h-screen flex-col"
    >
      {/* Floating shell: sidebar panel + content column on the page gradient */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-5 p-3 sm:p-4 lg:p-6">
        {/* Desktop Sidebar Panel */}
        <aside className="console-shell sticky top-6 hidden h-[calc(100vh-3rem)] w-64 shrink-0 flex-col overflow-hidden rounded-3xl lg:flex">
          {/* Brand Header */}
          <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="flex min-w-0 items-center gap-2.5 text-left"
            >
              <div className="brand-mark-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <Cloud className="h-4 w-4 stroke-[2.3]" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold tracking-tight">
                  myClinic Central
                </div>
                <div
                  style={{ color: 'var(--text-secondary)' }}
                  className="font-mono text-[10px]"
                >
                  Auto-Sync · v{APP_VERSION}
                </div>
              </div>
            </button>
          </div>

          {/* Grouped Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 pb-3">
            <NavGroupList activeRoute={activeRoute} onNavigate={onNavigate} />

            {/* Architecture Posture Badge */}
            <div className="console-well mt-4 rounded-2xl p-3 text-[11px]">
              <div className="flex items-center gap-2">
                <span
                  style={{ backgroundColor: 'var(--ok-main)' }}
                  className="h-2 w-2 shrink-0 rounded-full"
                />
                <span className="font-mono font-semibold">
                  Zero-Key RPC · Schema v{SCHEMA_VERSION}
                </span>
              </div>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 leading-relaxed"
              >
                FORCE RLS active. Clients sync by Email, URL, or Both with zero
                table exposure.
              </p>
            </div>
          </nav>

          {/* Operator Footer Card */}
          <div className="shrink-0 p-3">
            <OperatorCard
              operatorEmail={operatorEmail}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onSignOut={onSignOut}
            />
          </div>
        </aside>

        {/* Main Content Column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Floating Topbar */}
          <header className="console-shell sticky top-3 z-30 flex items-center gap-2 rounded-2xl px-3 py-2.5 sm:top-4 sm:gap-2.5 sm:px-4 lg:top-6">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="console-btn-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Global search pill */}
            <div className="relative min-w-0 flex-1 sm:max-w-xl">
              <Search
                style={{ color: 'var(--text-placeholder)' }}
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                type="search"
                value={globalQuery}
                onChange={(event) => pushGlobalQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onNavigate('dashboard');
                  }
                }}
                aria-label="Global search"
                placeholder="Search clinics, email, URL, plan, or note..."
                className="console-search-pill h-9 w-full pl-9 pr-8 text-[13px]"
              />
              {globalQuery ? (
                <button
                  type="button"
                  onClick={() => pushGlobalQuery('')}
                  aria-label="Clear global search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!isOnline ? (
                <span className="badge-warning inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
                  <WifiOff className="h-3 w-3" />
                  <span className="hidden sm:inline">Offline</span>
                </span>
              ) : (
                <span className="badge-success hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold md:inline-flex">
                  <span
                    style={{ backgroundColor: 'var(--ok-main)' }}
                    className="h-1.5 w-1.5 rounded-full"
                  />
                  Edge RPC Ready
                </span>
              )}

              <button
                type="button"
                onClick={onToggleTheme}
                title={
                  theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
                }
                aria-label="Toggle color theme"
                className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-xl lg:hidden"
              >
                {theme === 'dark' ? (
                  <Sun
                    style={{ color: 'var(--warn-main)' }}
                    className="h-4 w-4"
                  />
                ) : (
                  <Moon
                    style={{ color: 'var(--brand-primary)' }}
                    className="h-4 w-4"
                  />
                )}
              </button>

              {operatorEmail ? (
                <span
                  title={operatorEmail}
                  style={{
                    backgroundColor: 'var(--accent-badge-bg)',
                    color: 'var(--accent-badge-text)',
                  }}
                  className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold lg:flex"
                >
                  {operatorEmail.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'CA'}
                </span>
              ) : null}
            </div>
          </header>

          {/* Page heading row */}
          <div className="px-1">
            <div
              style={{ color: 'var(--text-secondary)' }}
              className="hidden items-center gap-1 font-mono text-[11px] sm:flex"
            >
              <span>myClinic Central</span>
              <ChevronRight className="h-3 w-3" />
              <span>{routeInfo.crumb}</span>
            </div>
            <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">
              {routeInfo.title}
            </h1>
          </div>

          {/* Main Workspace Canvas */}
          <main className="flex-1 pb-28 lg:pb-4">{children}</main>
        </div>
      </div>

      {/* Mobile Slide-Over Menu Sheet */}
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
          />
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-float)',
            }}
            className="relative z-10 flex w-72 max-w-[84vw] flex-col rounded-r-3xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-between px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="brand-mark-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                  <Cloud className="h-4 w-4 stroke-[2.3]" />
                </div>
                <span className="truncate text-sm font-bold">myClinic Central</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3">
              <NavGroupList activeRoute={activeRoute} onNavigate={onNavigate} />
            </nav>

            <div className="shrink-0 p-3">
              <OperatorCard
                operatorEmail={operatorEmail}
                theme={theme}
                onToggleTheme={onToggleTheme}
                onSignOut={onSignOut}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Floating Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="console-shell fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-2xl p-1 lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              style={
                active
                  ? {
                      backgroundColor: 'var(--accent-badge-bg)',
                      color: 'var(--accent-badge-text)',
                    }
                  : {
                      color: 'var(--text-secondary)',
                    }
              }
              className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold"
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-[64px] truncate">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default AppShell;
