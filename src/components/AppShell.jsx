import React, { useState } from 'react';
import {
  Container,
  Database,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Sun,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

const NAV_GROUPS = [
  {
    heading: 'Operations',
    items: [
      {
        route: 'dashboard',
        label: 'Entitlement Registry',
        subtitle: 'Keys, seats & kill-switches',
        icon: LayoutDashboard,
      },
      {
        route: 'node-agent',
        label: 'Deployment & Pages Kit',
        subtitle: 'Docker & GitHub Pages',
        icon: Container,
      },
    ],
  },
  {
    heading: 'Cryptography',
    items: [
      {
        route: 'simulator',
        label: 'RS256 Validator Lab',
        subtitle: 'Key Studio & JWT verifier',
        icon: Terminal,
      },
      {
        route: 'setup',
        label: 'Authority & Session',
        subtitle: 'Health test & security',
        icon: Database,
      },
    ],
  },
];

const ROUTE_META = {
  dashboard: {
    section: 'Operations',
    title: 'Entitlement & Hardware Lock Registry',
    description:
      'Provision manual clinic subscriptions, inspect bound hardware/origin seats, and control remote kill-switches.',
  },
  'node-agent': {
    section: 'Operations',
    title: 'Customer Deployment & Validation Kit',
    description:
      'Generate ready-to-ship manifests for On-Premises Docker gateways or GitHub-Pages-hosted myClinic apps.',
  },
  simulator: {
    section: 'Cryptography',
    title: 'RS256 Key Studio & Phone-Home Workbench',
    description:
      'Mint 2048-bit PKCS#8 / SPKI keys via WebCrypto, simulate Edge heartbeats, and verify capability JWTs offline.',
  },
  setup: {
    section: 'Cryptography',
    title: 'Cloud Authority Diagnostics & Operator Session',
    description:
      'Run live Supabase REST/schema health checks, rotate operator passwords, and inspect Cloud Authority SQL rules.',
  },
};

export default function AppShell({
  activeRoute,
  isOnline,
  operatorEmail,
  theme,
  onToggleTheme,
  onQuickIssueLicense,
  onSignOut,
  children,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const meta = ROUTE_META[activeRoute] ?? ROUTE_META.dashboard;

  const renderSidebarContent = ({ isMobile = false, collapsed = false } = {}) => (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
        className={`flex h-14 items-center ${
          collapsed ? 'justify-center px-2' : 'justify-between px-3.5'
        }`}
      >
        <a
          href="#/dashboard"
          onClick={() => isMobile && setMobileNavOpen(false)}
          title="myClinic Authority"
          className="flex min-w-0 items-center gap-2.5"
        >
          <span
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-400"
          >
            <KeyRound className="h-4 w-4" />
          </span>
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <span
                style={{ color: 'var(--text-primary)' }}
                className="block truncate text-[13.5px] font-semibold tracking-tight"
              >
                myClinic Authority
              </span>
              <span
                style={{ color: 'var(--text-muted)' }}
                className="block truncate font-mono text-[9.5px]"
              >
                RS256 CONTROL PLANE
              </span>
            </div>
          ) : null}
        </a>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
            className="console-btn-secondary inline-flex h-7 w-7 items-center justify-center rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        ) : !collapsed ? (
          <button
            type="button"
            onClick={() => setRailCollapsed(true)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="console-btn-secondary inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && !isMobile ? (
        <div className="flex justify-center px-2 pt-2.5">
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Quick Primary CTA inside Rail */}
      <div className={collapsed ? 'px-2 pt-2.5 pb-1' : 'px-3 pt-3.5 pb-1.5'}>
        <button
          type="button"
          title="Issue New License Key"
          onClick={() => {
            if (isMobile) setMobileNavOpen(false);
            onQuickIssueLicense();
          }}
          className={`console-btn-primary flex w-full items-center justify-center gap-1.5 rounded-lg ${
            collapsed ? 'h-9 px-0' : 'px-3 py-2'
          } text-xs shadow-xs`}
        >
          <Plus className="h-4 w-4 shrink-0 stroke-[2.5]" />
          {!collapsed ? <span>Issue License Key</span> : null}
        </button>
      </div>

      {/* Navigation Groups */}
      <nav
        aria-label="Console navigation"
        className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            {!collapsed ? (
              <div
                style={{ color: 'var(--text-muted)' }}
                className="px-2 pb-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase"
              >
                {group.heading}
              </div>
            ) : null}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeRoute === item.route;
                return (
                  <a
                    key={item.route}
                    href={`#/${item.route}`}
                    title={collapsed ? item.label : undefined}
                    onClick={() => isMobile && setMobileNavOpen(false)}
                    style={
                      isActive
                        ? {
                            backgroundColor: 'var(--bg-elevated)',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-primary)',
                          }
                        : {
                            border: '1px solid transparent',
                            color: 'var(--text-secondary)',
                          }
                    }
                    className={`group flex items-center ${
                      collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'
                    } rounded-lg text-xs font-medium transition`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'opacity-75 group-hover:opacity-100'
                      }`}
                    />
                    {!collapsed ? (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.label}</div>
                          <div
                            style={{ color: 'var(--text-muted)' }}
                            className="truncate text-[10px]"
                          >
                            {item.subtitle}
                          </div>
                        </div>
                        {isActive ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        ) : null}
                      </>
                    ) : null}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Authenticated Cloud Admin Profile & Sign Out */}
      <div
        style={{ borderTop: '1px solid var(--border-subtle)' }}
        className={collapsed ? 'space-y-1.5 p-2' : 'space-y-2 p-2.5'}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onSignOut}
            title={`Sign out (${operatorEmail})`}
            aria-label="Sign out"
            className="console-btn-secondary flex h-9 w-full items-center justify-center rounded-lg"
          >
            <LogOut className="h-4 w-4 text-rose-400" />
          </button>
        ) : (
          <div className="console-well rounded-xl p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                Cloud Admin
              </span>
              <span
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-primary)',
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
              >
                <ShieldCheck className="h-2.5 w-2.5" />
                RS256
              </span>
            </div>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="mt-1 truncate font-mono text-[10.5px]"
              title={operatorEmail}
            >
              {operatorEmail}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span
                style={{ color: 'var(--text-muted)' }}
                className="font-mono text-[9.5px]"
              >
                v{APP_VERSION} · Schema v{SCHEMA_VERSION}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium"
              >
                <LogOut className="h-3 w-3 text-rose-400" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
      className="flex min-h-screen w-full overflow-x-clip"
    >
      {/* Persistent Sticky Flex Sidebar Rail */}
      <aside
        style={{
          backgroundColor: 'var(--bg-rail)',
          borderRight: '1px solid var(--border-subtle)',
        }}
        className={`hidden shrink-0 transition-[width] duration-150 md:sticky md:top-0 md:flex md:h-screen md:flex-col ${
          railCollapsed ? 'md:w-[64px]' : 'md:w-[244px]'
        }`}
      >
        {renderSidebarContent({ isMobile: false, collapsed: railCollapsed })}
      </aside>

      {/* Mobile Navigation Drawer (< 768px) */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-[2px]"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside
            style={{
              backgroundColor: 'var(--bg-rail)',
              borderRight: '1px solid var(--border-subtle)',
            }}
            className="relative z-10 h-full w-[264px] shadow-2xl"
          >
            {renderSidebarContent({ isMobile: true, collapsed: false })}
          </aside>
        </div>
      ) : null}

      {/* Main Console Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Top Telemetry Command Bar */}
        <header
          style={{
            backgroundColor: 'var(--bg-rail)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 px-4 sm:px-6"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span
                style={{ color: 'var(--text-muted)' }}
                className="hidden font-mono text-[11px] sm:inline"
              >
                {meta.section} /
              </span>
              <h1
                style={{ color: 'var(--text-primary)' }}
                className="truncate text-sm font-semibold tracking-tight"
              >
                {meta.title}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span
              style={
                isOnline
                  ? {
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid var(--accent-border)',
                      color: 'var(--accent-primary)',
                    }
                  : {
                      backgroundColor: 'var(--warn-soft)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      color: 'var(--warn-text)',
                    }
              }
              className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10.5px] font-semibold lg:inline-flex"
            >
              {isOnline ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              {isOnline ? 'CLOUD SUPABASE LIVE' : 'RECONNECTING...'}
            </span>

            <a
              href="#/simulator"
              className="console-btn-secondary hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium sm:inline-flex"
            >
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              Key Studio
            </a>

            <button
              type="button"
              onClick={onQuickIssueLicense}
              className="console-btn-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs md:hidden"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              Issue
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              title={
                theme === 'dark'
                  ? 'Switch to Daylight Console'
                  : 'Switch to Obsidian Dark Console'
              }
              aria-label="Toggle color theme"
              className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-300" />
              ) : (
                <Moon className="h-4 w-4 text-slate-600" />
              )}
            </button>

            <button
              type="button"
              onClick={onSignOut}
              title={`Sign out (${operatorEmail})`}
              aria-label="Sign out"
              className="console-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            >
              <LogOut className="h-3.5 w-3.5 text-rose-400" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Subheader Context Strip */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="px-4 py-2.5 sm:px-6"
        >
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
            {meta.description}
          </p>
        </div>

        {/* Active Route Workspace */}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
