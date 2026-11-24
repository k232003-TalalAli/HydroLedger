import { t, type MessageKey } from '@/lib/i18n';

export type StatusKind = 'normal' | 'warning' | 'critical' | 'offline' | 'stale';

interface StatusGlyphProps {
  status: StatusKind;
  label?: string;
  showLabel?: boolean;
  className?: string;
}

const LABEL_KEY: Record<StatusKind, MessageKey> = {
  normal: 'status.normal',
  warning: 'status.warning',
  critical: 'status.critical',
  offline: 'status.offline',
  stale: 'status.stale',
};

export function StatusGlyph({ status, label, showLabel = true, className = '' }: StatusGlyphProps) {
  const text = label ?? t(LABEL_KEY[status]);
  const aria = text;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="img" aria-label={aria}>
      <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center">
        {status === 'normal' && <span className="block h-3 w-3 rounded-full border border-text" />}
        {status === 'warning' && (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 fill-accent" aria-hidden>
            <polygon points="6,1 11,11 1,11" />
          </svg>
        )}
        {status === 'critical' && (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
            <polygon
              points="6,1 11,6 6,11 1,6"
              fill="#FFC400"
              stroke="#0A0A0A"
              strokeWidth="0.75"
            />
          </svg>
        )}
        {(status === 'offline' || status === 'stale') && (
          <span className="font-mono text-[11px] leading-none text-text-2">×</span>
        )}
      </span>
      {showLabel ? <span className="text-xs text-text-2">{text}</span> : null}
    </span>
  );
}
