import type { ChainConfigView, TelemetrySnapshot } from '@hydroledger/shared';
import { Button, Card, Chip } from '@/components/ui';
import { formatLpm } from '@/lib/format';

interface IntegrityPanelProps {
  chain: ChainConfigView;
  snapshots: TelemetrySnapshot[];
  chainConnected: boolean;
  bridgeConnected: boolean;
  preferredSectorId?: string;
  onVerify: () => void;
}

export function IntegrityPanel({
  chain,
  snapshots,
  chainConnected,
  bridgeConnected,
  preferredSectorId,
  onVerify,
}: IntegrityPanelProps) {
  const latest =
    (preferredSectorId
      ? snapshots.find((s) => s.sectorId === preferredSectorId)
      : undefined) ?? snapshots[0];
  return (
    <Card className="space-y-3">
      <h2 className="label-caps text-text">Data integrity</h2>
      <div className="flex flex-wrap gap-2">
        <Chip accent={chainConnected}>{chainConnected ? '✓ RPC' : '× RPC'}</Chip>
        <Chip accent={bridgeConnected}>{bridgeConnected ? '✓ MQTT bridge' : '× MQTT bridge'}</Chip>
      </div>
      <p className="font-mono text-[11px] text-text-2">
        Chain {chain.chainId}
        {chain.blockNumber != null ? ` · block ${chain.blockNumber}` : ''}
      </p>
      <p className="font-mono text-[11px] text-text-2">
        ε {chain.leakThresholdLpm.toFixed(1)} · day {chain.dayLengthSeconds}s
      </p>
      {latest ? (
        <p className="font-mono text-xs text-text">
          Snapshot {latest.sectorId}: up {formatLpm(latest.upstreamFlowLpm)} ΔQ{' '}
          {formatLpm(latest.deltaQLpm)} · n={latest.count}
        </p>
      ) : (
        <p className="text-sm text-text-2">
          {chainConnected
            ? 'No telemetry snapshots for this sector yet (leak closes valve on registry; snapshots are periodic ~4 min).'
            : 'No telemetry snapshots yet (RPC not connected).'}
        </p>
      )}
      <Button variant="outline" size="sm" onClick={onVerify}>
        Verify on-chain state
      </Button>
      <p className="text-[10px] text-text-2">
        Compares UI to WaterQuotaRegistry / WaterTelemetryLog (no Merkle in this backend).
      </p>
    </Card>
  );
}
