import { describe, expect, it } from 'vitest';
import { fromChain, toChain, closeCauseLabel } from './scale';

describe('chain scale', () => {
  it('round-trips ×100', () => {
    expect(fromChain(500)).toBe(5);
    expect(toChain(5)).toBe(500);
    expect(fromChain(2034n)).toBe(20.34);
  });

  it('labels close cause', () => {
    expect(closeCauseLabel(1)).toContain('ANOMALY');
    expect(closeCauseLabel(2)).toContain('QUOTA');
  });
});
