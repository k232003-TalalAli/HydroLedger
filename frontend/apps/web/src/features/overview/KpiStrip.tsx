import type { OverviewKpis } from '@hydroledger/shared';
import { Card, StatusGlyph } from '@/components/ui';
import { formatLpm } from '@/lib/format';

interface KpiStripProps {
  kpis: OverviewKpis;
}

export function KpiStrip({ kpis }: KpiStripProps) {
  const lossWarn = kpis.totalDeltaQLpm > kpis.leakThresholdLpm;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-live="polite">
      <Kpi label="Upstream (avg)" value={formatLpm(kpis.totalUpstreamLpm)} unit="L/min" />
      <Kpi label="Downstream (sum)" value={formatLpm(kpis.totalDownstreamLpm)} unit="L/min" />
      <Kpi
        label="ΔQ loss (sum)"
        value={formatLpm(kpis.totalDeltaQLpm)}
        unit={`threshold ε ${kpis.leakThresholdLpm.toFixed(1)} L/min`}
        warning={lossWarn}
      />
      <Kpi
        label="Active alerts"
        value={String(kpis.activeAlerts)}
        unit={`${kpis.criticalAlerts} critical · ${kpis.warningAlerts} warning`}
        hazard={kpis.criticalAlerts > 0}
      />
      <Kpi
        label="Valves / sectors"
        value={`${kpis.valvesClosed} closed`}
        unit={`${kpis.sectorsOnline}/${kpis.sectorsTotal} sectors online`}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  warning,
  hazard,
}: {
  label: string;
  value: string;
  unit: string;
  warning?: boolean;
  hazard?: boolean;
}) {
  return (
    <Card hazard={hazard}>
      <div className="flex items-center justify-between gap-2">
        <p className="label-caps">{label}</p>
        {warning ? <StatusGlyph status="warning" showLabel={false} /> : null}
      </div>
      <p className={`mt-2 font-mono text-2xl font-bold ${warning ? 'text-accent' : 'text-text'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-text-2">{unit}</p>
    </Card>
  );
}
