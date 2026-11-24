import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('mock engine (sector model)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('leak scenario closes Sector_B with ANOMALY_DETECTED', async () => {
    const { getMockEngine } = await import('./engine');
    const eng = getMockEngine();
    eng.setScenario('leak');
    const snap = eng.getSnapshot();
    const b = snap.sectors.find((s) => s.id === 'Sector_B');
    expect(b?.isValveClosed).toBe(true);
    expect(b?.closeCause).toBe(1);
    const leak = snap.alerts.find((a) => a.reason === 'ANOMALY_DETECTED');
    expect(leak?.severity).toBe('critical');
  });

  it('citizen snapshot has no wallet secrets', async () => {
    const { getMockEngine } = await import('./engine');
    const { assertNoOperatorFields } = await import('@hydroledger/shared');
    const citizen = getMockEngine().getCitizenSnapshot();
    expect(() => assertNoOperatorFields(citizen)).not.toThrow();
  });
});
