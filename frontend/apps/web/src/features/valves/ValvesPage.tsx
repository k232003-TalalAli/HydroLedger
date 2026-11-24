import { useState } from 'react';
import { closeCauseLabel, type SectorId } from '@hydroledger/shared';
import { hasPermission } from '@hydroledger/shared';
import { Button, Card, Chip, Modal, Skeleton } from '@/components/ui';
import { useDashboard, useScenarioControls } from '@/data/hooks';
import { useSessionStore } from '@/store/session';
import { formatRelativeTime } from '@/lib/format';

export function ValvesPage() {
  const { data, isLoading } = useDashboard();
  const role = useSessionStore((s) => s.role);
  const { closeValve, openValve } = useScenarioControls();
  const [pending, setPending] = useState<{ id: SectorId; action: 'open' | 'close' } | null>(null);
  const [reason, setReason] = useState('');
  const canIsolate = hasPermission(role, 'action:valve:isolate');

  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Valves</h1>
      <p className="text-sm text-text-2">
        Close publishes MQTT <code>CLOSE_VALVE</code>. If the chain still shows closed after Open,
        an owner must run <code>reset-sector.js</code> on Laptop A.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {data.sectors.map((s) => (
          <Card key={s.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-lg">{s.id}</p>
              <Chip accent={s.isValveClosed}>{s.isValveClosed ? 'CLOSED' : 'OPEN'}</Chip>
            </div>
            <p className="text-xs text-text-2">
              Cause {closeCauseLabel(s.closeCause)}
              {s.lastUpdated ? ` · ${formatRelativeTime(s.lastUpdated)}` : ''}
            </p>
            {canIsolate ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!s.isValveClosed}
                  onClick={() => setPending({ id: s.id, action: 'open' })}
                >
                  Open (MQTT)
                </Button>
                <Button
                  size="sm"
                  disabled={s.isValveClosed}
                  onClick={() => setPending({ id: s.id, action: 'close' })}
                >
                  Close / Isolate
                </Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      <Modal
        open={!!pending}
        title={pending?.action === 'close' ? 'Close valve' : 'Open valve'}
        onClose={() => {
          setPending(null);
          setReason('');
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending?.action === 'close' && reason.trim().length < 3}
              onClick={() => {
                if (!pending) return;
                if (pending.action === 'close') closeValve(pending.id);
                else openValve(pending.id);
                setPending(null);
                setReason('');
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        {pending?.action === 'close' ? (
          <textarea
            className="w-full rounded-btn border border-border bg-bg p-2 text-sm"
            rows={3}
            placeholder="Reason required"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : (
          <p className="text-sm text-text-2">
            MQTT OPEN_VALVE clears local lock only; chain may still require owner reset.
          </p>
        )}
      </Modal>
    </div>
  );
}
