import type { SectorId } from './types';
import { SECTOR_IDS } from './types';

/** Chain stores flows/volumes as integers ×100 (see aggregator scale()). */
export const CHAIN_SCALE = 100;

export const DEFAULT_LEAK_THRESHOLD_LPM = 5.0;
export const DEFAULT_DAILY_QUOTA_L = 5000;
export const NODE_STALE_SEC = 10;
/** Remote sectors (chain/telemetry only): treat flows as gone after this ( > typical 4 min snapshot). */
export const REMOTE_FLOW_STALE_SEC = 5 * 60;
export const EVAL_INTERVAL_SEC = 2;
export const BREACH_CONSECUTIVE = 2;
/** Demo quota "day" length on deployed contracts. */
export const DEFAULT_DAY_LENGTH_SECONDS = 600;
export const DEFAULT_CHAIN_ID = 1338;

export const MQTT_TOPIC_SENSOR_FLOW = 'sensor/flow';
export const MQTT_TOPIC_ACTUATION_VALVE = 'actuation/valve';

export const DEFAULT_REGISTRY_ADDRESS = '0xADc48A06940CB4F9066d66891170BE573b47453B';
export const DEFAULT_TELEMETRY_ADDRESS = '0x597aa018401944D9D36Eca15d1ae5b5a532ABe04';

export function sectorLabel(id: SectorId): string {
  return id.replace('_', ' ');
}

export function allSectorIds(): readonly SectorId[] {
  return SECTOR_IDS;
}

/** encodeBytes32String(sectorId) as used on-chain — for display only; ethers does this live. */
export const SECTOR_BYTES32: Record<SectorId, string> = {
  Sector_A: '0x536563746f725f41000000000000000000000000000000000000000000000000',
  Sector_B: '0x536563746f725f42000000000000000000000000000000000000000000000000',
  Sector_C: '0x536563746f725f43000000000000000000000000000000000000000000000000',
};
