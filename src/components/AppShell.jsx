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
  Settings,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Clinics & Plans',
    shortLabel: 'Clinics',
    icon: Building2,
    section: 'Subscriptions',
  },
  {
    id: 'guide',
    label: 'Quickstart Guide',
    shortLabel: 'Guide',
    icon: BookOpen,
    section: 'Onboarding',
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
    section: 'Firewall & RPC',
  },
  {
    id: 'setup',
    label: 'Settings & Health',
    shortLabel: 'Settings',
    icon: Settings,
    section: 'Configuration',
  },
];

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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeRoute]);

  const routeInfo = ROUTE_TITLES[activeRoute] ?? ROUTE_TITLES.dashboard;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="relative flex min-h-screen flex-col"
    >
      {/* Top Hunter-Green -> Sage -> Yellow-Green Stripe */}
      <div className="cf-top-stripe fixed inset-x-0 top-0 z-50 h-[3px]" />

      <div className="flex flex-1 pt-[3px]">
        {/* Desktop Left Rail */}
        <aside
          style={{
            backgroundColor: 'var(--bg-sidebar)',
            borderRight: '1px solid var(--border-subtle)',
          }}
          className="hidden w-60 shrink-0 lg:fixed lg:inset-y-0 lg:top-[3px] lg:left-0 lg:z-30 lg:flex lg:flex-col"
        >
          {/* Brand Header */}
          <div
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
            className="flex h-14 items-center justify-between px-4"
          >
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="flex items-center gap-2.5 text-left"
            >
              <div className="brand-mark-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-xs">
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

          {/* Navigation Rail */}
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            <div>
              <div
                style={{ color: 'var(--text-secondary)' }}
                className="px-2.5 pb-1.5 font-mono text-[10px] font-bold tracking-wider uppercase"
              >
                Control Plane
              </div>
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeRoute === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(item.id)}
                        style={
                          active
                            ? {
                                backgroundColor: 'var(--brand-soft)',
                                color: 'var(--text-primary)',
                                borderLeft: '3px solid var(--brand-primary)',
                              }
                            : {
                                color: 'var(--text-secondary)',
                                borderLeft: '3px solid transparent',
                              }
                        }
                        className="flex w-full items-center gap-2.5 rounded-r-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors hover:opacity-95"
                      >
                        <Icon
                          style={{
                            color: active
                              ? 'var(--brand-text)'
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

            {/* Architecture Posture Badge */}
            <div className="console-well rounded-xl p-3 text-[11px]">
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

          {/* Operator Footer */}
          <div
            style={{ borderTop: '1px solid var(--border-subtle)' }}
            className="space-y-2.5 p-3"
          >
            {operatorEmail ? (
              <div className="px-1.5">
                <div
                  style={{ color: 'var(--text-secondary)' }}
                  className="font-mono text-[9.5px] font-semibold uppercase"
                >
                  Central Admin
                </div>
                <div className="truncate text-xs font-semibold">
                  {operatorEmail}
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleTheme}
                title={
                  theme === 'dark'
                    ? 'Switch to Vanilla Cream Light Mode'
                    : 'Switch to Hunter Forest Dark Mode'
                }
                aria-label="Toggle color theme"
                className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              >
                {theme === 'dark' ? (
                  <Sun
                    style={{ color: 'var(--accent-energy)' }}
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
        </aside>

        {/* Mobile Slide-Over Menu Drawer */}
        {mobileMenuOpen ? (
          <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
            <div
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            />
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRight: '1px solid var(--border-subtle)',
              }}
              className="relative z-10 flex w-72 max-w-[84vw] flex-col"
            >
              <div className="cf-top-stripe h-[3px] w-full shrink-0" />
              <div
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
                className="flex h-14 items-center justify-between px-4"
              >
                <div className="flex items-center gap-2.5">
                  <div className="brand-mark-tile flex h-8 w-8 items-center justify-center rounded-lg">
                    <Cloud className="h-4 w-4 stroke-[2.3]" />
                  </div>
                  <span className="text-sm font-bold">myClinic Central</span>
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

              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeRoute === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--brand-soft)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--brand-border)',
                            }
                          : {
                              color: 'var(--text-secondary)',
                              border: '1px solid transparent',
                            }
                      }
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold"
                    >
                      <Icon
                        style={{
                          color: active
                            ? 'var(--brand-text)'
                            : 'var(--text-secondary)',
                        }}
                        className="h-4 w-4 shrink-0"
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div
                style={{ borderTop: '1px solid var(--border-subtle)' }}
                className="space-y-2.5 p-4"
              >
                {operatorEmail ? (
                  <div
                    style={{ color: 'var(--text-secondary)' }}
                    className="truncate font-mono text-xs"
                  >
                    {operatorEmail}
                  </div>
                ) : null}
                {onSignOut ? (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="console-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Main Content Column */}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
          {/* Sticky Top Header */}
          <header
            style={{
              backgroundColor: 'var(--bg-header)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
            className="sticky top-[3px] z-20 backdrop-blur-md"
          >
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  aria-label="Open navigation menu"
                  className="console-btn-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>

                <div className="min-w-0">
                  <div
                    style={{ color: 'var(--text-secondary)' }}
                    className="hidden items-center gap-1 font-mono text-[11px] sm:flex"
                  >
                    <span>myClinic Central</span>
                    <ChevronRight className="h-3 w-3" />
                    <span>{routeInfo.crumb}</span>
                  </div>
                  <h1 className="truncate text-sm font-bold tracking-tight sm:text-base">
                    {routeInfo.title}
                  </h1>
                </div>
              </div>

              {/* Right Quick Status + Theme Switch */}
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
                    theme === 'dark'
                      ? 'Switch to Vanilla Cream Light Mode'
                      : 'Switch to Hunter Forest Dark Mode'
                  }
                  aria-label="Toggle color theme"
                  className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
                >
                  {theme === 'dark' ? (
                    <Sun
                      style={{ color: 'var(--accent-energy)' }}
                      className="h-4 w-4"
                    />
                  ) : (
                    <Moon
                      style={{ color: 'var(--brand-primary)' }}
                      className="h-4 w-4"
                    />
                  )}
                </button>
              </div>
            </div>
          </header>

          {/* Main Workspace Canvas */}
          <main className="cf-grid-bg flex-1 pb-24 lg:pb-10">
            <div className="mx-auto max-w-7xl px-3.5 py-4 sm:px-6 sm:py-6 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
        }}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              style={{
                color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
              }}
              className="relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold"
            >
              {active ? (
                <span
                  style={{ backgroundColor: 'var(--brand-primary)' }}
                  className="absolute inset-x-3 top-0 h-[2.5px] rounded-b-full"
                />
              ) : null}
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-[64px]">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default AppShell;
