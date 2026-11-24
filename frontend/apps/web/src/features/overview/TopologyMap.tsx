import { closeCauseLabel, type SectorStateView } from '@hydroledger/shared';
import { formatLpm } from '@/lib/format';
import { Card, Chip, StatusGlyph } from '@/components/ui';

interface TopologyMapProps {
  sectors: SectorStateView[];
  leakThreshold: number;
  selectedSectorId: string;
  onSelect: (id: SectorStateView['id']) => void;
}

export function TopologyMap({
  sectors,
  leakThreshold,
  selectedSectorId,
  onSelect,
}: TopologyMapProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="label-caps text-text">Sectors (backend model)</h2>
        <p className="font-mono text-[10px] text-text-2">
          Upstream_Master → Sector_A / B / C · ε {leakThreshold.toFixed(1)} L/min
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {sectors.map((s) => {
          const leaking = s.deltaQLpm > leakThreshold || s.closeCause === 1;
          const selected = s.id === selectedSectorId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className="text-left"
            >
              <Card
                hazard={leaking && s.isValveClosed}
                critical={s.closeCause === 1 && s.isValveClosed}
                className={selected ? 'ring-2 ring-accent' : ''}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-bold">{s.name}</p>
                  <StatusGlyph
                    status={
                      s.status === 'stale' || s.status === 'offline'
                        ? 'stale'
                        : leaking
                          ? s.isValveClosed
                            ? 'critical'
                            : 'warning'
                          : 'normal'
                    }
                    showLabel={false}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] text-text-2">Upstream_Master</p>
                <p className="font-mono text-lg">{formatLpm(s.upstreamFlowLpm)} L/min</p>
                <p className="mt-2 font-mono text-[11px] text-text-2">Downstream {s.id}</p>
                <p className="font-mono text-lg">{formatLpm(s.downstreamFlowLpm)} L/min</p>
                <p className={`mt-2 font-mono text-sm ${leaking ? 'text-accent' : 'text-text'}`}>
                  ΔQ {formatLpm(s.deltaQLpm)}
                  {leaking ? ' ◆' : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Chip accent={s.isValveClosed}>
                    Valve {s.isValveClosed ? 'CLOSED' : 'OPEN'}
                  </Chip>
                  {s.closeCause !== 0 ? (
                    <Chip>{closeCauseLabel(s.closeCause)}</Chip>
                  ) : null}
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
