import type { AppRoute } from '@hydroledger/shared';
import { visibleNavRoutes } from '@hydroledger/shared';
import { NavLink } from 'react-router-dom';
import { t, type MessageKey } from '@/lib/i18n';
import { useSessionStore } from '@/store/session';

const PATH: Record<Exclude<AppRoute, 'public'>, string> = {
  overview: '/',
  flow: '/flow',
  alerts: '/alerts',
  quotas: '/quotas',
  ledger: '/ledger',
  valves: '/valves',
  reports: '/reports',
  admin: '/admin',
};

const LABEL: Record<Exclude<AppRoute, 'public'>, MessageKey> = {
  overview: 'nav.overview',
  flow: 'nav.flow',
  alerts: 'nav.alerts',
  quotas: 'nav.quotas',
  ledger: 'nav.ledger',
  valves: 'nav.valves',
  reports: 'nav.reports',
  admin: 'nav.admin',
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const role = useSessionStore((s) => s.role);
  const routes = visibleNavRoutes(role).filter(
    (r): r is Exclude<AppRoute, 'public'> => r !== 'public',
  );

  return (
    <aside
      className={[
        'flex shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-52',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 items-center justify-center border-b border-border text-text-2 hover:text-accent"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </button>
      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Primary">
        {routes.map((route) => (
          <NavLink
            key={route}
            to={PATH[route]}
            end={route === 'overview'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-btn px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-l-2 border-accent bg-surface pl-[10px] text-accent'
                  : 'border-l-2 border-transparent text-text-2 hover:bg-surface hover:text-text',
              ].join(' ')
            }
          >
            <span className="font-mono text-[11px] opacity-70" aria-hidden>
              {route.slice(0, 2).toUpperCase()}
            </span>
            {!collapsed ? <span>{t(LABEL[route])}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-2">
        <NavLink
          to="/public"
          className="flex items-center gap-3 rounded-btn px-3 py-2 text-sm text-text-2 hover:bg-surface hover:text-accent"
        >
          <span className="font-mono text-[11px] opacity-70" aria-hidden>
            PU
          </span>
          {!collapsed ? <span>Public view</span> : null}
        </NavLink>
      </div>
    </aside>
  );
}
