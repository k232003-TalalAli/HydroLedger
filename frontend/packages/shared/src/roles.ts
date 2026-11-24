/** Role and permission map (FR UI gating + future API RBAC). */

export const ROLES = ['citizen', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROUTES = [
  'overview',
  'flow',
  'alerts',
  'quotas',
  'ledger',
  'valves',
  'reports',
  'admin',
  'public',
] as const;
export type AppRoute = (typeof ROUTES)[number];

/** Permissions that gate UI nav and (later) API actions. */
export const PERMISSIONS = [
  'view:overview',
  'view:flow',
  'view:alerts',
  'view:alerts:full',
  'view:quotas',
  'view:ledger',
  'view:valves',
  'action:valve:isolate',
  'action:valve:override',
  'view:reports',
  'action:report:generate',
  'view:admin',
  'action:admin:configure',
  'action:alert:acknowledge',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  citizen: [
    'view:overview',
    'view:flow',
    'view:alerts',
    'view:quotas',
    'view:ledger',
    'view:reports',
  ],
  operator: [
    'view:overview',
    'view:flow',
    'view:alerts',
    'view:alerts:full',
    'view:quotas',
    'view:ledger',
    'view:valves',
    'action:valve:isolate',
    'view:reports',
    'action:report:generate',
    'action:alert:acknowledge',
  ],
  admin: [
    'view:overview',
    'view:flow',
    'view:alerts',
    'view:alerts:full',
    'view:quotas',
    'view:ledger',
    'view:valves',
    'action:valve:isolate',
    'action:valve:override',
    'view:reports',
    'action:report:generate',
    'view:admin',
    'action:admin:configure',
    'action:alert:acknowledge',
  ],
};

const ROUTE_PERMISSION: Record<AppRoute, Permission | null> = {
  overview: 'view:overview',
  flow: 'view:flow',
  alerts: 'view:alerts',
  quotas: 'view:quotas',
  ledger: 'view:ledger',
  valves: 'view:valves',
  reports: 'view:reports',
  admin: 'view:admin',
  public: null,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAccessRoute(role: Role, route: AppRoute): boolean {
  const required = ROUTE_PERMISSION[route];
  if (required === null) return true;
  return hasPermission(role, required);
}

/** Sidebar items visible for a role (hidden, not disabled). */
export function visibleNavRoutes(role: Role): AppRoute[] {
  return ROUTES.filter((route) => route !== 'public' && canAccessRoute(role, route));
}
