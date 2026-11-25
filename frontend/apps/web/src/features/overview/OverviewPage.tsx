import type { Alert } from '@hydroledger/shared';
import { hasPermission } from '@hydroledger/shared';
import { useMemo, useState } from 'react';
import { CriticalBanner } from '@/components/shell/CriticalBanner';
import { Modal, Skeleton, Chip } from '@/components/ui';
import { useDashboard, useDashboardActions } from '@/data/hooks';
import { useSessionStore } from '@/store/session';
import { formatRelativeTime } from '@/lib/format';
import { localSectorId } from '@/lib/localSector';
import { VerifyModal } from '@/features/ledger/VerifyModal';
import { AlertsPanel } from './AlertsPanel';
import { EventsFeed } from './EventsFeed';
import { IntegrityPanel } from './IntegrityPanel';
import { KpiStrip } from './KpiStrip';
import { LiveFlowChart } from './LiveFlowChart';
import { QuotaBars } from './QuotaBars';
import { TopologyMap } from './TopologyMap';

export function OverviewPage() {
  const { data, isLoading } = useDashboard();
  const role = useSessionStore((s) => s.role);
  const { openValve, selectSector } = useDashboardActions();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [detail, setDetail] = useState<Alert | null>(null);
  const localId = localSectorId();
  const canActuate = hasPermission(role, 'action:valve:isolate');

  const critical = useMemo(
    () => data?.alerts.find((a) => a.severity === 'critical' && a.status === 'active') ?? null,
    [data],
  );

  const localSector = data?.sectors.find((s) => s.id === localId);
  const localValveClosed = Boolean(localSector?.isValveClosed);
  const showBannerOpen =
    canActuate &&
    localValveClosed &&
    critical?.sectorId === localId &&
    (critical.reason === 'ANOMALY_DETECTED' || critical.reason === 'QUOTA_EXCEEDED');

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CriticalBanner
        alert={critical}
        onAction={showBannerOpen ? () => openValve(localId) : undefined}
        actionLabel="Open valve"
      />

      {data.awaitingOwnerReset ? (
        <div
          className="rounded-card border border-accent/40 bg-surface px-4 py-2 text-sm text-text"
          role="status"
        >
          MQTT open sent for <span className="font-mono">{localId}</span>. Registry still shows
          closed — awaiting on-chain owner reset (Laptop A).
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-sans text-sm font-medium uppercase tracking-label text-text">
          Overview
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip accent>LIVE</Chip>
          <p className="font-mono text-[11px] text-text-2">
            Last sync {formatRelativeTime(data.syncedAt)}
          </p>
        </div>
      </div>

      <KpiStrip kpis={data.kpis} />

      <TopologyMap
        sectors={data.sectors}
        leakThreshold={data.kpis.leakThresholdLpm}
        selectedSectorId={data.selectedSectorId}
        onSelect={(id) => selectSector(id)}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <AlertsPanel
          alerts={data.alerts.filter((a) => a.status === 'active')}
          role={role}
          localSectorId={localId}
          localValveClosed={localValveClosed}
          onOpenValve={canActuate ? openValve : undefined}
          onDetails={setDetail}
        />
        <LiveFlowChart
          series={data.flowSeries.filter(
            (s) => !s.sectorId || s.sectorId === data.selectedSectorId,
          )}
          leakThreshold={data.kpis.leakThresholdLpm}
          title={`Live flow · ${data.selectedSectorId}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IntegrityPanel
          chain={data.chain}
          snapshots={data.snapshots}
          chainConnected={data.chainConnected}
          bridgeConnected={data.bridgeConnected}
          preferredSectorId={data.selectedSectorId}
          onVerify={() => setVerifyOpen(true)}
        />
        <QuotaBars sectors={data.sectors} />
        <EventsFeed events={data.events} />
      </div>

      <VerifyModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        defaultSectorId={data.selectedSectorId}
      />

      <Modal open={!!detail} title="Alert details" onClose={() => setDetail(null)}>
        {detail ? (
          <pre className="overflow-auto font-mono text-[11px] text-text">
            {JSON.stringify(detail, null, 2)}
          </pre>
        ) : null}
      </Modal>
    </div>
  );
}
