import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { RequireRole } from '@/components/shell/RequireRole';
import { Skeleton } from '@/components/ui';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { FlowPage } from '@/features/flow/FlowPage';
import { AlertsPage } from '@/features/alerts/AlertsPage';
import { QuotasPage } from '@/features/quotas/QuotasPage';
import { LedgerPage } from '@/features/ledger/LedgerPage';
import { ValvesPage } from '@/features/valves/ValvesPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { CitizenPage } from '@/features/public/CitizenPage';
import type { AppRoute } from '@hydroledger/shared';
import type { ReactNode } from 'react';

const DesignSystemPage = lazy(() =>
  import('@/features/design/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })),
);

function Guarded({ route, children }: { route: AppRoute; children: ReactNode }) {
  return <RequireRole route={route}>{children}</RequireRole>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/public" element={<CitizenPage />} />
        <Route
          path="/__design"
          element={
            <Suspense fallback={<Skeleton className="m-6 h-40" />}>
              <DesignSystemPage />
            </Suspense>
          }
        />
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route
            path="flow"
            element={
              <Guarded route="flow">
                <FlowPage />
              </Guarded>
            }
          />
          <Route
            path="alerts"
            element={
              <Guarded route="alerts">
                <AlertsPage />
              </Guarded>
            }
          />
          <Route
            path="quotas"
            element={
              <Guarded route="quotas">
                <QuotasPage />
              </Guarded>
            }
          />
          <Route
            path="ledger"
            element={
              <Guarded route="ledger">
                <LedgerPage />
              </Guarded>
            }
          />
          <Route
            path="valves"
            element={
              <Guarded route="valves">
                <ValvesPage />
              </Guarded>
            }
          />
          <Route
            path="reports"
            element={
              <Guarded route="reports">
                <ReportsPage />
              </Guarded>
            }
          />
          <Route
            path="admin"
            element={
              <Guarded route="admin">
                <AdminPage />
              </Guarded>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
