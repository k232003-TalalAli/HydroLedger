/** ABIs matching backend middleware/aggregator.js (human-readable). */

export const REGISTRY_ABI = [
  'function sectorRegistry(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit, bool isValveClosed, uint256 lastUpdated)',
  'function closeCause(bytes32) view returns (uint8)',
  'function leakThreshold() view returns (uint256)',
  'function dayOffsetSeconds() view returns (uint256)',
  'function dayLengthSeconds() view returns (uint256)',
  'function manualDayShift() view returns (uint256)',
  'function sectorExists(bytes32) view returns (bool)',
  'event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp)',
  'event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp)',
  'event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp)',
  'event QuotaChanged(bytes32 indexed sectorId, uint256 oldQuota, uint256 newQuota, uint256 timestamp)',
  'event LeakThresholdChanged(uint256 oldValue, uint256 newValue)',
] as const;

export const TELEMETRY_ABI = [
  'function latestSnapshot(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)',
  'function snapshotCount(bytes32) view returns (uint256)',
  'event SnapshotRecorded(bytes32 indexed sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)',
] as const;
