import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SectorId } from '@hydroledger/shared';
import {
  getLiveCitizenSnapshot,
  getLiveSnapshot,
  liveOpenValve,
  setLiveSelectedSector,
  startLiveStore,
  subscribeLive,
} from './liveStore';
import { useSessionStore } from '@/store/session';

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  citizen: ['citizen'] as const,
};

export function useDashboardSync(): void {
  const qc = useQueryClient();
  const setActiveAlertCount = useSessionStore((s) => s.setActiveAlertCount);
  const setNetwork = useSessionStore((s) => s.setNetwork);

  useEffect(() => {
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
  }, [qc, setActiveAlertCount, setNetwork]);
}

export function useDashboard() {
  useDashboardSync();
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => getLiveSnapshot(),
    staleTime: Infinity,
  });
}

export function useCitizenDashboard() {
  useDashboardSync();
  return useQuery({
    queryKey: queryKeys.citizen,
    queryFn: () => getLiveCitizenSnapshot(),
    staleTime: Infinity,
  });
}

/** Live dashboard actions. Valve status is chain-only; Open publishes MQTT for aggregator re-arm. */
export function useDashboardActions() {
  return {
    openValve: (sectorId: SectorId) => {
      liveOpenValve(sectorId);
    },
    selectSector: (id: SectorId) => setLiveSelectedSector(id),
  };
}
