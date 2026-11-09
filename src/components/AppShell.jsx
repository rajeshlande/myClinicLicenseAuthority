import React, { useState } from 'react';
import {
  Activity,
  BookOpen,
  Blocks,
  Building2,
  ChevronRight,
  Cloud,
  LogOut,
  Menu,
  Moon,
  Plus,
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
    section: 'Subscriptions',
    icon: Building2,
  },
  {
    id: 'guide',
    label: 'Quickstart Guide',
    shortLabel: 'Guide',
    section: 'Onboarding',
    icon: BookOpen,
  },
  {
    id: 'node-agent',
    label: 'Client SDK & Obfuscator',
    shortLabel: 'Client SDK',
    section: 'Integration',
    icon: Blocks,
  },
  {
    id: 'simulator',
    label: 'Sync & Security Lab',
    shortLabel: 'Sync Lab',
    section: 'Diagnostics',
    icon: Activity,
  },
  {
    id: 'setup',
    label: 'Settings & Health',
    shortLabel: 'Settings',
    section: 'System',
    icon: Settings,
  },
];

const ROUTE_META = {
  dashboard: {
    title: 'Clinics & Subscriptions',
    crumb: 'Subscriptions / Fleet Registry',
  },
  guide: {
    title: '2-Side Quickstart Guide',
    crumb: 'Onboarding / Central + Client Setup',
  },
  'node-agent': {
    title: 'myClinic Client SDK & Obfuscator',
    crumb: 'Integration / Client Build Kit',
  },
  simulator: {
    title: 'Live Sync & Security Lab',
    crumb: 'Diagnostics / RPC Firewall & Simulator',
  },
  setup: {
    title: 'Settings & Connection Health',
    crumb: 'System / Central Supabase',
  },
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
  const meta = ROUTE_META[activeRoute] ?? ROUTE_META.dashboard;

  const navigateTo = (id) => {
    window.location.hash = `#/${id}`;
    setMobileOpen(false);
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col justify-between">
      <div>
        {/* Brand Header */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex h-14 items-center justify-between px-4"
        >
          <button
            type="button"
            onClick={() => navigateTo('dashboard')}
            className="flex min-w-0 items-center gap-2.5 text-left"
          >
            <div
              style={{
                background: 'linear-gradient(135deg, #f6821f 0%, #fbad41 100%)',
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-xs"
            >
              <Cloud className="h-4 w-4 stroke-[2.4]" />
            </div>
            <div className="min-w-0">
              <div
                style={{ color: 'var(--text-primary)' }}
                className="truncate text-xs font-bold tracking-tight"
              >
                myClinic Central
              </div>
              <div
                style={{ color: 'var(--text-muted)' }}
                className="truncate font-mono text-[10px]"
              >
                Auto-Sync · v{APP_VERSION}
              </div>
            </div>
          </button>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Primary Action */}
        {onQuickIssueLicense ? (
          <div className="px-3 pt-4 pb-2">
            <button
              type="button"
              onClick={() => {
                onQuickIssueLicense();
                if (isMobile) setMobileOpen(false);
              }}
              className="console-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              Add Clinic Subscription
            </button>
          </div>
        ) : null}

        {/* Cloudflare Zone Rail Navigation */}
        <div className="mt-2 px-3">
          <div
            style={{ color: 'var(--text-muted)' }}
            className="px-2 pb-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase"
          >
            Control Plane
          </div>
          <nav className="space-y-0.5" aria-label="Primary Navigation">
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
                          backgroundColor: 'var(--cf-orange-soft)',
                          color: 'var(--text-primary)',
                          borderLeft: '3px solid var(--cf-orange)',
                        }
                      : {
                          color: 'var(--text-secondary)',
                          borderLeft: '3px solid transparent',
                        }
                  }
                  className="console-row-hover flex w-full items-center gap-2.5 rounded-r-lg px-2.5 py-2 text-left text-xs font-medium transition-colors"
                >
                  <Icon
                    style={{
                      color: active ? 'var(--cf-orange)' : 'var(--text-muted)',
                    }}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Security Status Card inside Rail */}
        <div className="mx-3 mt-5 rounded-xl p-3 console-well">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="font-mono text-[10.5px] font-semibold">
              Zero-Key RPC · Schema v{SCHEMA_VERSION}
            </span>
          </div>
          <p
            style={{ color: 'var(--text-muted)' }}
            className="mt-1 text-[11px] leading-relaxed"
          >
            FORCE RLS active. Clients sync by Email, URL, or Both with zero table
            exposure.
          </p>
        </div>
      </div>

      {/* Operator Footer */}
      <div
        style={{ borderTop: '1px solid var(--border-subtle)' }}
        className="space-y-2.5 p-3.5"
      >
        {operatorEmail ? (
          <div className="min-w-0 px-1">
            <div
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[9.5px] tracking-wider uppercase"
            >
              Central Admin
            </div>
            <p
              style={{ color: 'var(--text-primary)' }}
              className="truncate text-xs font-medium"
              title={operatorEmail}
            >
              {operatorEmail}
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5">
          {onToggleTheme ? (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle color theme"
              className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}

          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="console-btn-secondary inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          ) : null}
        </div>
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
      {/* Cloudflare Top Orange Signature Hairline */}
      <div className="cf-top-stripe fixed inset-x-0 top-0 z-50 h-[2.5px]" />

      {/* Desktop Fixed Left Sidebar */}
      <aside
        style={{
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
        className="hidden w-60 shrink-0 pt-[2.5px] lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block"
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Slide-Over Sidebar Drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <aside
            style={{
              backgroundColor: 'var(--bg-sidebar)',
              borderRight: '1px solid var(--border-default)',
            }}
            className="relative z-10 w-72 max-w-[85vw] pt-[2.5px] shadow-2xl"
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col pt-[2.5px] pb-20 lg:pb-0 lg:pl-60">
        {/* Sticky Cloudflare Top Utility Header */}
        <header
          style={{
            backgroundColor: 'var(--bg-header)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          className="sticky top-[2.5px] z-20 backdrop-blur-md"
        >
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2.5 px-3.5 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="console-btn-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="min-w-0">
                <div
                  style={{ color: 'var(--text-muted)' }}
                  className="hidden items-center gap-1 font-mono text-[10.5px] sm:flex"
                >
                  <span>myClinic Central</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="truncate">{meta.crumb}</span>
                </div>
                <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  {meta.title}
                </h1>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!isOnline ? (
                <span
                  style={{
                    backgroundColor: 'var(--warn-soft)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: 'var(--warn-text)',
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium"
                >
                  <WifiOff className="h-3 w-3" />
                  <span className="hidden sm:inline">Offline</span>
                </span>
              ) : (
                <span
                  style={{
                    backgroundColor: 'var(--ok-soft)',
                    border: '1px solid var(--ok-border)',
                    color: 'var(--ok-text)',
                  }}
                  className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium md:inline-flex"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Edge RPC Ready
                </span>
              )}

              {onToggleTheme ? (
                <button
                  type="button"
                  onClick={onToggleTheme}
                  aria-label="Switch theme"
                  className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
                  title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </button>
              ) : null}

              {onQuickIssueLicense ? (
                <button
                  type="button"
                  onClick={onQuickIssueLicense}
                  className="console-btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  <span className="hidden sm:inline">Add Clinic</span>
                  <span className="sm:hidden">Add</span>
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3.5 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Quick-Tab Bar (< 1024px) for Effortless One-Handed Navigation */}
      <nav
        aria-label="Mobile Bottom Navigation"
        style={{
          backgroundColor: 'var(--bg-header)',
          borderTop: '1px solid var(--border-subtle)',
        }}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 backdrop-blur-md lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              style={{
                color: active ? 'var(--cf-orange)' : 'var(--text-muted)',
              }}
              className="relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors"
            >
              {active ? (
                <span
                  style={{ backgroundColor: 'var(--cf-orange)' }}
                  className="absolute inset-x-3 top-0 h-[2px] rounded-b-full"
                />
              ) : null}
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-w-full truncate px-1">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default AppShell;
