import {
  MQTT_TOPIC_ACTUATION_VALVE,
  MQTT_TOPIC_SENSOR_FLOW,
  SECTOR_IDS,
  sectorLabel,
  type CitizenSnapshot,
  type CloseCause,
  type DashboardSnapshot,
  type FlowSample,
  type SectorId,
  type SectorStateView,
} from '@hydroledger/shared';
import { parseSensorFlow, publishValve, subscribeBridge } from '@/lib/bridge';
import { readChainState } from '@/lib/chain';
import { localSectorId } from '@/lib/localSector';

type Listener = () => void;

interface LiveState {
  bridgeConnected: boolean;
  chainConnected: boolean;
  selectedSectorId: SectorId;
  sectors: SectorStateView[];
  flowSeries: FlowSample[];
  /** EMA values for the chart only (raw MQTT still drives KPIs). */
  chartUpstream: number;
  chartDownstream: number;
  mqttUpstream: number | null;
  lastChain: Awaited<ReturnType<typeof readChainState>> | null;
  listeners: Set<Listener>;
  pollTimer: ReturnType<typeof setInterval> | null;
  sampleTimer: ReturnType<typeof setInterval> | null;
  pollInFlight: boolean;
  /** Set after MQTT OPEN until chain shows valve open (hint only; status is chain). */
  mqttOpenPending: boolean;
  unsubBridge: (() => void) | null;
}

/** Chart sample rate — avoids sawtooth when Node-RED + leak script both publish. */
const CHART_SAMPLE_MS = 1000;
const CHART_EMA_ALPHA = 0.4;
const CHART_MAX_POINTS = 120;
/** How often the UI re-reads Besu (remote sectors have no local MQTT). */
const CHAIN_POLL_MS = 1000;

const state: LiveState = {
  bridgeConnected: false,
  chainConnected: false,
  selectedSectorId: localSectorId(),
  sectors: SECTOR_IDS.map((id) => ({
    id,
    name: sectorLabel(id),
    upstreamFlowLpm: 0,
    downstreamFlowLpm: 0,
    deltaQLpm: 0,
    dailyVolumeUsedL: 0,
    dailyQuotaLimitL: 5000,
    isValveClosed: false,
    closeCause: 0 as CloseCause,
    lastUpdated: null,
    status: 'offline',
    lastSeenAt: null,
  })),
  flowSeries: [],
  chartUpstream: 0,
  chartDownstream: 0,
  mqttUpstream: null,
  lastChain: null,
  listeners: new Set(),
  pollTimer: null,
  sampleTimer: null,
  pollInFlight: false,
  mqttOpenPending: false,
  unsubBridge: null,
};

function pushChartSample(upstream: number, downstream: number, sectorId: SectorId): void {
  state.flowSeries.push({
    ts: Date.now(),
    upstream,
    downstream,
    sectorId,
  });
  if (state.flowSeries.length > CHART_MAX_POINTS) state.flowSeries.shift();
}

function sampleChart(): void {
  const local = state.sectors.find((x) => x.id === localSectorId());
  if (!local) return;
  if (local.isValveClosed) {
    state.chartUpstream = 0;
    state.chartDownstream = 0;
    pushChartSample(0, 0, local.id);
    emit();
    return;
  }
  const a = CHART_EMA_ALPHA;
  state.chartUpstream = a * local.upstreamFlowLpm + (1 - a) * state.chartUpstream;
  state.chartDownstream = a * local.downstreamFlowLpm + (1 - a) * state.chartDownstream;
  pushChartSample(state.chartUpstream, state.chartDownstream, local.id);
  emit();
}

function emit(): void {
  for (const fn of state.listeners) fn();
}

function mergeChain(): void {
  const chain = state.lastChain;
  if (!chain) return;
  state.chainConnected = chain.connected;
  // Failed poll must not wipe MQTT/valve state with empty offline rows
  if (!chain.connected) return;
  for (const cs of chain.sectors) {
    const local = state.sectors.find((s) => s.id === cs.id);
    if (!local) continue;
    // Chain is authoritative for valve/quota/volume; MQTT can override live flows if fresher
    local.dailyVolumeUsedL = cs.dailyVolumeUsedL;
    local.dailyQuotaLimitL = cs.dailyQuotaLimitL;
    local.isValveClosed = cs.isValveClosed;
    local.closeCause = cs.closeCause;
    local.lastUpdated = cs.lastUpdated;
    if (local.id === localSectorId() && state.mqttOpenPending && !cs.isValveClosed) {
      state.mqttOpenPending = false;
    }
    // Closed valve → no waterfall (display 0 even if MQTT/sim still chatters)
    if (local.isValveClosed) {
      local.upstreamFlowLpm = 0;
      local.downstreamFlowLpm = 0;
      local.deltaQLpm = 0;
      if (cs.status !== 'offline') {
        local.status = cs.status;
        local.lastSeenAt = cs.lastSeenAt ?? local.lastSeenAt;
      }
      continue;
    }

    const isLocalSector = local.id === localSectorId();
    const mqttFresh =
      isLocalSector &&
      local.lastSeenAt != null &&
      Date.now() - new Date(local.lastSeenAt).getTime() < 15_000;

    // Remote sectors: always take chain (registry/snapshot). Local: MQTT wins if fresh.
    if (!mqttFresh) {
      local.upstreamFlowLpm = cs.upstreamFlowLpm;
      local.downstreamFlowLpm = cs.downstreamFlowLpm;
      local.deltaQLpm = cs.deltaQLpm;
      if (cs.status !== 'offline') {
        local.status = cs.status;
        local.lastSeenAt = cs.lastSeenAt;
      }
    } else if (local.status === 'offline') {
      local.status = 'online';
    }
  }
}

export function startLiveStore(): () => void {
  if (!state.unsubBridge) {
    state.unsubBridge = subscribeBridge((msg) => {
      if (msg.type === 'bridge.hello' || msg.type === 'bridge.status') {
        state.bridgeConnected = Boolean(msg.mqtt);
        emit();
      }
      if (msg.type === 'mqtt' && msg.topic === MQTT_TOPIC_SENSOR_FLOW) {
        const flow = parseSensorFlow(msg.payload);
        if (!flow) return;
        const now = new Date().toISOString();
        const localId = localSectorId();
        const local = state.sectors.find((x) => x.id === localId);
        // This broker only carries THIS laptop's sector. Never paint A/B from C's MQTT.
        if (flow.node_id === 'Upstream_Master') {
          state.mqttUpstream = flow.flow_rate;
          if (!local) return emit();
          if (local.isValveClosed) {
            local.upstreamFlowLpm = 0;
            local.downstreamFlowLpm = 0;
            local.deltaQLpm = 0;
          } else {
            local.upstreamFlowLpm = flow.flow_rate;
            local.deltaQLpm = Math.max(0, local.upstreamFlowLpm - local.downstreamFlowLpm);
          }
        } else if (flow.node_id === localId && local) {
          local.status = 'online';
          local.lastSeenAt = now;
          local.lastUpdated = now;
          if (local.isValveClosed) {
            local.upstreamFlowLpm = 0;
            local.downstreamFlowLpm = 0;
            local.deltaQLpm = 0;
          } else {
            local.downstreamFlowLpm = flow.flow_rate;
            if (state.mqttUpstream != null) local.upstreamFlowLpm = state.mqttUpstream;
            local.deltaQLpm = Math.max(0, local.upstreamFlowLpm - local.downstreamFlowLpm);
          }
          // Chart samples on a timer (see sampleChart) so bursty MQTT does not sawtooth.
        }
        emit();
      }
      if (msg.type === 'mqtt' && msg.topic === MQTT_TOPIC_ACTUATION_VALVE) {
        const p = msg.payload as { command?: string };
        // Valve open/closed UI state comes from chain only. MQTT OPEN is a request hint.
        if (p.command === 'OPEN_VALVE') {
          state.mqttOpenPending = true;
          emit();
        } else if (p.command === 'CLOSE_VALVE') {
          state.mqttOpenPending = false;
          emit();
        }
      }
    });
  }

  const poll = async () => {
    if (state.pollInFlight) return;
    state.pollInFlight = true;
    try {
      state.lastChain = await readChainState();
      mergeChain();
      emit();
    } catch (err) {
      console.error('[liveStore] chain poll failed', err);
      emit();
    } finally {
      state.pollInFlight = false;
    }
  };
  void poll();
  if (!state.pollTimer) {
    state.pollTimer = setInterval(() => void poll(), CHAIN_POLL_MS);
  }
  if (!state.sampleTimer) {
    state.sampleTimer = setInterval(() => sampleChart(), CHART_SAMPLE_MS);
  }

  return () => {
    /* keep singleton running for app lifetime */
  };
}

export function subscribeLive(fn: Listener): () => void {
  state.listeners.add(fn);
  startLiveStore();
  fn(); // sync current state immediately (covers poll that finished before subscribe)
  return () => state.listeners.delete(fn);
}

export function setLiveSelectedSector(id: SectorId): void {
  state.selectedSectorId = id;
  emit();
}

/** Publish MQTT OPEN_VALVE (aggregator re-arm). UI valve state still follows chain. */
export function liveOpenValve(sectorId: SectorId): void {
  if (sectorId !== localSectorId()) return;
  state.selectedSectorId = sectorId;
  state.mqttOpenPending = true;
  publishValve({ command: 'OPEN_VALVE' });
  emit();
}

export function getLiveSnapshot(): DashboardSnapshot {
  const chain = state.lastChain;
  const sectors = state.sectors;
  const alerts = chain?.alerts ?? [];
  const active = alerts.filter((a) => a.status === 'active');
  const local = sectors.find((s) => s.id === localSectorId());
  const chainLocalClosed =
    chain?.sectors.find((s) => s.id === localSectorId())?.isValveClosed ?? local?.isValveClosed ?? false;
  const up =
    sectors.reduce((n, s) => n + s.upstreamFlowLpm, 0) / Math.max(1, sectors.length);
  return {
    syncedAt: new Date().toISOString(),
    mode: 'live',
    bridgeConnected: state.bridgeConnected,
    chainConnected: state.chainConnected,
    awaitingOwnerReset: state.mqttOpenPending && chainLocalClosed,
    kpis: {
      totalUpstreamLpm: up,
      totalDownstreamLpm: sectors.reduce((n, s) => n + s.downstreamFlowLpm, 0),
      totalDeltaQLpm: sectors.reduce((n, s) => n + s.deltaQLpm, 0),
      activeAlerts: active.length,
      criticalAlerts: active.filter((a) => a.severity === 'critical').length,
      warningAlerts: active.filter((a) => a.severity === 'warning').length,
      valvesClosed: sectors.filter((s) => s.isValveClosed).length,
      sectorsOnline: sectors.filter((s) => s.status === 'online').length,
      sectorsTotal: sectors.length,
      leakThresholdLpm: chain?.chain.leakThresholdLpm ?? 5,
    },
    sectors: sectors.map((s) => ({ ...s })),
    alerts,
    events: chain?.events ?? [],
    snapshots: chain?.snapshots ?? [],
    flowSeries: [...state.flowSeries],
    chain: chain?.chain ?? {
      leakThresholdLpm: 5,
      dayLengthSeconds: 600,
      dayOffsetSeconds: 0,
      chainId: 1338,
      blockNumber: null,
      registryAddress: '',
      telemetryAddress: '',
    },
    selectedSectorId: state.selectedSectorId,
  };
}

export function getLiveCitizenSnapshot(): CitizenSnapshot {
  const dash = getLiveSnapshot();
  const mine = dash.sectors.find((s) => s.id === 'Sector_C') ?? dash.sectors[0]!;
  const pct =
    mine.dailyQuotaLimitL > 0 ? (mine.dailyVolumeUsedL / mine.dailyQuotaLimitL) * 100 : 0;
  const critical = dash.alerts.some((a) => a.severity === 'critical' && a.status === 'active');
  return {
    syncedAt: dash.syncedAt,
    headline: critical ? 'One repair in progress.' : 'Supply is running.',
    subhead: critical
      ? 'A network anomaly was recorded on-chain.'
      : 'Sector quotas and valves look normal.',
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
      usedPercent: s.dailyQuotaLimitL > 0 ? (s.dailyVolumeUsedL / s.dailyQuotaLimitL) * 100 : 0,
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
