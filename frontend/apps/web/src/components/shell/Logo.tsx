export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="shrink-0 text-accent"
      >
        {/* Droplet + chain-link mark */}
        <path
          fill="currentColor"
          d="M12 2.5c0 0-5.5 6.2-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 8.7 12 2.5 12 2.5z"
        />
        <path
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="1.4"
          d="M10.2 12.2a2.2 2.2 0 0 1 3.1 0l.5.5a2.2 2.2 0 0 1 0 3.1"
        />
        <path
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="1.4"
          d="M13.8 14.8a2.2 2.2 0 0 1-3.1 0l-.5-.5a2.2 2.2 0 0 1 0-3.1"
        />
      </svg>
      {!compact ? (
        <span className="font-sans text-sm font-bold tracking-[0.14em] text-text">HYDROLEDGER</span>
      ) : null}
    </div>
  );
}
