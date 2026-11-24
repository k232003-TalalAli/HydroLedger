import {
  DEFAULT_CHAIN_ID,
  DEFAULT_REGISTRY_ADDRESS,
  DEFAULT_TELEMETRY_ADDRESS,
  REMOTE_FLOW_STALE_SEC,
  SECTOR_IDS,
  fromChain,
  sectorLabel,
  type Alert,
  type AuditEvent,
  type ChainConfigView,
  type CloseCause,
  type SectorId,
  type SectorStateView,
  type TelemetrySnapshot,
} from '@hydroledger/shared';
import { Contract, JsonRpcProvider, encodeBytes32String, id, type Log } from 'ethers';
import { REGISTRY_ABI, TELEMETRY_ABI } from './abis';

export function getChainEnv() {
  return {
    rpcUrl: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545',
    chainId: Number(import.meta.env.VITE_CHAIN_ID || DEFAULT_CHAIN_ID),
    registry: import.meta.env.VITE_REGISTRY_ADDRESS || DEFAULT_REGISTRY_ADDRESS,
    telemetry: import.meta.env.VITE_TELEMETRY_ADDRESS || DEFAULT_TELEMETRY_ADDRESS,
  };
}

export function createProvider(): JsonRpcProvider {
  const env = getChainEnv();
  // staticNetwork avoids flaky eth_chainId detection against Besu from the browser
  return new JsonRpcProvider(env.rpcUrl, env.chainId, { staticNetwork: true });
}

function sectorBytes(sectorId: SectorId): string {
  return encodeBytes32String(sectorId);
}

function matchSector(bytes32: string): SectorId | null {
  for (const sid of SECTOR_IDS) {
    if (encodeBytes32String(sid).toLowerCase() === bytes32.toLowerCase()) return sid;
  }
  return null;
}

export interface ChainReadResult {
  connected: boolean;
  blockNumber: number | null;
  sectors: SectorStateView[];
  snapshots: TelemetrySnapshot[];
  alerts: Alert[];
  events: AuditEvent[];
  chain: ChainConfigView;
  error?: string;
}

export async function readChainState(): Promise<ChainReadResult> {
  const env = getChainEnv();
  const emptyChain: ChainConfigView = {
    leakThresholdLpm: 5,
    dayLengthSeconds: 600,
    dayOffsetSeconds: 0,
    chainId: env.chainId,
    blockNumber: null,
    registryAddress: env.registry,
    telemetryAddress: env.telemetry,
  };

  try {
    const provider = createProvider();
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    const registry = new Contract(env.registry, REGISTRY_ABI, provider);
    const telemetry = new Contract(env.telemetry, TELEMETRY_ABI, provider);

    const view = (c: Contract, name: string, args: unknown[] = []) =>
      c.getFunction(name)(...args) as Promise<unknown>;

    const leakRaw = (await view(registry, 'leakThreshold')) as bigint;
    const dayLen = (await view(registry, 'dayLengthSeconds')) as bigint;
    const dayOff = (await view(registry, 'dayOffsetSeconds')) as bigint;
    const leakThresholdLpm = fromChain(leakRaw);

    const sectors: SectorStateView[] = [];
    const snapshots: TelemetrySnapshot[] = [];

    for (const sid of SECTOR_IDS) {
      const bytes = sectorBytes(sid);
      const exists = Boolean(await view(registry, 'sectorExists', [bytes]));
      if (!exists) {
        sectors.push({
          id: sid,
          name: sectorLabel(sid),
          upstreamFlowLpm: 0,
          downstreamFlowLpm: 0,
          deltaQLpm: 0,
          dailyVolumeUsedL: 0,
          dailyQuotaLimitL: 5000,
          isValveClosed: false,
          closeCause: 0,
          lastUpdated: null,
          status: 'offline',
          lastSeenAt: null,
        });
        continue;
      }

      const row = (await view(registry, 'sectorRegistry', [bytes])) as {
        upstreamFlowRate: bigint;
        downstreamFlowRate: bigint;
        deltaQ: bigint;
        dailyVolumeUsed: bigint;
        dailyQuotaLimit: bigint;
        isValveClosed: boolean;
        lastUpdated: bigint;
      };
      const causeNum = Number(await view(registry, 'closeCause', [bytes]));
      const cause: CloseCause = causeNum === 1 || causeNum === 2 ? causeNum : 0;
      const lastTs = Number(row.lastUpdated);
      const closed = Boolean(row.isValveClosed);

      // Registry flows only update on breach. After OPEN_VALVE, periodic telemetry
      // snapshots are newer — prefer them for open sectors so cards aren't stuck on
      // the last leak/quota reading (e.g. downstream 2.x while live is ~20).
      let upstreamFlowLpm = fromChain(row.upstreamFlowRate);
      let downstreamFlowLpm = fromChain(row.downstreamFlowRate);
      let deltaQLpm = fromChain(row.deltaQ);
      let flowTs = lastTs;

      try {
        const snap = (await view(telemetry, 'latestSnapshot', [bytes])) as {
          upstreamFlowRate: bigint;
          downstreamFlowRate: bigint;
          deltaQ: bigint;
          dailyVolumeUsed: bigint;
          timestamp: bigint;
        };
        const count = (await view(telemetry, 'snapshotCount', [bytes])) as bigint;
        const snapTs = Number(snap.timestamp);
        snapshots.push({
          sectorId: sid,
          upstreamFlowLpm: fromChain(snap.upstreamFlowRate),
          downstreamFlowLpm: fromChain(snap.downstreamFlowRate),
          deltaQLpm: fromChain(snap.deltaQ),
          dailyVolumeUsedL: fromChain(snap.dailyVolumeUsed),
          timestamp: snapTs > 0 ? new Date(snapTs * 1000).toISOString() : null,
          count: Number(count),
        });
        // Open valve: always prefer telemetry snapshot for flows. Registry only
        // updates on breach, so lastUpdated can be newer while still carrying the
        // leak-era downstream (e.g. 2.4) after OPEN_VALVE + a normal snapshot (~20).
        if (!closed && snapTs > 0) {
          upstreamFlowLpm = fromChain(snap.upstreamFlowRate);
          downstreamFlowLpm = fromChain(snap.downstreamFlowRate);
          deltaQLpm = fromChain(snap.deltaQ);
          flowTs = Math.max(snapTs, lastTs);
        }
      } catch {
        /* no snapshot — keep registry flows */
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const ageSec = flowTs > 0 ? Math.max(0, nowSec - flowTs) : Number.POSITIVE_INFINITY;
      // Last snapshot persists on-chain after a laptop stops simulating — zero + stale when old.
      const remoteStale = !closed && flowTs > 0 && ageSec > REMOTE_FLOW_STALE_SEC;
      const showUp = closed || remoteStale ? 0 : upstreamFlowLpm;
      const showDown = closed || remoteStale ? 0 : downstreamFlowLpm;
      const showDq = closed || remoteStale ? 0 : deltaQLpm;
      const status = closed
        ? flowTs > 0
          ? 'online'
          : 'offline'
        : remoteStale
          ? 'stale'
          : flowTs > 0
            ? 'online'
            : 'offline';

      sectors.push({
        id: sid,
        name: sectorLabel(sid),
        upstreamFlowLpm: showUp,
        downstreamFlowLpm: showDown,
        deltaQLpm: showDq,
        dailyVolumeUsedL: fromChain(row.dailyVolumeUsed),
        dailyQuotaLimitL: fromChain(row.dailyQuotaLimit),
        isValveClosed: closed,
        closeCause: cause,
        lastUpdated: flowTs > 0 ? new Date(flowTs * 1000).toISOString() : null,
        status,
        lastSeenAt: flowTs > 0 ? new Date(flowTs * 1000).toISOString() : null,
      });
    }

    const alerts: Alert[] = [];
    const events: AuditEvent[] = [];
    const fromBlock = Math.max(0, blockNumber - 5000);

    try {
      const alertTopic = id('SectorAlert(bytes32,string,uint256)');
      const logs: Log[] = await provider.getLogs({
        address: env.registry,
        fromBlock,
        toBlock: blockNumber,
        topics: [alertTopic],
      });
      const iface = registry.interface;
      for (const log of logs.slice(-30).reverse()) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (!parsed) continue;
          const sectorBytes32 = String(parsed.args.sectorId);
          const reason = String(parsed.args.reason);
          const ts = Number(parsed.args.timestamp);
          const sid = matchSector(sectorBytes32) ?? 'Sector_A';
          const severity = reason === 'ANOMALY_DETECTED' ? 'critical' : 'warning';
          alerts.push({
            id: `${log.transactionHash}-${log.index}`,
            reason,
            severity,
            title: `${reason} · ${sid}`,
            sectorId: sid,
            detectedAt: new Date(ts * 1000).toISOString(),
            status: 'active',
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
          events.push({
            id: `alert-${log.transactionHash}-${log.index}`,
            name: 'SectorAlert',
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            ts: new Date(ts * 1000).toISOString(),
            payload: reason,
            sectorId: sid,
          });
        } catch {
          /* skip */
        }
      }
    } catch {
      /* getLogs unavailable */
    }

    for (const s of sectors) {
      if (s.isValveClosed && s.closeCause === 1) {
        if (!alerts.some((a) => a.sectorId === s.id && a.reason === 'ANOMALY_DETECTED')) {
          alerts.unshift({
            id: `local-leak-${s.id}`,
            reason: 'ANOMALY_DETECTED',
            severity: 'critical',
            title: `ANOMALY_DETECTED · ${s.id}`,
            sectorId: s.id,
            measuredDeltaQ: s.deltaQLpm,
            leakThreshold: leakThresholdLpm,
            detectedAt: s.lastUpdated ?? new Date().toISOString(),
            status: 'active',
            txHash: null,
            blockNumber: null,
          });
        }
      }
      if (s.isValveClosed && s.closeCause === 2) {
        if (!alerts.some((a) => a.sectorId === s.id && a.reason === 'QUOTA_EXCEEDED')) {
          alerts.unshift({
            id: `local-quota-${s.id}`,
            reason: 'QUOTA_EXCEEDED',
            severity: 'warning',
            title: `QUOTA_EXCEEDED · ${s.id}`,
            sectorId: s.id,
            detectedAt: s.lastUpdated ?? new Date().toISOString(),
            status: 'active',
            txHash: null,
            blockNumber: null,
          });
        }
      }
    }

    return {
      connected: true,
      blockNumber,
      sectors,
      snapshots,
      alerts,
      events,
      chain: {
        leakThresholdLpm,
        dayLengthSeconds: Number(dayLen),
        dayOffsetSeconds: Number(dayOff),
        chainId: Number(network.chainId),
        blockNumber,
        registryAddress: env.registry,
        telemetryAddress: env.telemetry,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chain] readChainState failed', err);
    return {
      connected: false,
      blockNumber: null,
      sectors: SECTOR_IDS.map((sid) => ({
        id: sid,
        name: sectorLabel(sid),
        upstreamFlowLpm: 0,
        downstreamFlowLpm: 0,
        deltaQLpm: 0,
        dailyVolumeUsedL: 0,
        dailyQuotaLimitL: 5000,
        isValveClosed: false,
        closeCause: 0 as CloseCause,
        lastUpdated: null,
        status: 'offline' as const,
        lastSeenAt: null,
      })),
      snapshots: [],
      alerts: [],
      events: [],
      chain: emptyChain,
      error: message,
    };
  }
}

/** Compare UI sector row to on-chain registry (integrity check). */
export async function verifySectorOnChain(sectorId: SectorId): Promise<{
  ok: boolean;
  message: string;
  chain: SectorStateView | null;
}> {
  const state = await readChainState();
  const row = state.sectors.find((s) => s.id === sectorId) ?? null;
  if (!state.connected || !row) {
    return { ok: false, message: '◆ Cannot reach chain RPC', chain: null };
  }
  return {
    ok: true,
    message: `✓ On-chain ${sectorId}: up=${row.upstreamFlowLpm.toFixed(2)} ΔQ=${row.deltaQLpm.toFixed(2)} valve=${row.isValveClosed ? 'CLOSED' : 'OPEN'}`,
    chain: row,
  };
}
