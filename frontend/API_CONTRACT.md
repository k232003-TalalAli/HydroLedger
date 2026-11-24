# HydroLedger integration contract (backend = source of truth)

The dashboard does **not** call a REST API. The backend publishes MQTT and writes Besu contracts. The frontend reads those channels.

## Channels

| Channel | Address | Topics / calls |
| ------- | ------- | -------------- |
| MQTT | `mqtt://127.0.0.1:1883` | `sensor/flow`, `actuation/valve` |
| Bridge (frontend-owned) | `ws://127.0.0.1:8787` | Forwards MQTT ↔ browser |
| Besu JSON-RPC | `http://127.0.0.1:8545` (A sector often `:8546`) | `sectorRegistry`, events, `latestSnapshot` |

## MQTT payloads

```json
{ "node_id": "Upstream_Master", "flow_rate": 20.0 }
{ "node_id": "Sector_B", "flow_rate": 20.0 }
{ "command": "CLOSE_VALVE", "reason": "ANOMALY_DETECTED" }
{ "command": "OPEN_VALVE" }
```

Reasons: `ANOMALY_DETECTED`, `QUOTA_EXCEEDED`, `OWNER_RESET`, `DAILY_ROLLOVER`.

## On-chain (chainId 1338)

- `WaterQuotaRegistry` — `0xADc48A06940CB4F9066d66891170BE573b47453B`
- `WaterTelemetryLog` — `0x597aa018401944D9D36Eca15d1ae5b5a532ABe04`
- Flows/volumes scaled **×100**
- Sectors: `Sector_A`, `Sector_B`, `Sector_C`
- Alert reasons: `ANOMALY_DETECTED`, `QUOTA_EXCEEDED`
- **No Merkle roots** in this backend

## Frontend modes

- `VITE_USE_MOCK=true` — offline sector simulator
- `VITE_USE_MOCK=false` — ethers poll + MQTT via `apps/bridge`

## Backend repo

Treat `../backend/` as **read-only**. Do not patch aggregator/contracts from the frontend track.
