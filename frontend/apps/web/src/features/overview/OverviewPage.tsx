import type { Alert, SectorId } from '@hydroledger/shared';
import { useMemo, useState } from 'react';
import { CriticalBanner } from '@/components/shell/CriticalBanner';
import { Button, Modal, Skeleton, Chip } from '@/components/ui';
import { useDashboard, useScenarioControls } from '@/data/hooks';
import { useSessionStore } from '@/store/session';
import { formatRelativeTime } from '@/lib/format';
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
  const { acknowledgeAlert, closeValve, selectSector } = useScenarioControls();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [detail, setDetail] = useState<Alert | null>(null);
  const [isolateAlert, setIsolateAlert] = useState<Alert | null>(null);
  const [reason, setReason] = useState('');

  const critical = useMemo(
    () => data?.alerts.find((a) => a.severity === 'critical' && a.status === 'active') ?? null,
    [data],
  );

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
        onAction={() => critical && setIsolateAlert(critical)}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-sans text-sm font-medium uppercase tracking-label text-text">
          Overview
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip accent={data.mode === 'live'}>{data.mode.toUpperCase()}</Chip>
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
          onAcknowledge={acknowledgeAlert}
          onIsolate={setIsolateAlert}
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

      <Modal
        open={!!isolateAlert}
        title="Close valve (MQTT)"
        onClose={() => {
          setIsolateAlert(null);
          setReason('');
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsolateAlert(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 3}
              onClick={() => {
                if (isolateAlert) {
                  closeValve(isolateAlert.sectorId as SectorId);
                  acknowledgeAlert(isolateAlert.id);
                }
                setIsolateAlert(null);
                setReason('');
              }}
            >
              Publish CLOSE_VALVE
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          Publishes MQTT <code>actuation/valve</code> CLOSE_VALVE. On-chain reopen still needs owner{' '}
          <code>reset-sector</code> when the registry shows closed.
        </p>
        <label className="block text-xs text-text-2">
          Reason (required)
          <textarea
            className="mt-1 w-full rounded-btn border border-border bg-bg p-2 font-sans text-sm text-text"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </Modal>
    </div>
  );
}
