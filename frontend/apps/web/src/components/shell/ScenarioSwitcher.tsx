import { SCENARIOS, type Scenario, useMockMode, useScenarioControls } from '@/data/hooks';

/** Dev-only scenario control — mock mode only. */
export function ScenarioSwitcher() {
  const mock = useMockMode();
  const { scenario, setScenario } = useScenarioControls();

  if (!mock) {
    return (
      <span className="hidden font-mono text-[10px] text-text-2 lg:inline" title="Live backend mode">
        LIVE
      </span>
    );
  }

  return (
    <label className="hidden items-center gap-1 lg:flex">
      <span className="label-caps">Sim</span>
      <select
        className="h-8 rounded-btn border border-border bg-surface px-2 font-mono text-[11px] text-text"
        value={typeof scenario === 'string' ? scenario : 'leak'}
        onChange={(e) => setScenario(e.target.value as Scenario)}
        aria-label="Simulator scenario"
      >
        {SCENARIOS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
