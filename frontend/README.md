# HydroLedger Frontend

React dashboard for the MQTT + Besu stack (`Sector_A` / `B` / `C`).

Backend setup (Besu, Mosquitto, Node-RED, aggregator) is in the **repo root** [`README.md`](../README.md). Start that first.

## Start the dashboard

From this `frontend/` folder:

```powershell
npm install -g pnpm
pnpm install
copy .env.example .env
```

Edit `.env` for your laptop:

- `VITE_LOCAL_SECTOR_ID` — `Sector_A`, `Sector_B`, or `Sector_C`
- `VITE_RPC_URL` / contract addresses — match your local Besu deploy

Then:
close and re open terminal
```powershell
pnpm --filter @hydroledger/shared build
pnpm --filter @hydroledger/bridge dev
pnpm --filter @hydroledger/web dev
```

Open http://localhost:5173

- Bridge: `ws://127.0.0.1:8787` ↔ MQTT `1883`
- Web reads Besu via ethers (private chain)

## Layout

```
frontend/
  apps/web         Dashboard (React)
  apps/bridge      MQTT ↔ WebSocket
  packages/shared  Sector types + helpers
```

See [API_CONTRACT.md](./API_CONTRACT.md).
