# Aggregator Middleware & Data Cleaning Engine (`middleware/`)

Node.js edge middleware (`aggregator.js`) that bridges the local **Eclipse Mosquitto MQTT broker** and the **Hyperledger Besu / Geth Proof-of-Authority (PoA) blockchain**.

It performs three core tasks:

1. **Noise Filtering & Smoothing:** Discards corrupt/outlier sensor readings (`< 0` or `>= 500` L/min) and applies an Exponential Moving Average (EMA) filter.
2. **Off-Chain Mass-Balance & Quota Tracking:** Computes $\Delta Q = Q_{\text{upstream}} - \sum Q_{\text{downstream}}$ and tracks cumulative daily sector water volume.
3. **On-Chain Audit & Physical Actuation:** When a leak ($\Delta Q > 5.0\text{ L/min}$) or quota breach occurs, scales metrics by `100`, submits a signed transaction to `WaterQuotaRegistry.sol`, and publishes `CLOSE_VALVE` to `actuation/valve`.

---

## 1. Prerequisites & Installation

1. **Node.js (LTS v18 or v20+)** installed on Windows.
2. A running **Eclipse Mosquitto** broker on port `1883` (see `../broker/README.md`).
3. Install dependencies inside this folder:
   ```powershell
    cd middleware
    npm install
   ```
4. Create your local environment file from the template:
   ```powershell
    Copy-Item .env.example .env
   ```

---

## 2. Environment Variables (`.env`)

| Variable | Default / Example | Description |
| :--- | :--- | :--- |
| `DRY_RUN` | `true` | `true` skips blockchain RPC calls for solo testing; `false` sends real signed transactions. |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | Local Mosquitto broker URL. |
| `RPC_URL` | `http://127.0.0.1:8545` | Local Besu/Geth validator JSON-RPC endpoint (or teammate's Tailscale IP `:8545`). |
| `PRIVATE_KEY` | `0x...` | Validator wallet private key (`Val_A` on Laptop A, `Val_B` on Laptop B). |
| `CONTRACT_ADDRESS` | `0x...` | Deployed `WaterQuotaRegistry.sol` address. |
| `SECTOR_ID` | `Sector_B` | Sector identifier encoded to `bytes32` on-chain. |
| `LEAK_THRESHOLD` | `5.0` | Maximum allowed $\Delta Q$ (L/min) before triggering a leak alert. |
| `DAILY_QUOTA_LIMIT` | `5000` | Maximum daily sector volume (Liters) before triggering a quota shutoff. |

---

## 3. Mode A: Single-Laptop Testing (`DRY_RUN=true`)

Use this mode to test noise filtering, $\Delta Q$ calculations, and valve actuation on your own machine before the blockchain node is online.

1. Confirm `.env` has `DRY_RUN=true`.
2. Open **4 PowerShell terminals**:

**Terminal 1 — Start Mosquitto Broker:**

```powershell
cd broker
mosquitto -c mosquitto.conf -v
```

**Terminal 2 — Listen for Valve Shutoff Commands:**

```powershell
mosquitto_sub -h localhost -p 1883 -t "actuation/valve" -v
```

**Terminal 3 — Start Middleware:**

```powershell
cd middleware
node aggregator.js
```

**Terminal 4 — Inject Test Telemetry (PowerShell-Safe Commands):**

* **Test 1: Dirty / Outlier Data (Should be dropped by filter)**
  ```powershell
  '{"node_id":"Upstream_Master","flow_rate":-15}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
  '{"node_id":"Upstream_Master","flow_rate":999}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
  ```

  *Expected:* Terminal 3 logs `[FILTERED]` and ignores both readings.
* **Test 2: Normal Balanced Flow ($\Delta Q = 0$, No Alert)**
  ```powershell
  '{"node_id":"Upstream_Master","flow_rate":20.0}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
  '{"node_id":"Sector_B","flow_rate":20.0}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
  ```

  *Expected:* Terminal 3 logs balanced flow with `DeltaQ: 0.00` and triggers no alerts.
* **Test 3: Simulated Pipe Burst ($\Delta Q = 18.0 > 5.0$, Triggers Shutoff)**
  ```powershell
  '{"node_id":"Sector_B","flow_rate":2.0}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
  ```

  *Expected:* Terminal 3 prints `ANOMALY_DETECTED` and `[DRY RUN] Skipping blockchain transaction`, and **Terminal 2** immediately prints:
  ```text
  actuation/valve {"command":"CLOSE_VALVE","reason":"LEAK_DETECTED"}
  ```

> **Resetting Between Tests:** Because `aggregator.js` locks after dispatching `CLOSE_VALVE` to prevent duplicate alerts, press `Ctrl + C` in Terminal 3 and run `node aggregator.js` again to reset the state for another test run.

---

## 4. Mode B: Multi-Computer & Live Blockchain (`DRY_RUN=false`)

Use this mode once **Tailscale** (Module 0) and the **Hyperledger Besu / Geth validators +** `WaterQuotaRegistry.sol` (Module 1) are running across Laptop A and Laptop B.

1. **Update** `.env` **on Each Laptop:**
   - Set `DRY_RUN=false`.
   - Set `CONTRACT_ADDRESS` to the deployed `WaterQuotaRegistry` address.
   - **If running a local validator node on each laptop (Full Multi-Node Setup):**
     - Set `RPC_URL=http://127.0.0.1:8545`.
     - On **Laptop A**, set `PRIVATE_KEY` to **Validator A's** private key (`Val_A`).
     - On **Laptop B**, set `PRIVATE_KEY` to **Validator B's** private key (`Val_B`).
   - **If connecting to a single validator hosted on a teammate's laptop over Tailscale:**
     - Set `RPC_URL=http://<TEAMMATE_TAILSCALE_IP>:8545` (ensure the host node was started with `--rpc-http-host=0.0.0.0`).
     - Set `PRIVATE_KEY` to an authorized validator key funded with gas on that chain.
2. **Start Services in Order:**
   1. Verify Tailscale is connected (`tailscale status`).
   2. Verify the Besu/Geth validator node is running and peered (`Peer Count: 1`).
   3. Start Mosquitto (`mosquitto -c mosquitto.conf -v`).
   4. Start `node aggregator.js`.
3. **Verify Cross-Network Consensus:**
   - Inject a leak on **Laptop B** (`flow_rate: 2.0` on `Sector_B`).
   - Confirm **Laptop B's** middleware logs `ANOMALY_DETECTED` and prints a confirmed transaction hash from Node 2.
   - Confirm **Laptop A's** Besu/Geth terminal imports the new block over Tailscale P2P and **Laptop B's** Mosquitto dispatches `CLOSE_VALVE` to the ESP32.