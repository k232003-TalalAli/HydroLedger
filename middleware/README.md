# Aggregator Middleware (`middleware/`)

`aggregator.js` is the Node.js edge service that sits between the local **Mosquitto** broker and the **Hyperledger Besu** chain. One aggregator runs per laptop, and **one laptop is one sector**.

It does four things:

1. **Filters and smooths** sensor readings (drops `< 0` and `>= 500` L/min, then a per-node EMA, `ALPHA = 0.7`).
2. **Detects** leaks (mass balance `ΔQ = upstream - Σ downstream`) and daily quota breaches.
3. **Closes the valve first**: publishes `CLOSE_VALVE` on `actuation/valve` immediately.
4. **Writes the audit record** to the chain afterwards (queued and retried) with this laptop's **reporter wallet**, plus a 10-minute telemetry snapshot.

| Sector | Laptop | Besu node used for RPC | `RPC_URL` | Reporter wallet |
| :--- | :--- | :--- | :--- | :--- |
| `Sector_A` | A | `hydro-node2` | `http://127.0.0.1:8546` | `reporterA` |
| `Sector_B` | B | `hydro-node3` | `http://127.0.0.1:8545` | `reporterB` |
| `Sector_C` | C | `hydro-node4` | `http://127.0.0.1:8545` | `reporterC` |

`hydro-node1` is a validator and bootnode only. **No sector and no aggregator uses it.** Each laptop runs its own broker, Node-RED and aggregator, so sensor names only need to be unique within one laptop.

---

## 1. Install

Node.js LTS (v18, v20 or newer), then:

```powershell
cd middleware
npm install
Copy-Item .env.example .env
```

Never use a validator key (`besu-net/nodeN/key`) as `PRIVATE_KEY`. Use the **reporter** wallet made by `hydro-contracts/scripts/make-wallets.js`.

---

## 2. Environment variables (`.env`)

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `DRY_RUN` | `true` | `true` makes **no RPC calls at all** and logs what it would write. `false` writes to the chain. |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | This laptop's own broker |
| `RPC_URL` | `http://127.0.0.1:8545` | **Sector_A laptop: `http://127.0.0.1:8546`** (node2) |
| `PRIVATE_KEY` | none | This laptop's **reporter** wallet (required in live mode, or use the keystore below) |
| `KEYSTORE_PATH`, `KEYSTORE_PASSWORD` | none | Optional encrypted JSON keystore instead of `PRIVATE_KEY` |
| `CONTRACT_ADDRESS` | none | `WaterQuotaRegistry` (live mode) |
| `TELEMETRY_CONTRACT_ADDRESS` | none | `WaterTelemetryLog` (live mode) |
| `SECTOR_ID` | none | `Sector_A`, `Sector_B` or `Sector_C`. On-chain id is `encodeBytes32String(SECTOR_ID)` |
| `UPSTREAM_NODE_ID` | `Upstream_Master` | The inlet sensor |
| `EXPECTED_DOWNSTREAM` | none (required) | Comma list of outlet sensor ids, at least one. Other ids are ignored (`[UNEXPECTED_NODE]`) |
| `LEAK_THRESHOLD` | `5.0` | L/min. **Fallback only**: the on-chain value wins |
| `DAILY_QUOTA_LIMIT` | `5000` | Litres. **Fallback only**: the on-chain value wins |
| `EVAL_INTERVAL_SEC` | `2` | Evaluation tick |
| `STALE_AFTER_SEC` | `10` | A sensor older than this is stale |
| `BREACH_CONSECUTIVE` | `2` | Leak must hold this many ticks (about 4 s) |
| `SNAPSHOT_INTERVAL_MIN` | `4` | Telemetry snapshot period. Keep it above the contract's `MIN_SNAPSHOT_INTERVAL_SECONDS` (210 s) |
| `CHAIN_POLL_SEC` | `30` | How often the chain config is re-read |
| `DAY_LENGTH_SECONDS` | `600` | Length of one quota day. **Fallback only**: the on-chain `dayLengthSeconds` wins |
| `DAY_OFFSET_SECONDS` | `0` | Fallback if the chain is unreachable. On-chain `dayOffsetSeconds` wins. Must be below the day length |
| `STATE_DIR` | `./state` | State file folder (gitignored) |

The program stops at startup with a clear message if `SECTOR_ID` or `EXPECTED_DOWNSTREAM` is missing, or, in live mode, `RPC_URL`, `CONTRACT_ADDRESS`, `TELEMETRY_CONTRACT_ADDRESS` or a key is missing.

---

## 3. How it behaves

* **Warm-up gate.** No leak or quota decision until the upstream sensor **and every** expected downstream sensor has delivered one valid reading since startup. Log: `[WARMUP] waiting for: ...`. This prevents a false leak when the first downstream sensor reports before the others.
* **Freshness.** A sensor whose last valid reading is older than `STALE_AFTER_SEC` is stale. While any required sensor is stale the ΔQ decision is skipped and the breach counter resets (`[SENSOR_STALE] ...`). **A stale sensor never closes the valve.** The quota check continues because volume is cumulative.
* **Evaluation tick and debounce.** Decisions run on a timer (`EVAL_INTERVAL_SEC`), not on every message. A leak (`ΔQ > threshold`) must hold for `BREACH_CONSECUTIVE` ticks. A quota breach needs no debounce. Leak takes precedence over quota.
* **Volume by real time.** `volume += cleaned/60 * dt`, `dt` = seconds since the previous upstream reading, capped at `STALE_AFTER_SEC`.
* **Close first.** On a confirmed breach the aggregator sets its local lock, **immediately** publishes `CLOSE_VALVE`, and only then queues the chain write. Chain problems never delay the valve and never unlock it.
* **Single chain writer.** One provider, one wallet and one serial queue, sending legacy transactions (`type 0, gasPrice 0`, like `chain-client/chain.js`). Breach writes retry until confirmed (backoff 5 s to 60 s, 60 s confirmation timeout, a transaction still in the pool is waited for, never sent twice). Snapshots are not retried. A rollover checks the chain before every attempt (see Daily rollover).
* **4-minute snapshots.** Averages of upstream, downstream and ΔQ over the window (only warm and fresh ticks) plus the current volume go to `WaterTelemetryLog`. An empty window is skipped. `TooSoon` is only logged. In dry run the payload is logged.
* **Chain poll (every `CHAIN_POLL_SEC`, and at startup).** Reads `sectorRegistry`, `leakThreshold`, `dayOffsetSeconds`, `dayLengthSeconds` and `manualDayShift`. The on-chain quota and threshold replace the `.env` values (each change is logged). If the RPC is down or the sector is missing, the `.env` values are used.
* **Owner reset sync.** If the aggregator is locked, its breach write is confirmed (`chainLogged`), the chain was seen reporting the valve closed, and the chain now reports it open, the owner has run `reset-sector.js`. The aggregator publishes `OPEN_VALVE` (`OWNER_RESET`) and clears lock, volume and breach counter. It never does this while the breach write is still pending.
* **Daily rollover.** A day is `DAY_LENGTH_SECONDS` long (600 s, so a day passes every 10 minutes). `todayIndex = floor((now + dayOffsetSeconds) / dayLengthSeconds) + manualDayShift`, the same formula as the contract, with all three values taken from the chain. When it grows (by the clock, or because the owner ran `advance-day`), local volume and the snapshot window reset immediately and a rollover is queued. Before sending anything the aggregator **reads the sector's stored `quotaDay` from the chain**: if it already reached the new day (the owner rolled it over, or an earlier attempt landed) the rollover counts as **done** and nothing is sent. Otherwise it sends `rolloverQuotaDay`. If the chain refuses while its stored day is still behind (the chain clock has not reached the new day, a few seconds of skew) it retries every 15 s and stops as soon as the stored day catches up; an RPC failure retries every 60 s. After a rollover is confirmed or found done, a **quota** lock is released with `OPEN_VALVE` (`DAILY_ROLLOVER`). A **leak** lock stays until the owner resets. The valve never reopens without the chain showing the new day. In dry run the same logic runs locally.
* **`OPEN_VALVE` on MQTT** (for example the Node-RED button) clears the lock, volume and breach counter locally and writes **nothing** to the chain. If the chain still says closed, a warning tells you to run `reset-sector.js`. The aggregator's own `OPEN_VALVE` messages come back on its subscription and are ignored.
* **State file.** `STATE_DIR/<SECTOR_ID>.json` (atomic write, every 10 s and after changes) keeps the day index and the day clock last seen on the chain, volume, lock, close cause, `chainLogged` and any pending breach payload. On restart it is reloaded if it is from today, so a restart does not erase quota usage or the lock. A restored lock re-publishes `CLOSE_VALVE` as soon as MQTT connects. Delete the file only if you want to forget the lock.

---

## 4. MQTT messages (unchanged topics)

| Topic | Direction | Payload |
| :--- | :--- | :--- |
| `sensor/flow` | sensor to aggregator | `{"node_id":"Sector_B","flow_rate":20.0}` |
| `actuation/valve` | aggregator to relay | `{"command":"CLOSE_VALVE","reason":"ANOMALY_DETECTED"}` or `"QUOTA_EXCEEDED"` |
| `actuation/valve` | aggregator or operator | `{"command":"OPEN_VALVE"}`, optionally with `"reason":"OWNER_RESET"` or `"DAILY_ROLLOVER"` |

The leak reason is `ANOMALY_DETECTED` everywhere (MQTT and on-chain). It was never `LEAK_DETECTED`.

---

## 5. Test 1: dry run on one laptop (`DRY_RUN=true`)

Make sure `.env` has `DRY_RUN=true`, `SECTOR_ID=Sector_B`, `EXPECTED_DOWNSTREAM=Sector_B`. Open four PowerShell windows.

**1. Broker** (see `..\broker\README.md`)

```powershell
cd broker
mosquitto -c mosquitto.conf -v
```

**2. Watch the valve topic**

```powershell
mosquitto_sub -h 127.0.0.1 -p 1883 -t "actuation/valve" -v
```

**3. Aggregator**

```powershell
cd middleware
node aggregator.js
```

**4. Inject readings.** Better, import `simulation/flows.json` into Node-RED and use its buttons. By hand:

```powershell
# Warm-up: only the upstream sensor has reported.
'{"node_id":"Upstream_Master","flow_rate":20.0}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s
```

Expect `[WARMUP] waiting for: Sector_B` and no valve command.

```powershell
# Normal flow: both sensors. Repeat every 2 s (Node-RED does this for you).
'{"node_id":"Sector_B","flow_rate":20.0}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s
```

Expect `[TELEMETRY] ... DeltaQ=0.00` once per tick and no alert.

```powershell
# Pipe burst: hold the low reading for 8 s (2.0 L/min every 0.5 s).
1..16 | ForEach-Object { '{"node_id":"Sector_B","flow_rate":2.0}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s; Start-Sleep -Milliseconds 500 }
```

> **Why a loop and not one message?** The leak must now hold for 2 ticks (about 4 s). If the Node-RED repeater is running, a single 2.0 reading is smoothed away by the next 20.0 reading within 2 s, so one click on `INJECT PIPE BURST` does **not** trigger a leak (tested). Hold the reading as above, or disable the `Sector_B Normal` injector first (then one 2.0 reading stays until the sensor goes stale after 10 s). Whenever this guide says "trigger a burst", it means a held burst.

Expect, after the leak has held for 2 ticks (about 4 s), `CLOSE_VALVE` in window 2:

```text
actuation/valve {"command":"CLOSE_VALVE","reason":"ANOMALY_DETECTED"}
```

and `[DRY RUN] Skipping blockchain transaction`.

```powershell
# Corrupt spike: must be filtered and must not trigger anything.
'{"node_id":"Upstream_Master","flow_rate":999}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s
```

Expect `[FILTERED] Dropped invalid reading`.

**Re-arm** after a shutoff, without restarting:

```powershell
'{"command":"OPEN_VALVE"}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "actuation/valve" -s
```

Also try: stop publishing `Sector_B` for 10+ s and watch `[SENSOR_STALE] Sector_B` (no valve action), then resume (`[SENSOR_STALE] clear`).

---

## 6. Going live (runbook, per laptop)

Do this after the contracts are deployed (`..\hydro-contracts\README.md`, steps on laptop A).

1. In `.env` set `SECTOR_ID`, `RPC_URL` (**laptop A = 8546**), `PRIVATE_KEY` (this laptop's reporter), `CONTRACT_ADDRESS`, `TELEMETRY_CONTRACT_ADDRESS`, `EXPECTED_DOWNSTREAM`. **Keep `DRY_RUN=true` first** and repeat Test 1.
2. Start order: Tailscale (only if the optional Tailscale broker listener is used), Besu node, Mosquitto, Node-RED, `node aggregator.js`.
3. **Go live:** set `DRY_RUN=false` and restart. Expect `[CHAIN] Reporter 0x... via http://...` and no `using .env fallback` line.
4. **First breach:** trigger a (held) burst on Sector_B, see Test 1. Expect `CLOSE_VALVE` first, then `[CHAIN] Breach submitted`, then `[CHAIN] Breach confirmed`. Then, from any laptop's `hydro-contracts`:

   ```powershell
   node scripts/admin/read-sector.js Sector_B
   ```

   It must show `isValveClosed true`, `closeCause 1 (leak)` and a `SectorAlert ... ANOMALY_DETECTED`. Check it from the other laptops too (their local node must show the same block).
5. **Owner reset** (laptop A): `node scripts/admin/reset-sector.js Sector_B`. Within about 30 s laptop B logs `[CHAIN] Owner reset observed` and publishes `OPEN_VALVE` (`OWNER_RESET`).
6. **Quota demo** (laptop A): `node scripts/admin/set-quota.js Sector_B 50`. Within about 30 s the aggregator logs `[CHAIN] dailyQuotaLimit ... -> 50`. At 20 L/min the breach (`QUOTA_EXCEEDED`) comes after about 150 s.
7. **Halt test:** stop laptop A's containers (the chain loses quorum, 2 of 4 validators gone). Trigger a burst on Sector_B. The valve must close **immediately** and the aggregator keeps ticking. Restart laptop A's containers: the queued write must land (`[CHAIN] Breach confirmed`).

   > Never run `docker compose down -v`. It deletes the chain data.

---

## 7. Verify on first live run

1. **Unfunded wallets can send.** The first write from a fresh reporter wallet must be mined (zero-gas legacy transaction, `gasPrice: 0`).
2. **Pending transactions are visible.** While the chain is halted, `eth_getTransactionByHash` on the local Besu node must return the queued transaction (the retry logic relies on it to avoid sending twice). If it does not, a resend with the same nonce happens, which is also safe.
3. **Reverts are recognised.** A write from a removed reporter should log `Breach reverted ... Retry in 5s` (Besu returns "execution reverted"). If Besu words it differently the log will say `error` instead; the retry behaviour is the same.
4. **Clock.** The aggregator uses the laptop clock for the day index, the contract uses `block.timestamp`. Keep Windows time synced. A few seconds of skew only delays the rollover (it retries every 15 s until the chain reaches the new day).
5. **Node-RED button.** `RESET / OPEN VALVE` still works and prints the `[RESET]` line.
6. **QBFT empty blocks.** Confirm that confirmations arrive within a few seconds when blocks are being mined (empty blocks only appear hourly, which only matters for timestamps).

---

## 8. Files

| Path | Notes |
| :--- | :--- |
| `aggregator.js` | The service |
| `.env.example` | Template. Copy to `.env` |
| `state/` | Runtime state, gitignored |
| `.env`, `state/` | Never commit. `.env` holds a private key |
