import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SectorId } from '@hydroledger/shared';
import { getMockEngine, SCENARIOS, type Scenario } from '@/mocks/engine';
import {
  getLiveCitizenSnapshot,
  getLiveSnapshot,
  liveCloseValve,
  liveOpenValve,
  setLiveSelectedSector,
  startLiveStore,
  subscribeLive,
} from './liveStore';
import { useSessionStore } from '@/store/session';
import { publishValve } from '@/lib/bridge';

export { SCENARIOS, type Scenario };

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  citizen: ['citizen'] as const,
};

/** Mock unless explicitly set to false (safer default when env file is missing). */
export function useMockMode(): boolean {
  return import.meta.env.VITE_USE_MOCK !== 'false';
}

export function useDashboardSync(): void {
  const qc = useQueryClient();
  const mock = useMockMode();
  const setActiveAlertCount = useSessionStore((s) => s.setActiveAlertCount);
  const setNetwork = useSessionStore((s) => s.setNetwork);

  useEffect(() => {
    if (mock) {
      const eng = getMockEngine();
      const push = () => {
        const snap = eng.getSnapshot();
        qc.setQueryData(queryKeys.dashboard, snap);
        qc.setQueryData(queryKeys.citizen, eng.getCitizenSnapshot());
        setActiveAlertCount(snap.kpis.activeAlerts);
        if (snap.chain.blockNumber != null) {
          setNetwork({
            blockNumber: snap.chain.blockNumber,
            networkHealth: 'connected',
            chainName: 'Mock Besu',
          });
        }
      };
      push();
      return eng.subscribe(push);
    }

    const push = () => {
      const snap = getLiveSnapshot();
      qc.setQueryData(queryKeys.dashboard, snap);
      qc.setQueryData(queryKeys.citizen, getLiveCitizenSnapshot());
      setActiveAlertCount(snap.kpis.activeAlerts);
      setNetwork({
        blockNumber: snap.chain.blockNumber,
        networkHealth: snap.chainConnected ? 'connected' : 'unreachable',
        chainName: `Besu ${snap.chain.chainId}`,
      });
    };
    // Subscribe first so the initial chain poll emit is not missed (Strict Mode safe).
    const unsub = subscribeLive(push);
    startLiveStore();
    push();
    return unsub;
  }, [mock, qc, setActiveAlertCount, setNetwork]);
}

export function useDashboard() {
  useDashboardSync();
  const mock = useMockMode();
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => (mock ? getMockEngine().getSnapshot() : getLiveSnapshot()),
    staleTime: Infinity,
  });
}

export function useCitizenDashboard() {
  useDashboardSync();
  const mock = useMockMode();
  return useQuery({
    queryKey: queryKeys.citizen,
    queryFn: () => (mock ? getMockEngine().getCitizenSnapshot() : getLiveCitizenSnapshot()),
    staleTime: Infinity,
  });
}

export function useScenarioControls() {
  const qc = useQueryClient();
  const mock = useMockMode();

  if (mock) {
    const eng = getMockEngine();
    return {
      mock: true as const,
      scenario: eng.getScenario(),
      setScenario: (s: Scenario) => {
        eng.setScenario(s);
        qc.setQueryData(queryKeys.dashboard, eng.getSnapshot());
        qc.setQueryData(queryKeys.citizen, eng.getCitizenSnapshot());
      },
      acknowledgeAlert: (id: string) => eng.acknowledgeAlert(id),
      closeValve: (sectorId: SectorId) => eng.closeValve(sectorId),
      openValve: (sectorId: SectorId) => eng.openValve(sectorId),
      selectSector: (id: SectorId) => eng.setSelectedSector(id),
    };
  }

  return {
    mock: false as const,
    scenario: 'live' as const,
    setScenario: (scenario: Scenario) => {
      void scenario;
    },
    acknowledgeAlert: (alertId: string) => {
      void alertId;
    },
    closeValve: (sectorId: SectorId) => {
      liveCloseValve(sectorId);
      publishValve({ command: 'CLOSE_VALVE', reason: 'ANOMALY_DETECTED' });
    },
    openValve: (sectorId: SectorId) => {
      liveOpenValve(sectorId);
    },
    selectSector: (id: SectorId) => setLiveSelectedSector(id),
  };
}
