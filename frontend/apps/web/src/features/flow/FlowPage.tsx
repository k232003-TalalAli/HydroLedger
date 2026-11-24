import { Card, Skeleton } from '@/components/ui';
import { LiveFlowChart } from '@/features/overview/LiveFlowChart';
import { useDashboard } from '@/data/hooks';
import { formatLpm } from '@/lib/format';

export function FlowPage() {
  const { data, isLoading } = useDashboard();
  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Live Flow</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {data.sectors.map((s) => (
          <Card key={s.id} className={s.status !== 'online' ? 'border-dashed opacity-80' : ''}>
            <p className="label-caps">{s.name}</p>
            <p className="mt-2 font-mono text-sm text-text-2">up {formatLpm(s.upstreamFlowLpm)}</p>
            <p className="font-mono text-2xl font-bold">{formatLpm(s.downstreamFlowLpm)}</p>
            <p className="text-xs text-text-2">
              down L/min · ΔQ {formatLpm(s.deltaQLpm)} · {s.status}
            </p>
          </Card>
        ))}
      </div>
      <LiveFlowChart
        series={data.flowSeries.filter(
          (s) => !s.sectorId || s.sectorId === data.selectedSectorId,
        )}
        leakThreshold={data.kpis.leakThresholdLpm}
        title={`Live flow · ${data.selectedSectorId}`}
      />
    </div>
  );
}
