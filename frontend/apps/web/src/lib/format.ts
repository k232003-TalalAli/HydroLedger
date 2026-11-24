/** Formatting helpers — numbers, hashes, relative time. */

export function formatLpm(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function truncateHash(hash: string, left = 6, right = 4): string {
  if (hash.length <= left + right + 1) return hash;
  return `${hash.slice(0, left)}…${hash.slice(-right)}`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diffSec = Math.round((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diffSec)) return '—';
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
