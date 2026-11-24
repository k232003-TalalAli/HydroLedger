import { useState } from 'react';
import type { Alert } from '@hydroledger/shared';
import { Modal, Skeleton } from '@/components/ui';
import { AlertsPanel } from '@/features/overview/AlertsPanel';
import { useDashboard, useScenarioControls } from '@/data/hooks';
import { useSessionStore } from '@/store/session';

export function AlertsPage() {
  const { data, isLoading } = useDashboard();
  const role = useSessionStore((s) => s.role);
  const { acknowledgeAlert, closeValve } = useScenarioControls();
  const [detail, setDetail] = useState<Alert | null>(null);

  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Alerts</h1>
      <AlertsPanel
        alerts={data.alerts}
        role={role}
        onAcknowledge={acknowledgeAlert}
        onIsolate={(a) => {
          closeValve(a.sectorId);
          acknowledgeAlert(a.id);
        }}
        onDetails={setDetail}
      />
      <Modal open={!!detail} title="Alert details" onClose={() => setDetail(null)}>
        {detail ? (
          <pre className="overflow-auto font-mono text-[11px]">{JSON.stringify(detail, null, 2)}</pre>
        ) : null}
      </Modal>
    </div>
  );
}
