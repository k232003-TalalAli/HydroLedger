import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hazard?: boolean;
  critical?: boolean;
  padded?: boolean;
}

export function Card({
  children,
  hazard = false,
  critical = false,
  padded = true,
  className = '',
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        'rounded-card border border-border bg-surface',
        padded ? 'p-4' : '',
        hazard ? 'border-2 border-accent hazard-edge' : '',
        critical ? 'animate-pulse-critical border-accent' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
