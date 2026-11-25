import { useState } from 'react';
import type { Alert } from '@hydroledger/shared';
import { hasPermission } from '@hydroledger/shared';
import { Modal, Skeleton } from '@/components/ui';
import { AlertsPanel } from '@/features/overview/AlertsPanel';
import { useDashboard, useDashboardActions } from '@/data/hooks';
import { useSessionStore } from '@/store/session';
import { localSectorId } from '@/lib/localSector';

export function AlertsPage() {
  const { data, isLoading } = useDashboard();
  const role = useSessionStore((s) => s.role);
  const { openValve } = useDashboardActions();
  const [detail, setDetail] = useState<Alert | null>(null);
  const localId = localSectorId();
  const canActuate = hasPermission(role, 'action:valve:isolate');

  if (isLoading || !data) return <Skeleton className="h-64" />;

  const localValveClosed = Boolean(data.sectors.find((s) => s.id === localId)?.isValveClosed);

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Alerts</h1>
      {data.awaitingOwnerReset ? (
        <p className="text-sm text-text-2" role="status">
          MQTT open sent — awaiting on-chain owner reset for <span className="font-mono">{localId}</span>.
        </p>
      ) : null}
      <AlertsPanel
        alerts={data.alerts}
        role={role}
        localSectorId={localId}
        localValveClosed={localValveClosed}
        onOpenValve={canActuate ? openValve : undefined}
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
