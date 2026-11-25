import { useState } from 'react';
import { closeCauseLabel, type SectorId } from '@hydroledger/shared';
import { hasPermission } from '@hydroledger/shared';
import { Button, Card, Chip, Modal, Skeleton } from '@/components/ui';
import { useDashboard, useDashboardActions } from '@/data/hooks';
import { useSessionStore } from '@/store/session';
import { formatRelativeTime } from '@/lib/format';
import { localSectorId } from '@/lib/localSector';

export function ValvesPage() {
  const { data, isLoading } = useDashboard();
  const role = useSessionStore((s) => s.role);
  const { openValve } = useDashboardActions();
  const [pending, setPending] = useState<SectorId | null>(null);
  const canActuate = hasPermission(role, 'action:valve:isolate');
  const localId = localSectorId();

  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Valves</h1>
      <p className="text-sm text-text-2">
        Valve open/closed status is always from the chain. For this laptop&apos;s sector (
        <span className="font-mono">{localId}</span>), Open publishes MQTT{' '}
        <code>OPEN_VALVE</code> to re-arm the aggregator; on-chain reopen still needs Laptop A
        owner-reset / <code>reset-sector</code>. Other sectors are read-only.
      </p>
      {data.awaitingOwnerReset ? (
        <p className="text-sm text-accent" role="status">
          Awaiting on-chain owner reset for <span className="font-mono">{localId}</span>.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {data.sectors.map((s) => {
          const isLocal = s.id === localId;
          return (
            <Card key={s.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-lg">{s.id}</p>
                <Chip accent={s.isValveClosed}>{s.isValveClosed ? 'CLOSED' : 'OPEN'}</Chip>
              </div>
              <p className="text-xs text-text-2">
                {isLocal ? 'Local sector (chain status)' : 'Remote (chain only)'} · Cause{' '}
                {closeCauseLabel(s.closeCause)}
                {s.lastUpdated ? ` · ${formatRelativeTime(s.lastUpdated)}` : ''}
              </p>
              {canActuate && isLocal ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!s.isValveClosed}
                  onClick={() => setPending(s.id)}
                >
                  Open (MQTT)
                </Button>
              ) : canActuate && !isLocal ? (
                <p className="text-xs text-text-2">Actuation from this UI is local-sector only.</p>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Modal
        open={!!pending}
        title="Open valve"
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pending) return;
                openValve(pending);
                setPending(null);
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-2">
          Publishes MQTT <code>OPEN_VALVE</code> (same as Node-RED). Clears the local aggregator
          lock; on-chain reopen still needs Laptop A owner-reset if the registry shows closed. UI
          status updates only when the chain changes.
        </p>
      </Modal>
    </div>
  );
}
