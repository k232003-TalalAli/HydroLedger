import { describe, expect, it } from 'vitest';
import { canAccessRoute, hasPermission, visibleNavRoutes } from './roles';

describe('role permissions', () => {
  it('hides valves and admin from citizen', () => {
    expect(canAccessRoute('citizen', 'valves')).toBe(false);
    expect(canAccessRoute('citizen', 'admin')).toBe(false);
    expect(visibleNavRoutes('citizen')).not.toContain('valves');
    expect(visibleNavRoutes('citizen')).not.toContain('admin');
  });

  it('allows operator valve isolate but not admin configure', () => {
    expect(hasPermission('operator', 'action:valve:isolate')).toBe(true);
    expect(hasPermission('operator', 'action:valve:override')).toBe(false);
    expect(hasPermission('operator', 'view:admin')).toBe(false);
    expect(canAccessRoute('operator', 'valves')).toBe(true);
    expect(canAccessRoute('operator', 'admin')).toBe(false);
  });

  it('gives admin full nav including admin page', () => {
    expect(canAccessRoute('admin', 'admin')).toBe(true);
    expect(hasPermission('admin', 'action:admin:configure')).toBe(true);
    expect(visibleNavRoutes('admin')).toContain('admin');
  });
});
