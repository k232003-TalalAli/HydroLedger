import type { Role } from '@hydroledger/shared';
import { create } from 'zustand';

export type NetworkHealth = 'connected' | 'lagging' | 'unreachable';

interface SessionState {
  role: Role;
  walletAddress: string | null;
  chainName: string;
  blockNumber: number | null;
  networkHealth: NetworkHealth;
  activeAlertCount: number;
  setRole: (role: Role) => void;
  setWalletAddress: (address: string | null) => void;
  setNetwork: (
    partial: Partial<Pick<SessionState, 'chainName' | 'blockNumber' | 'networkHealth'>>,
  ) => void;
  setActiveAlertCount: (count: number) => void;
}

const chainName = import.meta.env.VITE_CHAIN_NAME ?? 'Besu 1338';

export const useSessionStore = create<SessionState>((set) => ({
  role: 'operator',
  walletAddress: null,
  chainName,
  blockNumber: 1_842_901,
  networkHealth: 'connected',
  activeAlertCount: 0,
  setRole: (role) => set({ role }),
  setWalletAddress: (walletAddress) => set({ walletAddress }),
  setNetwork: (partial) => set(partial),
  setActiveAlertCount: (activeAlertCount) => set({ activeAlertCount }),
}));

export const isDevRoleSwitcherEnabled = (): boolean =>
  import.meta.env.VITE_DEV_ROLE_SWITCHER === 'true';
