# HydroLedger (`frontend` branch)

Backend is the same as `main`, just under `backend/`. This branch adds the React dashboard.

| | Laptop A | Laptop B | Laptop C |
|---|---|---|---|
| Sector | `Sector_A` | `Sector_B` | `Sector_C` |
| Besu env | `backend\blockchain\besu-setup\envs\A.env` | `envs\B.env` | `envs\C.env` |
| Node-RED flow | `backend\simulation\flows.sector-a.json` | Sector_B flow | `backend\simulation\flows.sector-c.json` |
| `VITE_LOCAL_SECTOR_ID` | `Sector_A` | `Sector_B` | `Sector_C` |

Set repo root once:

```powershell
$P = "D:\Users\Daniyal Arsalan\Desktop\HydroLedger"   # your path
```

Full B/C backend detail (keys, firewall, etc.): [`backend/README.md`](./backend/README.md). Paths there are relative to `backend\` (e.g. `$P\middleware` → use `$P\backend\middleware` from repo root).

---

## 1. Switch to this branch

```powershell
cd $P
git fetch
git checkout frontend
git pull origin frontend
```

---

## 2. Backend (same as main — start this first)

**Besu**

```powershell
cd $P\backend\blockchain\besu-setup
Copy-Item envs\A.env .env -Force   # A: A.env | B: B.env | C: C.env
docker compose up -d
cd $P\backend\blockchain\chain-client
node chain.js status               # peers ≥ 1, blocks moving
```

Start **A before B/C**.

**Mosquitto + Node-RED + aggregator** (3 terminals on each laptop)

```powershell
# 1
cd $P\backend\broker
& "C:\Program Files\mosquitto\mosquitto.exe" -c mosquitto.conf -v

# 2
node-red
# Import your sector flow → Deploy

# 3
cd $P\backend\middleware
node aggregator.js
```

**A only** (on-chain valve reopen):

```powershell
cd $P\backend\middleware
node owner-reset.js
```

Aggregator `.env` and contracts `.env` are unchanged from main — still in `backend\middleware\` and `backend\hydro-contracts\`.

---

## 3. Dashboard (this branch)

Once (per laptop):

```powershell
cd $P\frontend
pnpm install
pnpm --filter @hydroledger/shared build
copy .env.example .env
```

Edit `frontend\.env` — set **your** sector:

```env
VITE_LOCAL_SECTOR_ID=Sector_A
# or Sector_B / Sector_C
VITE_RPC_URL=http://127.0.0.1:8545
VITE_BRIDGE_WS_URL=ws://127.0.0.1:8787
MQTT_URL=mqtt://127.0.0.1:1883
BRIDGE_PORT=8787
```

Run (2 terminals):

```powershell
cd $P\frontend
pnpm --filter @hydroledger/bridge dev

cd $P\frontend
pnpm --filter @hydroledger/web dev
```

Open http://localhost:5173

You should see LIVE, Besu connected, and your sector’s MQTT flow. Valve open/closed follows the chain.

---

## Quick check

| Check | OK when |
|-------|---------|
| `node chain.js status` | peers & blocks OK |
| Aggregator log | `[TELEMETRY]` not stuck on `[WARMUP]` |
| Bridge terminal | MQTT connected, WS on 8787 |
| Browser | http://localhost:5173 loads, sector matches `.env` |
