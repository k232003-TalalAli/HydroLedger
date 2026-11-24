/**
 * Offline mock aligned with backend sector model (Sector_A/B/C + Upstream_Master).
 */
import {
  DEFAULT_LEAK_THRESHOLD_LPM,
  SECTOR_IDS,
  sectorLabel,
  type Alert,
  type AuditEvent,
  type CitizenSnapshot,
  type CloseCause,
  type DashboardSnapshot,
  type FlowSample,
  type SectorId,
  type SectorStateView,
  type TelemetrySnapshot,
} from '@hydroledger/shared';

export type Scenario = 'healthy' | 'leak' | 'quota-surge' | 'node-drop';
export const SCENARIOS: Scenario[] = ['healthy', 'leak', 'quota-surge', 'node-drop'];

function iso(d = new Date()): string {
  return d.toISOString();
}

function noise(amp = 0.15): number {
  return (Math.random() * 2 - 1) * amp;
}

interface EngineState {
  scenario: Scenario;
  selectedSectorId: SectorId;
  sectors: SectorStateView[];
  alerts: Alert[];
  events: AuditEvent[];
  snapshots: TelemetrySnapshot[];
  flowSeries: FlowSample[];
  leakThreshold: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

function buildSectors(scenario: Scenario): SectorStateView[] {
  const up = 20 + noise();
  return SECTOR_IDS.map((id, i) => {
    const isLeak = scenario === 'leak' && id === 'Sector_B';
    const isQuota = scenario === 'quota-surge' && id === 'Sector_C';
    const isStale = scenario === 'node-drop' && id === 'Sector_A';
    const down = isLeak ? 2 + noise(0.2) : up + noise(0.2);
    const delta = Math.max(0, up - down);
    const quota = 5000;
    const used = isQuota ? 4800 : 1200 + i * 400;
    const closed = isLeak || isQuota;
    const cause: CloseCause = isLeak ? 1 : isQuota ? 2 : 0;
    return {
      id,
      name: sectorLabel(id),
      upstreamFlowLpm: up,
      downstreamFlowLpm: Math.max(0, down),
      deltaQLpm: delta,
      dailyVolumeUsedL: used,
      dailyQuotaLimitL: quota,
      isValveClosed: closed,
      closeCause: cause,
      lastUpdated: iso(),
      status: isStale ? 'stale' : 'online',
      lastSeenAt: isStale ? new Date(Date.now() - 38_000).toISOString() : iso(),
    };
  });
}

function buildAlerts(sectors: SectorStateView[], threshold: number): Alert[] {
  const alerts: Alert[] = [];
  for (const s of sectors) {
    if (s.closeCause === 1) {
      alerts.push({
        id: `mock-leak-${s.id}`,
        reason: 'ANOMALY_DETECTED',
        severity: 'critical',
        title: `ANOMALY_DETECTED · ${s.id}`,
        sectorId: s.id,
        measuredDeltaQ: s.deltaQLpm,
        leakThreshold: threshold,
        detectedAt: iso(new Date(Date.now() - 2100)),
        status: 'active',
        txHash: '0xmockleak000000000000000000000000000000000000000000000000000001',
        blockNumber: 100,
      });
    }
    if (s.closeCause === 2) {
      alerts.push({
        id: `mock-quota-${s.id}`,
        reason: 'QUOTA_EXCEEDED',
        severity: 'warning',
        title: `QUOTA_EXCEEDED · ${s.id}`,
        sectorId: s.id,
        detectedAt: iso(new Date(Date.now() - 60_000)),
        status: 'active',
        txHash: null,
        blockNumber: null,
      });
    }
  }
  return alerts;
}

function createInitial(scenario: Scenario): Omit<EngineState, 'listeners' | 'timer'> {
  const sectors = buildSectors(scenario);
  const threshold = DEFAULT_LEAK_THRESHOLD_LPM;
  const alerts = buildAlerts(sectors, threshold);
  const events: AuditEvent[] = alerts.map((a, i) => ({
    id: `e-${i}`,
    name: 'SectorAlert' as const,
    txHash: a.txHash,
    blockNumber: a.blockNumber,
    ts: a.detectedAt,
    payload: a.reason,
    sectorId: a.sectorId,
  }));
  const snapshots: TelemetrySnapshot[] = sectors.map((s) => ({
    sectorId: s.id,
    upstreamFlowLpm: s.upstreamFlowLpm,
    downstreamFlowLpm: s.downstreamFlowLpm,
    deltaQLpm: s.deltaQLpm,
    dailyVolumeUsedL: s.dailyVolumeUsedL,
    timestamp: iso(),
    count: 3,
  }));
  const flowSeries: FlowSample[] = [];
  const now = Date.now();
  const b = sectors.find((s) => s.id === 'Sector_B')!;
  for (let i = 60; i >= 0; i--) {
    flowSeries.push({
      ts: now - i * 2000,
      upstream: b.upstreamFlowLpm + noise(0.3),
      downstream: b.downstreamFlowLpm + noise(0.3),
      sectorId: 'Sector_B',
    });
  }
  return {
    scenario,
    selectedSectorId: 'Sector_B',
    sectors,
    alerts,
    events,
    snapshots,
    flowSeries,
    leakThreshold: threshold,
  };
}

class MockEngine {
  private state: EngineState;

  constructor(scenario: Scenario) {
    const init = createInitial(scenario);
    this.state = { ...init, listeners: new Set(), timer: null };
  }

  start(): void {
    if (this.state.timer) return;
    this.state.timer = setInterval(() => this.tick(), 2000);
  }

  stop(): void {
    if (this.state.timer) {
      clearInterval(this.state.timer);
      this.state.timer = null;
    }
  }

  subscribe(fn: () => void): () => void {
    this.state.listeners.add(fn);
    return () => this.state.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.state.listeners) fn();
  }

  getScenario(): Scenario {
    return this.state.scenario;
  }

  setScenario(scenario: Scenario): void {
    const { listeners, timer } = this.state;
    const init = createInitial(scenario);
    this.state = { ...init, listeners, timer };
    this.emit();
  }

  setSelectedSector(id: SectorId): void {
    this.state.selectedSectorId = id;
    this.emit();
  }

  acknowledgeAlert(id: string): void {
    const a = this.state.alerts.find((x) => x.id === id);
    if (a) {
      a.status = 'acknowledged';
      this.emit();
    }
  }

  closeValve(sectorId: SectorId, reason: 'ANOMALY_DETECTED' | 'QUOTA_EXCEEDED' = 'ANOMALY_DETECTED'): void {
    const s = this.state.sectors.find((x) => x.id === sectorId);
    if (!s) return;
    s.isValveClosed = true;
    s.closeCause = reason === 'ANOMALY_DETECTED' ? 1 : 2;
    this.state.events.unshift({
      id: `mqtt-close-${Date.now()}`,
      name: 'ValveCloseMqtt',
      txHash: null,
      blockNumber: null,
      ts: iso(),
      payload: `CLOSE_VALVE ${reason}`,
      sectorId,
    });
    this.state.alerts = buildAlerts(this.state.sectors, this.state.leakThreshold);
    this.emit();
  }

  openValve(sectorId: SectorId): void {
    const s = this.state.sectors.find((x) => x.id === sectorId);
    if (!s) return;
    s.isValveClosed = false;
    s.closeCause = 0;
    this.state.events.unshift({
      id: `mqtt-open-${Date.now()}`,
      name: 'ValveOpenMqtt',
      txHash: null,
      blockNumber: null,
      ts: iso(),
      payload: 'OPEN_VALVE',
      sectorId,
    });
    this.state.alerts = buildAlerts(this.state.sectors, this.state.leakThreshold);
    this.emit();
  }

  getSnapshot(): DashboardSnapshot {
    const online = this.state.sectors.filter((s) => s.status === 'online').length;
    const closed = this.state.sectors.filter((s) => s.isValveClosed).length;
    const active = this.state.alerts.filter((a) => a.status === 'active');
    const up = this.state.sectors.reduce((n, s) => n + s.upstreamFlowLpm, 0) / this.state.sectors.length;
    const down = this.state.sectors.reduce((n, s) => n + s.downstreamFlowLpm, 0);
    const dq = this.state.sectors.reduce((n, s) => n + s.deltaQLpm, 0);
    return {
      syncedAt: iso(),
      mode: 'mock',
      bridgeConnected: true,
      chainConnected: true,
      kpis: {
        totalUpstreamLpm: up,
        totalDownstreamLpm: down,
        totalDeltaQLpm: dq,
        activeAlerts: active.length,
        criticalAlerts: active.filter((a) => a.severity === 'critical').length,
        warningAlerts: active.filter((a) => a.severity === 'warning').length,
        valvesClosed: closed,
        sectorsOnline: online,
        sectorsTotal: this.state.sectors.length,
        leakThresholdLpm: this.state.leakThreshold,
      },
      sectors: this.state.sectors.map((s) => ({ ...s })),
      alerts: this.state.alerts.map((a) => ({ ...a })),
      events: this.state.events.map((e) => ({ ...e })),
      snapshots: this.state.snapshots.map((s) => ({ ...s })),
      flowSeries: this.state.flowSeries.map((f) => ({ ...f })),
      chain: {
        leakThresholdLpm: this.state.leakThreshold,
        dayLengthSeconds: 600,
        dayOffsetSeconds: 0,
        chainId: 1338,
        blockNumber: 1204,
        registryAddress: '0xmock',
        telemetryAddress: '0xmock',
      },
      selectedSectorId: this.state.selectedSectorId,
    };
  }

  getCitizenSnapshot(): CitizenSnapshot {
    const dash = this.getSnapshot();
    const mine = dash.sectors.find((s) => s.id === 'Sector_C') ?? dash.sectors[0]!;
    const pct = (mine.dailyVolumeUsedL / mine.dailyQuotaLimitL) * 100;
    const critical = dash.alerts.some((a) => a.severity === 'critical' && a.status === 'active');
    return {
      syncedAt: dash.syncedAt,
      headline: critical ? 'One repair in progress.' : 'Supply is running.',
      subhead: critical
        ? 'A leak anomaly was flagged on the network.'
        : 'Sectors within leak threshold.',
      mySectorId: mine.id,
      mySectorName: mine.name,
      mySectorStatus: mine.isValveClosed ? 'outage' : pct >= 90 ? 'reduced' : 'normal',
      valveClosed: mine.isValveClosed,
      quotaUsedPercent: pct,
      waterSuppliedTodayL: dash.sectors.reduce((n, s) => n + s.dailyVolumeUsedL, 0),
      sensorsOnline: `${dash.kpis.sectorsOnline}/${dash.kpis.sectorsTotal}`,
      quotas: dash.sectors.map((s) => ({
        id: s.id,
        name: s.name,
        usedPercent: (s.dailyVolumeUsedL / s.dailyQuotaLimitL) * 100,
        isMine: s.id === mine.id,
      })),
      incidents: dash.alerts.slice(0, 5).map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        when: a.detectedAt,
        state: a.status === 'resolved' ? 'CLOSED' : 'OPEN',
      })),
      verifyHint: {
        sectorId: mine.id,
        upstreamFlowLpm: mine.upstreamFlowLpm,
        deltaQLpm: mine.deltaQLpm,
        lastUpdated: mine.lastUpdated,
      },
    };
  }

  private tick(): void {
    const up = 20 + noise();
    for (const s of this.state.sectors) {
      if (s.status === 'stale') continue;
      const isLeak = this.state.scenario === 'leak' && s.id === 'Sector_B' && !s.isValveClosed;
      const down = isLeak ? 2 + noise(0.2) : up + noise(0.2);
      s.upstreamFlowLpm = up;
      s.downstreamFlowLpm = Math.max(0, down);
      s.deltaQLpm = Math.max(0, up - s.downstreamFlowLpm);
      s.lastUpdated = iso();
      s.lastSeenAt = iso();
      if (this.state.scenario === 'leak' && s.id === 'Sector_B' && s.deltaQLpm > this.state.leakThreshold) {
        s.isValveClosed = true;
        s.closeCause = 1;
      }
    }
    this.state.alerts = buildAlerts(this.state.sectors, this.state.leakThreshold);
    const b = this.state.sectors.find((s) => s.id === 'Sector_B');
    if (b) {
      this.state.flowSeries.push({
        ts: Date.now(),
        upstream: b.upstreamFlowLpm,
        downstream: b.downstreamFlowLpm,
        sectorId: 'Sector_B',
      });
      if (this.state.flowSeries.length > 90) this.state.flowSeries.shift();
    }
    this.emit();
  }
}

let engine: MockEngine | null = null;

function parseScenario(raw: string | null | undefined): Scenario {
  if (raw && (SCENARIOS as string[]).includes(raw)) return raw as Scenario;
  return 'leak';
}

export function getMockEngine(): MockEngine {
  if (!engine) {
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    engine = new MockEngine(parseScenario(params?.get('scenario')));
    engine.start();
  }
  return engine;
}
