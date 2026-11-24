import { describe, expect, it } from 'vitest';
import { formatLpm, formatPercent, formatRelativeTime, truncateHash } from './format';

describe('format helpers', () => {
  it('formats L/min to one decimal', () => {
    expect(formatLpm(42.56)).toBe('42.6');
  });

  it('truncates hashes', () => {
    expect(truncateHash('0x9f3a12abc21e')).toBe('0x9f3a…c21e');
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(formatRelativeTime('2026-11-13T11:59:40Z', now)).toBe('20s ago');
  });

  it('formats percent', () => {
    expect(formatPercent(0.93)).toBe('93%');
  });
});
