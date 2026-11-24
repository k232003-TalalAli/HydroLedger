import { Card, Chip, Skeleton } from '@/components/ui';
import { Button } from '@/components/ui';
import { useDashboard, useMockMode, useScenarioControls, SCENARIOS, type Scenario } from '@/data/hooks';
import { truncateHash } from '@/lib/format';

export function AdminPage() {
  const { data, isLoading } = useDashboard();
  const mock = useMockMode();
  const { setScenario, scenario } = useScenarioControls();

  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Admin</h1>
      <Card className="space-y-3">
        <h2 className="label-caps">Chain config (read-only)</h2>
        <p className="font-mono text-sm">ε = {data.chain.leakThresholdLpm.toFixed(1)} L/min</p>
        <p className="font-mono text-sm">Day length = {data.chain.dayLengthSeconds}s</p>
        <p className="font-mono text-xs text-text-2">
          Registry {truncateHash(data.chain.registryAddress, 10, 6)}
        </p>
        <p className="text-xs text-text-2">
          Threshold / quota writes stay on Laptop A CLIs (
          <code>set-quota.js</code>, <code>reset-sector.js</code>) — backend unchanged.
        </p>
        <Chip accent={data.chainConnected}>
          {data.chainConnected ? 'RPC connected' : 'RPC unreachable'}
        </Chip>
      </Card>
      {mock ? (
        <Card className="space-y-3">
          <h2 className="label-caps">Mock scenario</h2>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={scenario === s ? 'primary' : 'outline'}
                onClick={() => setScenario(s as Scenario)}
              >
                {s}
              </Button>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-text-2">
            Live mode: drive scenarios from Node-RED (<code>simulation/flows*.json</code>) and the
            aggregator. Set <code>VITE_USE_MOCK=true</code> for offline UI demos.
          </p>
        </Card>
      )}
    </div>
  );
}
