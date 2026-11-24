import type { SectorStateView } from '@hydroledger/shared';
import { Card, StatusGlyph } from '@/components/ui';

interface QuotaBarsProps {
  sectors: SectorStateView[];
}

export function QuotaBars({ sectors }: QuotaBarsProps) {
  return (
    <Card className="space-y-4">
      <h2 className="label-caps text-text">Sector quotas</h2>
      <p className="text-xs text-text-2">
        From WaterQuotaRegistry (volume ×100 on-chain). Demo day length often 600 s.
      </p>
      {sectors.map((s) => {
        const pct =
          s.dailyQuotaLimitL > 0 ? (s.dailyVolumeUsedL / s.dailyQuotaLimitL) * 100 : 0;
        const warn = pct >= 90 || s.closeCause === 2;
        const full = pct >= 100 || s.closeCause === 2;
        return (
          <div key={s.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text">{s.name}</span>
                {warn ? (
                  <StatusGlyph status={full ? 'critical' : 'warning'} showLabel={false} />
                ) : null}
              </div>
              <span className="font-mono text-[11px] text-text-2">
                {pct.toFixed(0)}% · {Math.round(s.dailyVolumeUsedL).toLocaleString()} /{' '}
                {Math.round(s.dailyQuotaLimitL).toLocaleString()} L
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-btn border border-border bg-bg">
              <div
                className={[
                  'h-full transition-[width] duration-300',
                  full ? 'hazard-bg' : warn ? 'bg-accent' : 'bg-text',
                ].join(' ')}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {full ? (
              <p className="text-[10px] uppercase tracking-label text-accent">Quota Exceeded</p>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
