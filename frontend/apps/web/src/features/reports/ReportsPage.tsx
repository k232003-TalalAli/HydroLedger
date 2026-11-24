import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useDashboard } from '@/data/hooks';

export function ReportsPage() {
  const { data } = useDashboard();
  const [msg, setMsg] = useState<string | null>(null);

  const downloadCsv = () => {
    if (!data) return;
    const rows = [
      ['section', 'key', 'value'],
      ['kpi', 'upstream_avg', String(data.kpis.totalUpstreamLpm)],
      ['kpi', 'delta_q_sum', String(data.kpis.totalDeltaQLpm)],
      ...data.sectors.map((s) => ['sector', s.id, `${s.downstreamFlowLpm},${s.deltaQLpm},${s.isValveClosed}`]),
      ...data.alerts.map((a) => ['alert', a.id, a.title]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hydroledger-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('CSV downloaded.');
  };

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Reports</h1>
      <Card className="space-y-3">
        <p className="text-sm text-text-2">Export current sector / alert snapshot as CSV.</p>
        <Button onClick={downloadCsv}>Download CSV</Button>
        {msg ? <p className="text-xs text-accent">{msg}</p> : null}
      </Card>
    </div>
  );
}
