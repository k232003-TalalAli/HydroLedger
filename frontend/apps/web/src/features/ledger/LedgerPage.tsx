import { useState } from 'react';
import { Button, Card, Chip, DataTable, Skeleton } from '@/components/ui';
import { EventsFeed } from '@/features/overview/EventsFeed';
import { IntegrityPanel } from '@/features/overview/IntegrityPanel';
import { VerifyModal } from '@/features/ledger/VerifyModal';
import { useDashboard } from '@/data/hooks';
import { formatLpm } from '@/lib/format';

export function LedgerPage() {
  const { data, isLoading } = useDashboard();
  const [verifyOpen, setVerifyOpen] = useState(false);

  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-sans text-sm font-medium uppercase tracking-label">Ledger / Verify</h1>
        <Button variant="outline" size="sm" onClick={() => setVerifyOpen(true)}>
          Verify on-chain
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrityPanel
          chain={data.chain}
          snapshots={data.snapshots}
          chainConnected={data.chainConnected}
          bridgeConnected={data.bridgeConnected}
          onVerify={() => setVerifyOpen(true)}
        />
        <EventsFeed events={data.events} />
      </div>
      <Card className="space-y-3">
        <h2 className="label-caps">Telemetry snapshots</h2>
        <DataTable
          rows={data.snapshots}
          getRowKey={(s) => s.sectorId}
          emptyMessage="No snapshots on-chain yet."
          columns={[
            { key: 'id', header: 'Sector', render: (s) => s.sectorId },
            {
              key: 'up',
              header: 'Upstream',
              render: (s) => formatLpm(s.upstreamFlowLpm),
            },
            { key: 'dq', header: 'ΔQ', render: (s) => formatLpm(s.deltaQLpm) },
            {
              key: 'n',
              header: 'Count',
              render: (s) => <Chip>{s.count}</Chip>,
            },
          ]}
        />
      </Card>
      <VerifyModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        defaultSectorId={data.selectedSectorId}
      />
    </div>
  );
}
