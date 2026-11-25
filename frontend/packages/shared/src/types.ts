/** Domain types aligned with backend MQTT + WaterQuotaRegistry / WaterTelemetryLog. */

export const SECTOR_IDS = ['Sector_A', 'Sector_B', 'Sector_C'] as const;
export type SectorId = (typeof SECTOR_IDS)[number];

export const UPSTREAM_NODE_ID = 'Upstream_Master' as const;

/** 0 none, 1 leak (ANOMALY_DETECTED), 2 quota (QUOTA_EXCEEDED) — matches contract. */
export type CloseCause = 0 | 1 | 2;

export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type SectorAlertReason = 'ANOMALY_DETECTED' | 'QUOTA_EXCEEDED';

export interface SectorStateView {
  id: SectorId;
  name: string;
  upstreamFlowLpm: number;
  downstreamFlowLpm: number;
  deltaQLpm: number;
  dailyVolumeUsedL: number;
  dailyQuotaLimitL: number;
  isValveClosed: boolean;
  closeCause: CloseCause;
  lastUpdated: string | null;
  /** MQTT freshness for this sector's downstream node. */
  status: 'online' | 'stale' | 'offline';
  lastSeenAt: string | null;
}

export interface Alert {
  id: string;
  reason: SectorAlertReason | 'SENSOR_STALE' | string;
  severity: AlertSeverity;
  title: string;
  sectorId: SectorId;
  measuredDeltaQ?: number;
  leakThreshold?: number;
  detectedAt: string;
  status: AlertStatus;
  txHash: string | null;
  blockNumber: number | null;
}

export interface TelemetrySnapshot {
  sectorId: SectorId;
  upstreamFlowLpm: number;
  downstreamFlowLpm: number;
  deltaQLpm: number;
  dailyVolumeUsedL: number;
  timestamp: string | null;
  count: number;
}

export type AuditEventName =
  | 'SectorAlert'
  | 'SnapshotRecorded'
  | 'SectorReset'
  | 'DailyRollover'
  | 'QuotaChanged'
  | 'LeakThresholdChanged'
  | 'ValveCloseMqtt'
  | 'ValveOpenMqtt';

export interface AuditEvent {
  id: string;
  name: AuditEventName;
  txHash: string | null;
  blockNumber: number | null;
  ts: string;
  payload: string;
  sectorId?: SectorId;
}

export interface FlowSample {
  ts: number;
  upstream: number;
  downstream: number;
  sectorId?: SectorId;
}

export interface OverviewKpis {
  totalUpstreamLpm: number;
  totalDownstreamLpm: number;
  totalDeltaQLpm: number;
  activeAlerts: number;
  criticalAlerts: number;
  warningAlerts: number;
  valvesClosed: number;
  sectorsOnline: number;
  sectorsTotal: number;
  leakThresholdLpm: number;
}

export interface ChainConfigView {
  leakThresholdLpm: number;
  dayLengthSeconds: number;
  dayOffsetSeconds: number;
  chainId: number;
  blockNumber: number | null;
  registryAddress: string;
  telemetryAddress: string;
}

/** Operator/admin dashboard snapshot (backend-shaped). */
export interface DashboardSnapshot {
  syncedAt: string;
  mode: 'live';
  bridgeConnected: boolean;
  chainConnected: boolean;
  kpis: OverviewKpis;
  sectors: SectorStateView[];
  alerts: Alert[];
  events: AuditEvent[];
  snapshots: TelemetrySnapshot[];
  flowSeries: FlowSample[];
  chain: ChainConfigView;
  selectedSectorId: SectorId;
  /** Local MQTT OPEN was sent but registry still shows closed (awaiting Laptop A owner-reset). */
  awaitingOwnerReset: boolean;
}

/** Citizen-reduced DTO — no valve actuation / operator controls. */
export interface CitizenSnapshot {
  syncedAt: string;
  headline: string;
  subhead: string;
  mySectorId: SectorId;
  mySectorName: string;
  mySectorStatus: 'normal' | 'reduced' | 'outage';
  valveClosed: boolean;
  quotaUsedPercent: number;
  waterSuppliedTodayL: number;
  sensorsOnline: string;
  quotas: Array<{ id: SectorId; name: string; usedPercent: number; isMine: boolean }>;
  incidents: Array<{
    id: string;
    severity: AlertSeverity;
    title: string;
    when: string;
    state: 'OPEN' | 'CLOSED';
  }>;
  verifyHint: {
    sectorId: SectorId;
    upstreamFlowLpm: number;
    deltaQLpm: number;
    lastUpdated: string | null;
  };
}

/** MQTT payloads (backend topics). */
export interface SensorFlowMessage {
  node_id: string;
  flow_rate: number;
}

export interface ValveActuationMessage {
  command: 'CLOSE_VALVE' | 'OPEN_VALVE';
  reason?: string;
}
