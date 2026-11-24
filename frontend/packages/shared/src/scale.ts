import { CHAIN_SCALE } from './constants';

/** Convert on-chain scaled uint (×100) to display float. */
export function fromChain(value: bigint | number | string): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / CHAIN_SCALE;
}

/** Convert display float to on-chain scaled integer (×100). */
export function toChain(value: number): number {
  return Math.round(value * CHAIN_SCALE);
}

export function closeCauseLabel(cause: 0 | 1 | 2): string {
  if (cause === 1) return 'leak (ANOMALY_DETECTED)';
  if (cause === 2) return 'quota (QUOTA_EXCEEDED)';
  return 'none';
}
