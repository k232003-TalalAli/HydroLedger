import type { Alert } from '@hydroledger/shared';

interface CriticalBannerProps {
  alert: Alert | null;
  onAction?: () => void;
  actionLabel?: string;
}

export function CriticalBanner({
  alert,
  onAction,
  actionLabel = 'Isolate segment',
}: CriticalBannerProps) {
  if (!alert || alert.status !== 'active' || alert.severity !== 'critical') return null;

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-accent bg-accent px-4 py-2 text-accent-ink"
      role="alert"
      aria-live="assertive"
    >
      <span className="font-sans text-[11px] font-bold uppercase tracking-label">Critical</span>
      <p className="flex-1 text-sm">
        {alert.reason === 'ANOMALY_DETECTED'
          ? `Leak anomaly (${alert.sectorId}). ${alert.txHash ? 'Logged on-chain.' : 'Pending / local.'}`
          : alert.title}
      </p>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-8 items-center rounded-btn border border-accent-ink bg-accent-ink px-3 font-sans text-xs font-medium text-accent hover:bg-black"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
