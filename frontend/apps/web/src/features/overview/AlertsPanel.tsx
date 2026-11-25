import type { Alert, SectorId } from '@hydroledger/shared';
import { hasPermission, type Role } from '@hydroledger/shared';
import { Button, Card, Chip, StatusGlyph } from '@/components/ui';
import { formatRelativeTime, truncateHash } from '@/lib/format';

interface AlertsPanelProps {
  alerts: Alert[];
  role: Role;
  localSectorId: SectorId;
  /** True when local sector valve is closed on-chain. */
  localValveClosed: boolean;
  onOpenValve?: (sectorId: SectorId) => void;
  onDetails: (alert: Alert) => void;
}

export function AlertsPanel({
  alerts,
  role,
  localSectorId,
  localValveClosed,
  onOpenValve,
  onDetails,
}: AlertsPanelProps) {
  const canOpen = hasPermission(role, 'action:valve:isolate') && onOpenValve;
  const sorted = [...alerts].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return (
    <Card className="space-y-3">
      <h2 className="label-caps text-text">Active alerts</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-text-2">No active alerts.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((a) => {
            const showOpen =
              canOpen &&
              a.sectorId === localSectorId &&
              localValveClosed &&
              (a.reason === 'ANOMALY_DETECTED' || a.reason === 'QUOTA_EXCEEDED');
            return (
              <li
                key={a.id}
                className={[
                  'rounded-card border border-border bg-bg p-3',
                  a.severity === 'critical' && a.status === 'active'
                    ? 'animate-pulse-critical border-accent'
                    : '',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <StatusGlyph
                    status={a.severity === 'critical' ? 'critical' : 'warning'}
                    showLabel={false}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-sans text-sm font-medium text-text">
                      {a.severity === 'critical' ? '◆ ' : '▲ '}
                      {a.title}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-2">
                      {a.measuredDeltaQ != null && a.leakThreshold != null
                        ? `ΔQ ${a.measuredDeltaQ.toFixed(1)} > ε ${a.leakThreshold.toFixed(1)} · `
                        : ''}
                      {formatRelativeTime(a.detectedAt)}
                    </p>
                    <div className="mt-2">
                      {a.txHash ? (
                        <Chip accent>On-chain {truncateHash(a.txHash)}</Chip>
                      ) : (
                        <Chip>Pending on-chain</Chip>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onDetails(a)}>
                      Details
                    </Button>
                    {showOpen ? (
                      <Button size="sm" onClick={() => onOpenValve(a.sectorId)}>
                        Open valve
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
