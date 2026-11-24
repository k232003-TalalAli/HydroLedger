import { useState } from 'react';
import { SECTOR_IDS, type SectorId } from '@hydroledger/shared';
import { Button, Modal } from '@/components/ui';
import { verifySectorOnChain } from '@/lib/chain';
import { useMockMode } from '@/data/hooks';
import { useDashboard } from '@/data/hooks';
import { formatLpm } from '@/lib/format';

interface VerifyModalProps {
  open: boolean;
  onClose: () => void;
  defaultSectorId?: SectorId;
}

export function VerifyModal({ open, onClose, defaultSectorId = 'Sector_B' }: VerifyModalProps) {
  const mock = useMockMode();
  const { data } = useDashboard();
  const [sectorId, setSectorId] = useState<SectorId>(defaultSectorId);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (mock) {
        const s = data?.sectors.find((x) => x.id === sectorId);
        setResult(
          s
            ? `✓ MOCK: ${sectorId} up=${formatLpm(s.upstreamFlowLpm)} ΔQ=${formatLpm(s.deltaQLpm)} valve=${s.isValveClosed ? 'CLOSED' : 'OPEN'} (simulated)`
            : '◆ Sector not in mock snapshot',
        );
      } else {
        const v = await verifySectorOnChain(sectorId);
        setResult(v.message);
      }
    } catch (e) {
      setResult(`◆ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Verify on-chain state"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-text">
        <p className="text-xs text-text-2">
          Reads WaterQuotaRegistry.sectorRegistry via Besu RPC. This backend has no Merkle batches.
        </p>
        <label className="flex items-center gap-2 text-sm">
          Sector
          <select
            className="h-8 rounded-btn border border-border bg-bg px-2 font-mono text-xs"
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value as SectorId)}
          >
            {SECTOR_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        {result ? (
          <div className="rounded-card border border-border p-3 font-mono text-sm" role="status">
            {result}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
