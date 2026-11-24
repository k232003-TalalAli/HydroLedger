/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK: string;
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_CHAIN_ID: string;
  readonly VITE_CHAIN_NAME: string;
  readonly VITE_RPC_URL: string;
  readonly VITE_REGISTRY_ADDRESS: string;
  readonly VITE_TELEMETRY_ADDRESS: string;
  readonly VITE_BRIDGE_WS_URL: string;
  readonly VITE_CONTRACT_ADDRESS: string;
  readonly VITE_DEV_ROLE_SWITCHER: string;
  /** This laptop's sector for live MQTT (e.g. Sector_C). */
  readonly VITE_LOCAL_SECTOR_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
