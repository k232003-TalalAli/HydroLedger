# HydroLedger (Frontend)

React dashboard aligned to the **backend** MQTT + Besu stack (`Sector_A/B/C`, no REST API).

**Do not modify** `../backend/` — it is a read-only copy of the teammates’ repo.

Run all commands from this `frontend/` directory.

## Quick start

**Preferred:** from repo root, one script starts Besu + Mosquitto + Node-RED + aggregator + bridge + web:

```powershell
powershell -ExecutionPolicy Bypass -File ..\start-simulation.ps1
```

**Frontend only** (backend already running):

```bash
pnpm install
cp .env.example .env
# set VITE_LOCAL_SECTOR_ID=Sector_X and correct VITE_RPC_URL / contract addresses
pnpm --filter @hydroledger/shared build
```

Then start bridge + web:

```bash
pnpm --filter @hydroledger/bridge dev
pnpm --filter @hydroledger/web dev
```

Open http://localhost:5173

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

See [API_CONTRACT.md](./API_CONTRACT.md).
