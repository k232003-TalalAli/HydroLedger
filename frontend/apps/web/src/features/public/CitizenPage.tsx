import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Logo } from '@/components/shell/Logo';
import { Button, Card, Chip, Skeleton, StatusGlyph } from '@/components/ui';
import { VerifyModal } from '@/features/ledger/VerifyModal';
import { useCitizenDashboard } from '@/data/hooks';
import { formatRelativeTime } from '@/lib/format';

export function CitizenPage() {
  const { data, isLoading } = useCitizenDashboard();
  const [verifyOpen, setVerifyOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-bg pb-24">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <Logo />
        <Chip>Public view</Chip>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-sans text-sm font-medium uppercase tracking-label">
            Water network status
          </h1>
          <p className="font-mono text-[11px] text-text-2">
            Updated {formatRelativeTime(data.syncedAt)}
          </p>
        </div>

        <Card className="space-y-3">
          <p className="text-lg text-text">{data.headline}</p>
          <p className="text-sm text-text-2">{data.subhead}</p>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="label-caps text-text">Your sector</h2>
            <Chip accent>{data.mySectorName}</Chip>
          </div>
          <StatusGlyph
            status={
              data.mySectorStatus === 'outage'
                ? 'critical'
                : data.mySectorStatus === 'reduced'
                  ? 'warning'
                  : 'normal'
            }
            label={
              data.valveClosed
                ? 'Valve closed'
                : data.mySectorStatus === 'reduced'
                  ? 'Reduced supply'
                  : 'Normal supply'
            }
          />
          <p className="font-mono text-3xl font-bold text-text">
            {data.quotaUsedPercent.toFixed(0)}%
          </p>
          <p className="text-xs text-text-2">Today&apos;s quota used</p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <p className="label-caps">Water supplied today</p>
            <p className="mt-2 font-mono text-2xl font-bold">
              {Math.round(data.waterSuppliedTodayL).toLocaleString()}
            </p>
            <p className="text-xs text-text-2">litres</p>
          </Card>
          <Card>
            <p className="label-caps">Sensors / sectors</p>
            <p className="mt-2 font-mono text-2xl font-bold">{data.sensorsOnline}</p>
          </Card>
        </div>

        <Card className="space-y-3">
          <h2 className="label-caps text-text">Fair share by sector</h2>
          {data.quotas.map((q) => (
            <div key={q.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>
                  {q.isMine ? '▲ ' : ''}
                  {q.name}
                  {q.isMine ? ' (yours)' : ''}
                </span>
                <span className="font-mono text-text-2">{q.usedPercent.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-btn border border-border bg-bg">
                <div
                  className={`h-full ${q.usedPercent >= 90 ? 'bg-accent' : 'bg-text'}`}
                  style={{ width: `${Math.min(100, q.usedPercent)}%` }}
                />
              </div>
            </div>
          ))}
        </Card>

        <Card className="space-y-3">
          <h2 className="label-caps text-text">Recent incidents</h2>
          <ul className="space-y-3">
            {data.incidents.map((inc) => (
              <li
                key={inc.id}
                className="flex items-start justify-between gap-2 border-b border-border pb-2"
              >
                <div>
                  <p className="text-sm text-text">
                    {inc.severity === 'critical' ? '◆ ' : '▲ '}
                    {inc.title}
                  </p>
                  <p className="font-mono text-[10px] text-text-2">
                    {formatRelativeTime(inc.when)}
                  </p>
                </div>
                <Chip accent={inc.state === 'OPEN'}>{inc.state}</Chip>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3">
          <h2 className="label-caps text-text">Don&apos;t just trust us. Verify.</h2>
          <p className="text-sm text-text-2">
            {data.verifyHint.sectorId} · ΔQ {data.verifyHint.deltaQLpm.toFixed(2)} L/min
          </p>
          <Button variant="outline" size="sm" onClick={() => setVerifyOpen(true)}>
            Verify on-chain
          </Button>
        </Card>

        <p className="text-center text-xs text-text-2">
          Operator dashboard ·{' '}
          <Link to="/" className="text-accent underline">
            Open
          </Link>
        </p>
      </main>

      <VerifyModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        defaultSectorId={data.verifyHint.sectorId}
      />
    </div>
  );
}
