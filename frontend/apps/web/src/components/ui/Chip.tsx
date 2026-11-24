import type { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}

export function Chip({ children, accent = false, className = '' }: ChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-btn border px-2 py-0.5 font-mono text-[11px]',
        accent ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg text-text-2',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
