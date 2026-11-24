# HydroLedger (Frontend)

React dashboard aligned to the **backend** MQTT + Besu stack (`Sector_A/B/C`, no REST API).

**Do not modify** `../backend/` — it is a read-only copy of the teammates’ repo.

Run all commands from this `frontend/` directory.

## Quick start (mock / offline)

```bash
pnpm install
cp .env.example .env
# keep VITE_USE_MOCK=true
pnpm --filter @hydroledger/shared build
pnpm --filter @hydroledger/web dev
```

Open http://localhost:5173 — use **Sim** scenarios and role switcher.

## Live mode (with backend running)

1. Mosquitto, Besu, aggregator, Node-RED as in `../backend/README.md` (or repo-root `start-simulation.ps1`)
2. In `.env`: `VITE_USE_MOCK=false` and correct `VITE_RPC_URL` / contract addresses
3. Start bridge + web:

```bash
pnpm --filter @hydroledger/bridge dev
pnpm --filter @hydroledger/web dev
```

- Bridge: `ws://127.0.0.1:8787` ↔ MQTT `1883`
- Web reads Besu via ethers (free reads on private chain)

## Scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Web only |
| `pnpm --filter @hydroledger/bridge dev` | MQTT↔WS bridge |
| `pnpm lint` / `typecheck` / `test` / `build` | Quality |

## Layout

```
frontend/
  apps/web         Dashboard (React)
  apps/bridge      MQTT ↔ WebSocket (ours)
  packages/shared  Sector types + scale helpers
../backend/        Teammates’ stack — read-only
```

See [API_CONTRACT.md](./API_CONTRACT.md) and [design/HYDROLEDGER_FRONTEND_PLAN.md](./design/HYDROLEDGER_FRONTEND_PLAN.md).
