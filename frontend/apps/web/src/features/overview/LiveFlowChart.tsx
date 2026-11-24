import type { FlowSample } from '@hydroledger/shared';
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Card } from '@/components/ui';

interface LiveFlowChartProps {
  series: FlowSample[];
  leakThreshold: number;
  title?: string;
}

export function LiveFlowChart({
  series,
  leakThreshold,
  title = 'Live flow · upstream vs downstream',
}: LiveFlowChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const data: uPlot.AlignedData = [
      series.map((s) => s.ts / 1000),
      series.map((s) => s.upstream),
      series.map((s) => s.downstream),
    ];

    if (!plotRef.current) {
      plotRef.current = new uPlot(
        {
          width: elRef.current.clientWidth || 600,
          height: 220,
          scales: { x: { time: true } },
          axes: [
            { stroke: '#A0A0A0', grid: { stroke: '#2A2A2A' }, ticks: { stroke: '#2A2A2A' } },
            { stroke: '#A0A0A0', grid: { stroke: '#2A2A2A' }, ticks: { stroke: '#2A2A2A' } },
          ],
          series: [
            {},
            { label: 'Upstream', stroke: '#FFC400', width: 2 },
            { label: 'Downstream', stroke: '#FFFFFF', width: 2 },
          ],
          legend: { show: true },
          cursor: { show: true },
        },
        data,
        elRef.current,
      );
    } else {
      plotRef.current.setData(data);
    }

    const onResize = () => {
      if (plotRef.current && elRef.current) {
        plotRef.current.setSize({ width: elRef.current.clientWidth, height: 220 });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [series]);

  useEffect(() => {
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="label-caps text-text">{title}</h2>
        <p className="font-mono text-[10px] text-text-2">ε {leakThreshold.toFixed(1)}</p>
      </div>
      <div ref={elRef} className="w-full" />
    </Card>
  );
}
