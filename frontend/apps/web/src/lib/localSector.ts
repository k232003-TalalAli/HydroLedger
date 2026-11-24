import { SECTOR_IDS, type SectorId } from '@hydroledger/shared';

/** This laptop's sector (MQTT is local). Override with VITE_LOCAL_SECTOR_ID. */
export function localSectorId(fallback: SectorId = 'Sector_C'): SectorId {
  const raw = (import.meta.env.VITE_LOCAL_SECTOR_ID || '').trim();
  if ((SECTOR_IDS as readonly string[]).includes(raw)) return raw as SectorId;
  return fallback;
}
