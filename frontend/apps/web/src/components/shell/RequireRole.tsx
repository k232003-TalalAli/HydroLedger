import type { AppRoute } from '@hydroledger/shared';
import { canAccessRoute } from '@hydroledger/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@/store/session';

interface RequireRoleProps {
  route: AppRoute;
  children: ReactNode;
}

export function RequireRole({ route, children }: RequireRoleProps) {
  const role = useSessionStore((s) => s.role);
  if (!canAccessRoute(role, route)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
