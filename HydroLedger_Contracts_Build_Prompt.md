## 0. Your role and ground rules

You are a senior engineer (Solidity, Hardhat, Node.js, MQTT, Hyperledger Besu). Your friend was supposed to perform this task, but he stopped half way, the files he modified can be seen in the ss, most notibly, hydro-contracts.zip, which is entirely his creation. Kindly complete his work. Below are the instructions he was given:

1. **Read every files first.** Then compare them with section 2 of this document. If a file contradicts this document, list the contradiction at the top of your answer, state the assumption you made, and continue.
2. **You cannot run a Besu node.** Make the code correct by reasoning, and cover the contracts with Hardhat tests (they run on the in-process Hardhat network). Anything you cannot verify without the real chain must go into a short list titled **"Verify on first live run"**.
3. **Do not change:**
   - the Besu setup (genesis, compose, keys, ports, firewall rules)
   - the MQTT topics (`sensor/flow`, `actuation/valve`) and their JSON payload formats
   - `chain-client/chain.js`
   - the Node-RED `simulation/flows.json` (see section 9 for the only optional additions)
4. **Language and tooling:** keep everything CommonJS JavaScript (no TypeScript, no ESM, no new frameworks that might contradict the London EVM fork). Use **ethers v6**. The user works on **Windows with PowerShell**, so write all commands in PowerShell syntax.
6. **No external Solidity libraries.** Do not import OpenZeppelin. Write the small access-control pieces yourself, because the chain only supports the London EVM fork.
7. Finish with a **`CHANGES.md`** that explains everything that changed from the current implementation (it must cover section 10 in full).

---

## 1. Goal

A private water-management network. ESP32 flow sensors, simulated for now by Node-RED, publish readings over MQTT to a Node.js middleware (the "aggregator"). The aggregator filters and smooths the data, detects leaks and quota breaches, closes a sector's master valve over MQTT, and writes an audit record to a Besu blockchain through smart contracts.

Build:
- **Two smart contracts:** `WaterQuotaRegistry` (sector state, alerts, quotas, access control) and `WaterTelemetryLog` (a snapshot every 10 minutes).
- **A Hardhat project** that compiles, tests and deploys them to our chain.
- **A wallet scheme:** one owner wallet and one reporter wallet per sector.
- **Aggregator changes** so it works with the contracts and fixes the problems listed in section 2.4.
- **Broker and README changes**, plus a deployment runbook.

---

## 2. The current system (as-is)

### 2.1 Blockchain

- Hyperledger Besu, **QBFT** consensus, **4 validators**, run as Docker containers (`hyperledger/besu:latest`) on 3 laptops joined by a Tailscale network. Compose project name: `besu-setup`.
- **Chain ID 1338.** `genesis.json` has `londonBlock: 0` and **no later fork** (no Shanghai or Cancun), so contracts **must be compiled with `evmVersion: "london"`** (otherwise PUSH0 and similar opcodes fail).
- `zeroBaseFee: true`, Besu runs with `--min-gas-price=0`, and `alloc` is empty. **Gas is free**, so wallets need no balance. Existing code sends legacy transactions with `type: 0, gasPrice: 0`.
- `blockperiodseconds: 2`, `emptyblockperiodseconds: 3600`. An empty block appears only once an hour, so **the latest block's timestamp can be up to an hour old**. Never use "latest block timestamp" as a clock.
- A block needs 3 of the 4 validators. If laptop A (two validators) goes offline, the chain **halts**. Transactions then never confirm, and `tx.wait()` waits indefinitely.
- JSON-RPC APIs enabled: `ETH,NET,WEB3,QBFT,ADMIN,TXPOOL`. RPC is published **only on each laptop's `127.0.0.1`**, not over Tailscale.
- Data lives in Docker volumes (never run `docker compose down -v`).

| Node / container | Laptop | P2P port | RPC (host, localhost only) | Role in the new design |
|---|---|---|---|---|
| `hydro-node1` | A | 30303 | `127.0.0.1:8545` | Validator and **bootnode only. No sector, no aggregator.** |
| `hydro-node2` | A | 30304 | `127.0.0.1:8546` | Validator, **Sector_A** |
| `hydro-node3` | B | 30303 | `127.0.0.1:8545` | Validator, **Sector_B** |
| `hydro-node4` | C | 30303 | `127.0.0.1:8545` | Validator, **Sector_C** |

Laptop A's compose runs two services (profile `two`). Laptops B and C run one. **Sector_A's aggregator must therefore use `RPC_URL=http://127.0.0.1:8546`** (node2). Sector_B and Sector_C use `http://127.0.0.1:8545`.

### 2.2 `chain-client/chain.js`

A small ethers v6 tool: `send <json>` puts JSON in the `data` field of a zero-value self-transaction (legacy type 0, gasPrice 0), `read <txHash>` reads it back, and `status` shows the block number, peers and validators. It uses `RPC_URL` (default `http://127.0.0.1:8545`) and chain ID 1338. It does not touch smart contracts, and it stays as it is.

### 2.3 Simulation stack

- **Node-RED** (`simulation/flows.json`, tab "HydroLedger Grid Simulation") publishes JSON `{"node_id": "...", "flow_rate": <L/min>}` to `sensor/flow` through a Mosquitto broker at `127.0.0.1:1883`.
  - Repeating injectors every 2 s: `Upstream_Master` at 20.0 and `Sector_B` at 20.0.
  - One-shot injectors: pipe burst (`Sector_B` = 2.0), corrupt spike (`Upstream_Master` = 999), and "RESET / OPEN VALVE" (publishes `{"command":"OPEN_VALVE"}` to `actuation/valve`).
  - It also subscribes to `actuation/valve` and shows it in the Debug sidebar.
- **Mosquitto** (`broker/mosquitto.conf`): `listener 1883 0.0.0.0`, `allow_anonymous true`. The broker README opens Windows Firewall port 1883 with `-Profile Any`.
- **Topics:** `sensor/flow` (sensors to aggregator), `actuation/valve` (aggregator to ESP32 relay: `{"command":"CLOSE_VALVE","reason":"..."}`).
- **`middleware/aggregator.js`** (Node.js, deps `mqtt`, `ethers`, `dotenv`) currently does the following:
  1. Subscribes to `sensor/flow` and `actuation/valve`.
  2. Drops a reading if `node_id` is missing, `flow_rate` is NaN, `< 0` or `>= 500` (log `[FILTERED]`).
  3. Applies a per-node EMA with `ALPHA = 0.7`: `cleaned = 0.7*new + 0.3*previous`, initialised to the first value.
  4. `Upstream_Master` sets `upstreamFlow` and adds `cleaned/60*2` litres to `dailyVolumeUsed` (it assumes exactly a 2-second period). Any other `node_id` goes into `downstreamSensors[node_id]`. The map starts as `{Sector_B: 0}` (hard-coded).
  5. On every accepted reading it runs `runMassBalanceCheck` (skipped until some downstream sensor has reported once): `deltaQ = upstream - sum(downstream)`. A leak is `deltaQ > LEAK_THRESHOLD` (float, 5.0). Otherwise a quota breach is `dailyVolumeUsed > DAILY_QUOTA_LIMIT` (float, 5000). The reason strings are `ANOMALY_DETECTED` and `QUOTA_EXCEEDED`.
  6. `handleBreach` fires once (lock `alertDispatched`). It scales values by 100 with `Math.round` (deltaQ clamped at 0 or above) and calls `updateSectorState(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)` through a **new JsonRpcProvider, Wallet and Contract created on every call**. The sector ID is `ethers.encodeBytes32String(SECTOR_ID)`. It does `await tx.wait()` and only **then** publishes `CLOSE_VALVE`. On an error it clears the lock (the valve stays open). With `DRY_RUN=true` it skips the chain and publishes `CLOSE_VALVE` immediately.
  7. On `actuation/valve` with `{"command":"OPEN_VALVE"}` it clears the lock and sets `dailyVolumeUsed = 0` (this is the only time volume resets).
  8. `.env`: `DRY_RUN, MQTT_BROKER_URL, RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, SECTOR_ID, LEAK_THRESHOLD=5.0, DAILY_QUOTA_LIMIT=5000`. One sector per process.
- READMEs in `middleware/`, `broker/` and `simulation/` describe a **two-laptop** setup (Val_A / Val_B). They are out of date for our 3-laptop chain.

### 2.4 Known problems in the current implementation (to be fixed)

| # | Problem |
|---|---|
| P1 | **Safety:** in live mode the valve closes only after `tx.wait()`. If the chain halts, the valve never closes. |
| P2 | The chain only gets breach events. There is no regular telemetry record. |
| P3 | No way to reopen a sector on-chain, and no daily rollover. Volume resets only on `OPEN_VALVE` and is lost on a restart. |
| P4 | **Startup race:** the first downstream sensor to report makes the sum look too low and can trigger a false leak. The hard-coded `Sector_B: 0` hides the problem. |
| P5 | No sensor freshness. A silent sensor keeps its last value forever. |
| P6 | Volume assumes a 2-second period. |
| P7 | A new provider and wallet are created per breach. Two simultaneous transactions from one key can clash on the nonce. |
| P8 | The thresholds and quota live only in `.env` (and, as designed by the teammate, would be duplicated inside the contract). |
| P9 | The MQTT reason is `ANOMALY_DETECTED`, but the middleware README says `LEAK_DETECTED`. |
| P10 | The broker is open to every network interface with anonymous access. |
| P11 | `PRIVATE_KEY` is described as a "validator key". Node keys must not be reused as application wallets. |

---

## 3. Target architecture (to-be)

```
 Node-RED / ESP32 (per laptop)
        | MQTT sensor/flow  {"node_id","flow_rate"}
        v
 Mosquitto (per laptop, localhost-only)
        v
 aggregator.js (one per laptop = one sector)
   filter -> EMA -> warm-up gate -> freshness -> dQ -> debounce
        |                                   |
        | (1) FIRST: MQTT actuation/valve   | (2) THEN, queued, retried:
        |     CLOSE_VALVE                   |     chain writes with this laptop's reporter wallet
        v                                   v
   ESP32 relay (sector master valve)   local Besu node RPC -> QBFT -> all 4 validators
                                            WaterQuotaRegistry   (alerts, state, quota, roles)
                                            WaterTelemetryLog    (10-minute snapshots)
```

| Sector | Laptop | Node used for RPC | Aggregator `RPC_URL` | Reporter wallet |
|---|---|---|---|---|
| `Sector_A` | A | `hydro-node2` | `http://127.0.0.1:8546` | `reporterA` |
| `Sector_B` | B | `hydro-node3` | `http://127.0.0.1:8545` | `reporterB` |
| `Sector_C` | C | `hydro-node4` | `http://127.0.0.1:8545` | `reporterC` |

`hydro-node1` is a validator and bootnode only.

Hardhat is run **from laptop A**. The owner wallet lives there too, and it deploys to a laptop-A node (`http://127.0.0.1:8545` is fine).

**What the contract does and does not do:** a smart contract cannot talk to MQTT or a valve. The aggregator closes the valve physically. The contract re-checks the thresholds on-chain, sets `isValveClosed` and emits `SectorAlert`, which gives a tamper-proof audit record. **Closing a valve never waits for the chain. Reopening does.**

---

## 4. Final design decisions (already agreed, do not re-open)

1. Solidity **0.8.24**, `evmVersion: "london"`, optimizer on, **chain ID 1338**, no OpenZeppelin.
2. All flow rates and volumes are **scaled ×100** off-chain. Leak threshold **500** means 5.00 L/min. This was confirmed with the teammate.
3. Leak reason string is **`"ANOMALY_DETECTED"`** (MQTT and on-chain). The quota reason is **`"QUOTA_EXCEEDED"`**.
4. The `SectorState` struct and `updateSectorState` signature stay **exactly** as below, so the aggregator's ABI keeps working.
5. Access control: **one owner** plus **reporter wallets**. Each reporter is bound to **exactly one sector** and can write only that sector.
6. The quota and leak threshold are stored on-chain and changed by the owner. The aggregator reads them from the chain (`.env` values are only a fallback).
7. Reset is by the owner. Daily rollover is done by the sector's reporter. Leak closures need an owner reset. Quota closures clear at the next day.
8. Regular telemetry goes to a **separate** contract, `WaterTelemetryLog`, every 10 minutes.
9. Sensor startup uses a **warm-up gate** (section 8).
10. Gas is free, so wallets are never funded.
11. Brokers are per laptop and localhost-only for now.

---

## 5. Deliverable A: Smart contracts

Create `contracts/WaterQuotaRegistry.sol` and `contracts/WaterTelemetryLog.sol` (pragma `0.8.24`, SPDX MIT). Use custom errors and short NatSpec comments.

### 5.1 `WaterQuotaRegistry`

**Storage**

```solidity
struct SectorState {            // exact order, as specified by the teammate
    uint256 upstreamFlowRate;   // scaled x100
    uint256 downstreamFlowRate; // sum of outlets, scaled x100
    uint256 deltaQ;             // scaled x100
    uint256 dailyVolumeUsed;    // litres x100
    uint256 dailyQuotaLimit;    // litres x100
    bool    isValveClosed;
    uint256 lastUpdated;        // block.timestamp
}
mapping(bytes32 => SectorState) public sectorRegistry;
```

Additional state, kept **outside** the struct:
- `address public owner;`
- `uint256 public leakThreshold = 500;` (scaled, default 5.00 L/min)
- `uint256 public dayOffsetSeconds;` (default 0 means UTC days, must be below 86400)
- `mapping(bytes32 => bool) public sectorExists;`
- `mapping(address => bytes32) public reporterSector;` (`bytes32(0)` means not a reporter)
- `mapping(bytes32 => uint8) public closeCause;` (0 none, 1 leak, 2 quota)
- `mapping(bytes32 => uint256) public quotaDay;` (day index of the last rollover)

**Events** (exact signature for the first one)

```solidity
event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp); // "ANOMALY_DETECTED" | "QUOTA_EXCEEDED"
event SectorAdded(bytes32 indexed sectorId, uint256 quotaLimit);
event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp);
event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp);
event QuotaChanged(bytes32 indexed sectorId, uint256 oldQuota, uint256 newQuota, uint256 timestamp);
event LeakThresholdChanged(uint256 oldValue, uint256 newValue);
event DayOffsetChanged(uint256 oldValue, uint256 newValue);
event ReporterAdded(address indexed reporter, bytes32 indexed sectorId);
event ReporterRemoved(address indexed reporter, bytes32 indexed sectorId);
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
```

**Functions**

| Function | Who | Behaviour |
|---|---|---|
| `constructor()` | deployer | `owner = msg.sender` |
| `addSector(bytes32 id, uint256 quota)` | owner | `id != 0`, must not exist, `quota > 0`. Creates the sector (valve open, `lastUpdated = now`), sets `quotaDay = currentDay()`. |
| `setSectorQuota(bytes32 id, uint256 newQuota)` | owner | Sector must exist, `newQuota > 0`. Emits `QuotaChanged`. |
| `setLeakThreshold(uint256 v)` | owner | `v > 0`. Emits `LeakThresholdChanged`. |
| `setDayOffsetSeconds(uint256 v)` | owner | `v < 86400` |
| `addReporter(address r, bytes32 id)` | owner | Sector exists, `r != 0`, `r` is not already a reporter. Several reporters per sector are allowed, one sector per reporter. |
| `removeReporter(address r)` | owner | Clears the mapping, emits an event. |
| `transferOwnership(address n)` | owner | `n != 0` |
| `updateSectorState(bytes32 id, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)` | reporter of **that** sector | See the logic below. |
| `rolloverQuotaDay(bytes32 id)` | reporter of that sector, or owner | Requires `currentDay() > quotaDay[id]`. Sets `quotaDay = currentDay()` and `dailyVolumeUsed = 0`. If the valve is closed with `closeCause == 2` it reopens, sets `closeCause = 0` and `valveReopened = true`. A leak closure stays closed. Emits `DailyRollover`. |
| `resetSector(bytes32 id)` | owner | Valve open, `dailyVolumeUsed = 0`, `closeCause = 0`, `lastUpdated = now`. Emits `SectorReset`. |
| `currentDay() view` | anyone | `(block.timestamp + dayOffsetSeconds) / 1 days` |
| `isReporter(address) view` | anyone | `reporterSector[a] != bytes32(0)` |

**`updateSectorState` logic (in this order)**

1. Require `sectorExists[id]` and `reporterSector[msg.sender] == id`.
2. **Compute ΔQ safely**: `computed = upstream > downstream ? upstream - downstream : 0`. **Store `computed`.** The passed `deltaQ` parameter is kept only so the ABI stays compatible with the aggregator, and it is ignored. (The aggregator's rounded value can differ by 1 from the recomputed one, so do not require equality.)
3. **Ignore the passed `dailyQuotaLimit`**. Use the stored `sectorRegistry[id].dailyQuotaLimit` (set by the owner). Keep the parameter for ABI compatibility.
4. Store the upstream, downstream, computed deltaQ and `dailyVolumeUsed` values and set `lastUpdated = block.timestamp`. (`dailyVolumeUsed` is trusted from the reporter, so note that limitation in a comment.)
5. If the valve is **already closed**, stop here. No re-alert, and no change of cause.
6. If `computed > leakThreshold`: close the valve, `closeCause = 1`, emit `SectorAlert(id, "ANOMALY_DETECTED", block.timestamp)`. **Leak takes precedence** over quota, as in the aggregator.
7. Else if `dailyVolumeUsed > stored quota`: close the valve, `closeCause = 2`, emit `SectorAlert(id, "QUOTA_EXCEEDED", block.timestamp)`.
8. Otherwise leave `isValveClosed` unchanged. It is **never auto-opened** here.

The contract never actuates hardware. Add a comment saying so.

### 5.2 `WaterTelemetryLog`

```solidity
interface IWaterQuotaRegistry {
    function reporterSector(address) external view returns (bytes32);
    function owner() external view returns (address);
}
event SnapshotRecorded(bytes32 indexed sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate,
                       uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp);
struct Snapshot { uint256 upstreamFlowRate; uint256 downstreamFlowRate; uint256 deltaQ;
                  uint256 dailyVolumeUsed; uint256 timestamp; }
mapping(bytes32 => Snapshot) public latestSnapshot;
mapping(bytes32 => uint256) public snapshotCount;
```

- `constructor(address registry, uint256 minIntervalSeconds)` (the deploy default is **540**, slightly under 10 minutes so timer drift does not cause rejections).
- `recordSnapshot(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed)`:
  - Only a reporter whose `registry.reporterSector(msg.sender) == sectorId`.
  - Reject if `block.timestamp < latestSnapshot[id].timestamp + minInterval` (custom error `TooSoon`).
  - Range check: the three flow values must each be `<= 50000` (scaled, 500 L/min). `dailyVolumeUsed` is not capped.
  - Store the snapshot, increment the count and emit `SnapshotRecorded`.
- `setMinInterval(uint256)`, callable only by `registry.owner()`.
- Not connected to valve logic. History lives in events. Storage holds only the latest snapshot per sector.

---

## 6. Deliverable B: Hardhat project (`hydro-contracts/`)

**Purpose:** compile and test the contracts, deploy them once to our Besu chain from laptop A, and provide admin scripts (owner actions). The aggregators do not use Hardhat. They only need the deployed addresses and an ABI, which is a minimal human-readable ABI inside `aggregator.js`.

```
hydro-contracts/
  package.json            (Hardhat 2.x with a matching hardhat-toolbox for ethers v6, dotenv. Pin exact versions. Do NOT use Hardhat 3.)
  hardhat.config.js
  .env.example   .gitignore   (ignore .env, wallets.local.json, deployments/*.local.json, node_modules)
  contracts/WaterQuotaRegistry.sol  contracts/WaterTelemetryLog.sol
  test/registry.test.js  test/telemetry.test.js
  scripts/make-wallets.js  scripts/deploy.js
  scripts/admin/set-quota.js  scripts/admin/reset-sector.js  scripts/admin/read-sector.js
  deployments/besu.json   (written by deploy.js)
  README.md
```

**`hardhat.config.js`**
- `solidity: { version: "0.8.24", settings: { evmVersion: "london", optimizer: { enabled: true, runs: 200 } } }`
- `networks.besu = { url: process.env.RPC_URL || "http://127.0.0.1:8545", chainId: 1338, accounts: [OWNER_PRIVATE_KEY], gasPrice: 0 }`
- `networks.hardhat = { hardfork: "london", initialBaseFeePerGas: 0 }`, so tests match the real chain.

**`.env.example`**: `OWNER_PRIVATE_KEY`, `RPC_URL`, `REPORTER_ADDRESS_A/B/C`, `INITIAL_QUOTA_LITERS_A/B/C` (default 5000), `MIN_SNAPSHOT_INTERVAL_SECONDS=540`.

**`scripts/deploy.js`** (run with `npx hardhat run scripts/deploy.js --network besu`):
1. Deploy `WaterQuotaRegistry`.
2. Call `addSector` for `Sector_A`, `Sector_B`, `Sector_C`. The IDs are `ethers.encodeBytes32String(...)`, and the quota is `INITIAL_QUOTA_LITERS_X * 100`.
3. Call `addReporter(REPORTER_ADDRESS_X, sectorX)` for each.
4. Deploy `WaterTelemetryLog(registryAddress, MIN_SNAPSHOT_INTERVAL_SECONDS)`.
5. Write `deployments/besu.json` (chain ID, both addresses, deployer, block number, sector IDs). Print ready-to-paste `.env` lines for each laptop (`CONTRACT_ADDRESS`, `TELEMETRY_CONTRACT_ADDRESS`).
6. Wait for each transaction to be mined. Use legacy transactions (gasPrice 0).

**Admin scripts** (owner wallet, network `besu`):
- `set-quota.js <sectorName> <liters>` calls `setSectorQuota(id, liters*100)`.
- `reset-sector.js <sectorName>` calls `resetSector`. It **does not touch MQTT**. The sector's aggregator notices the on-chain reopen and opens its valve itself (section 8, item 10).
- `read-sector.js <sectorName>` prints `sectorRegistry`, `closeCause`, `quotaDay`, `latestSnapshot`, `snapshotCount` and the recent `SectorAlert`, `SectorReset`, `DailyRollover` and `SnapshotRecorded` events (`queryFilter`).

**Tests** (Hardhat network, chai) must cover:
- only the owner can call the admin functions
- a reporter can write only its own sector, and an unknown sector or reporter reverts
- ΔQ is computed safely (downstream greater than upstream gives 0, no revert)
- the passed deltaQ and quota are ignored
- a leak closes the valve with reason `ANOMALY_DETECTED`, and a quota breach with `QUOTA_EXCEEDED`
- leak takes precedence over quota
- the alert is emitted only on the open-to-closed transition
- a normal update never opens a closed valve
- `resetSector` and `rolloverQuotaDay` (using `time.increase`): quota closure reopens, leak closure stays closed, the same-day call reverts
- quota and threshold changes take effect
- `removeReporter` blocks later writes
- telemetry: `TooSoon`, the range check, the wrong-sector reporter, and `setMinInterval` access

---

## 7. Deliverable C: Wallets

A wallet here is an Ethereum account (a private key and its address). The contract identifies callers by address only (not by IP).

| Wallet | Lives on | Purpose |
|---|---|---|
| `owner` | Laptop A (Hardhat project `.env`) | Deploys and administers: sectors, reporters, quota, threshold, reset. **Back up this key.** Losing it means losing admin rights. |
| `reporterA` | Laptop A (Sector_A aggregator `.env`) | Writes Sector_A only |
| `reporterB` | Laptop B | Writes Sector_B only |
| `reporterC` | Laptop C | Writes Sector_C only |

- `scripts/make-wallets.js` creates the four wallets with `ethers.Wallet.createRandom()`. It writes `wallets.local.json` (gitignored) and prints, for each wallet, the address and exactly which `.env` file the private key belongs in.
- Never reuse `besu-net/nodeN/key`. Those are validator identities.
- Gas is free, so there is nothing to fund. If a reporter is compromised, the owner calls `removeReporter`. No chain rebuild is needed.
- **Optional (only if simple):** let the aggregator load an encrypted keystore (`KEYSTORE_PATH` and `KEYSTORE_PASSWORD`) as an alternative to `PRIVATE_KEY`.

---

## 8. Deliverable D: `middleware/aggregator.js` changes

Keep what works: MQTT topics and payloads, the filter (`<0` or `>=500` is dropped), EMA with `ALPHA = 0.7` per node, `DRY_RUN` semantics (**no RPC calls at all** in dry run), and CommonJS. Restructure the file as needed. Required behaviour:

1. **Config and validation at startup.** Fail fast with a clear message if a required variable is missing: `SECTOR_ID`, `EXPECTED_DOWNSTREAM` (comma list, at least one), and in live mode `RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS`, `TELEMETRY_CONTRACT_ADDRESS`. Sector ID on-chain is `encodeBytes32String(SECTOR_ID)`.
2. **Sensor intake.** `UPSTREAM_NODE_ID` (default `Upstream_Master`) is the inlet sensor. Every other `node_id` must be listed in `EXPECTED_DOWNSTREAM`. Unlisted IDs are ignored, with a one-time `[UNEXPECTED_NODE]` log. Remove the hard-coded `Sector_B: 0`. Store `{value, timestamp}` per node.
3. **Warm-up gate (agreed).** Make no leak or quota decision until the upstream sensor **and every** expected downstream sensor have each delivered at least one valid reading since startup. Log `[WARMUP] waiting for: ...` (rate-limited). This fixes P4.
4. **Freshness.** A sensor is stale if its last valid reading is older than `STALE_AFTER_SEC` (default 10). While any required sensor is stale, skip the ΔQ decision, reset the breach counter, and log `[SENSOR_STALE]` once per change of state. **A stale sensor never closes the valve.** The quota check continues because volume is cumulative.
5. **Fixed evaluation tick and debounce.** Evaluate on a timer every `EVAL_INTERVAL_SEC` (default 2) instead of on every message. A leak is `deltaQ > leakThreshold` (float L/min). It must hold for `BREACH_CONSECUTIVE` consecutive ticks (default 2) before acting. The quota breach (`volume > quota`) needs no debounce. Leak takes precedence over quota. Keep the `[TELEMETRY]` log line, once per tick.
6. **Volume integration by real time.** On each fresh upstream reading, `volume += cleaned/60 * dt`, where `dt` is the seconds since the previous upstream reading, capped at `STALE_AFTER_SEC` (first reading: `dt = 0`). This replaces the fixed `*2`.
7. **Close the valve first.** On a confirmed breach: set the local lock, **immediately** publish `{"command":"CLOSE_VALVE","reason":"ANOMALY_DETECTED"|"QUOTA_EXCEEDED"}`, and only then enqueue the chain write. Chain failures **never** unlock the lock or delay the valve. This fixes P1 and P9.
8. **Single chain writer.** Create **one** provider, wallet and contract at startup and send every transaction through one serial queue (this fixes P7), with overrides `{ type: 0, gasPrice: 0 }` (the same as `chain-client/chain.js`). Retry policy:
   - **Breach writes:** retry until confirmed (backoff 5 s up to 60 s). Use a confirmation timeout (60 s) so a halted chain never blocks the process.
   - **Snapshots:** no retry. Skip and try again at the next interval.
   - **Rollover:** retry every minute.
   After the breach transaction confirms, set `chainLogged = true`.
9. **10-minute snapshots.** Every `SNAPSHOT_INTERVAL_MIN` (default 10), call `WaterTelemetryLog.recordSnapshot` with the **averages over the window** of upstream, downstream and ΔQ (ΔQ clamped at 0 or above, ×100, `Math.round`) plus the current `dailyVolumeUsed` ×100. Accumulate only on ticks where the sensors were warm and fresh. Skip the snapshot if the window is empty. A `TooSoon` revert only gets logged. In `DRY_RUN`, log the payload instead.
10. **Chain config poll and sync** (every `CHAIN_POLL_SEC`, default 30, and at startup). Read `sectorRegistry(sectorId)`, `leakThreshold()` and `dayOffsetSeconds()`. Use the on-chain `dailyQuotaLimit/100` and `leakThreshold/100` instead of `.env` (the `.env` values are only the fallback if the RPC is down or the sector is missing; log every change). **Owner reset sync:** if the aggregator is locked **and** `chainLogged` is true **and** the chain now reports `isValveClosed == false`, the owner has reset the sector. Publish `{"command":"OPEN_VALVE","reason":"OWNER_RESET"}`, clear the lock, volume and breach counter. Never act on this while the breach write is still pending (`chainLogged` false).
11. **Daily rollover.** Each tick, compute `todayIndex = floor((nowSeconds + dayOffsetSeconds) / 86400)`. If it is greater than the stored day index, reset the **local** volume and snapshot window straight away (accounting is local). In live mode, enqueue `rolloverQuotaDay(sectorId)`. When it succeeds and the lock was caused by a **quota** breach, publish `OPEN_VALVE` with reason `DAILY_ROLLOVER` and unlock. A **leak** lock stays. If the transaction reverts because of clock skew, retry later. The valve never reopens without a successful chain confirmation. In `DRY_RUN` apply the same logic locally.
12. **`OPEN_VALVE` on MQTT** (including the Node-RED button) keeps its current local effect (clear lock, volume 0, breach counter 0). The aggregator also hears its own `OPEN_VALVE` publishes, and that must be harmless (idempotent). It does **not** write to the chain. If the chain still says closed, log a warning that the owner must run `reset-sector.js`.
13. **Persistence.** Write a small JSON state file (`STATE_DIR/<SECTOR_ID>.json`, atomic write, every 10 s and after changes) with day index, volume, lock, close cause, `chainLogged` and any pending breach payload. On startup, reload it if its day index is today (otherwise start the new day). This prevents a restart from erasing the quota usage or the lock.
14. **ABI** (human-readable): `updateSectorState` (unchanged 6 arguments), `rolloverQuotaDay(bytes32)`, the full `sectorRegistry(bytes32)` getter (7 outputs), `leakThreshold()`, `dayOffsetSeconds()`, and for the telemetry contract `recordSnapshot(...)`.
15. **Scaling helpers.** Scale ×100 with `Math.round` when sending, and divide by 100 when reading from the chain. One place only.

**`.env.example` (new or changed variables)**

| Variable | Default | Notes |
|---|---|---|
| `DRY_RUN` | `true` | unchanged semantics |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | local broker |
| `RPC_URL` | `http://127.0.0.1:8545` | **Sector_A laptop: `http://127.0.0.1:8546`** (node2) |
| `PRIVATE_KEY` | none | this laptop's **reporter** wallet |
| `CONTRACT_ADDRESS` | none | `WaterQuotaRegistry` |
| `TELEMETRY_CONTRACT_ADDRESS` | none | **new** |
| `SECTOR_ID` | `Sector_A` / `Sector_B` / `Sector_C` | one per laptop |
| `UPSTREAM_NODE_ID` | `Upstream_Master` | **new** |
| `EXPECTED_DOWNSTREAM` | `Sector_B` | **new**, comma list |
| `LEAK_THRESHOLD` | `5.0` | now only the fallback |
| `DAILY_QUOTA_LIMIT` | `5000` | now only the fallback |
| `EVAL_INTERVAL_SEC` | `2` | **new** |
| `STALE_AFTER_SEC` | `10` | **new** |
| `BREACH_CONSECUTIVE` | `2` | **new** |
| `SNAPSHOT_INTERVAL_MIN` | `10` | **new** |
| `CHAIN_POLL_SEC` | `30` | **new** |
| `DAY_OFFSET_SECONDS` | `0` | **new**, fallback if the chain is unreachable |
| `STATE_DIR` | `./state` | **new**, add to `.gitignore` |

---

## 9. Deliverable E: Broker, firewall, simulation and READMEs

**Broker (`broker/mosquitto.conf`)**
- Each laptop runs its **own** broker, Node-RED and aggregator. The sector is self-contained, and sensor names only need to be unique within a laptop.
- Replace the `0.0.0.0` listener with `listener 1883 127.0.0.1` (loopback only, anonymous is acceptable there).
- Add **commented-out, ready-to-enable blocks**, using correct Mosquitto 2.x syntax:
  1. A listener bound to **this laptop's Tailscale IP** (it fails to start if Tailscale is not up yet, so document the start order).
  2. A LAN listener for real ESP32s with `allow_anonymous false`, `password_file`, and an ACL (sensor user: write `sensor/flow`, read `actuation/valve`. Aggregator user: read `sensor/flow`, write `actuation/valve`). Explain `per_listener_settings`.
- Firewall: delete the old open rule (`Remove-NetFirewallRule -DisplayName "Mosquitto MQTT (Port 1883)"`). Loopback needs no rule. For the optional Tailscale listener, show a rule with `-RemoteAddress 100.64.0.0/10`. Real ESP32s are on the Wi-Fi LAN and **not** on Tailscale, so a Tailscale-only broker would lock them out. Explain this in the README.

**MQTT message documentation:** `CLOSE_VALVE` reasons are `ANOMALY_DETECTED` and `QUOTA_EXCEEDED`. `OPEN_VALVE` may carry an optional `reason` (`OWNER_RESET`, `DAILY_ROLLOVER`). The topics and the base payload shapes stay compatible.

**Simulation:** `flows.json` is unchanged and works for Sector_B. For the other laptops, either set `EXPECTED_DOWNSTREAM=Sector_B` (labels are per broker, so nothing breaks), or, **optionally and preferably**, generate `flows.sector-a.json` and `flows.sector-c.json` with a tiny script that renames `Sector_B` to `Sector_A` / `Sector_C` in the inject names and payloads. Remove or mark as legacy the "two-laptop shared broker" mode in the README.

**READMEs to rewrite:** `middleware/README.md` (3-laptop wording, reporter wallets, new env table, new behaviours and test steps, `ANOMALY_DETECTED`), `broker/README.md`, `simulation/README.md` and `hydro-contracts/README.md`.

---

## 10. Current vs. new (to be reproduced in `CHANGES.md`)

| Area | Current | New |
|---|---|---|
| Contracts | none (the ABI is only referenced) | `WaterQuotaRegistry` plus `WaterTelemetryLog` |
| Access | n/a | owner plus reporters, each reporter bound to one sector |
| Thresholds and quota | `.env` only | stored on-chain, changed by the owner. `.env` is the fallback. |
| Leak alert string | MQTT `ANOMALY_DETECTED`, README says `LEAK_DETECTED` | `ANOMALY_DETECTED` everywhere. Quota stays `QUOTA_EXCEEDED`. |
| Valve vs chain | valve closes after `tx.wait()` | valve closes first. The chain write is queued and retried. |
| Reopening | local `OPEN_VALVE` only | owner `resetSector` on-chain. The aggregator syncs and reopens. Quota closures clear at the day change. |
| Daily volume reset | only on `OPEN_VALVE` or restart | day-boundary rollover (contract and aggregator) plus a state file |
| Telemetry on-chain | breach events only | plus a snapshot every 10 minutes (averages) |
| Sensor startup | the first downstream reading can cause a false leak | warm-up gate on `EXPECTED_DOWNSTREAM` |
| Stale sensors | last value kept forever | freshness window. No valve action on loss. |
| Leak trigger | first reading above the threshold | must hold for 2 consecutive ticks (about 4 s) |
| Evaluation | on every message | fixed tick |
| Volume | fixed 2 s per reading | real elapsed time, capped |
| Chain client | new provider and wallet per breach | one shared wallet with a serial queue and `type 0, gasPrice 0` |
| Wallets | "validator key" | owner plus 3 dedicated reporter wallets (made by `make-wallets.js`) |
| Sectors | one hard-coded `Sector_B` | `Sector_A` (node2, laptop A), `Sector_B` (node3, laptop B), `Sector_C` (node4, laptop C). Node1 is not a sector. |
| Broker | `0.0.0.0`, anonymous, firewall open on all profiles | loopback only. Tailscale and LAN blocks documented. Old firewall rule removed. |
| Tooling | none | Hardhat project: compile, test, deploy, admin scripts |
| Unchanged | Besu config, topics, `chain.js`, `flows.json`, filter and EMA | same |

---

## 11. Runbook to include in the READMEs (PowerShell)

1. **Laptop A:** `cd hydro-contracts; npm install; npx hardhat test`. Then `node scripts/make-wallets.js`. Fill `.env` (`OWNER_PRIVATE_KEY`, the three `REPORTER_ADDRESS_*`). Check the chain with `node ..\chain-client\chain.js status` (4 validators, peers connected).
2. `npx hardhat run scripts/deploy.js --network besu`. Copy the printed `CONTRACT_ADDRESS` and `TELEMETRY_CONTRACT_ADDRESS` lines.
3. **On each laptop:** `cd middleware; npm install; Copy-Item .env.example .env`. Fill `SECTOR_ID`, `RPC_URL` (A = 8546), `PRIVATE_KEY` (that laptop's reporter), the two addresses, and `EXPECTED_DOWNSTREAM`. Keep `DRY_RUN=true` first.
4. Start Mosquitto (new config), import the flow into Node-RED, and run `node aggregator.js`.
5. **DRY_RUN checks:** warm-up message, then a normal flow, then a pipe burst gives `CLOSE_VALVE`, then the corrupt spike is filtered.
6. **Go live** (`DRY_RUN=false`). Trigger a burst on Sector_B. `node scripts/admin/read-sector.js Sector_B` (run on any laptop's Hardhat project, pointing at its local RPC) must show the closed valve. Check it from the other laptops.
7. **Owner reset:** `node scripts/admin/reset-sector.js Sector_B`. The aggregator on laptop B reopens the valve within about 30 seconds.
8. **Quota demo:** `node scripts/admin/set-quota.js Sector_B 50`. Within about 30 s the aggregator picks it up. At 20 L/min the breach comes after about 150 s.
9. **Halt test:** stop laptop A's containers (the chain loses quorum). Trigger a burst on Sector_B. The valve must close immediately. Restart A, and the queued write must land.

---

## 12. Acceptance checklist

- [ ] `npx hardhat test` passes, and the contracts compile with `evmVersion: "london"` (no PUSH0).
- [ ] The struct, mapping name, `SectorAlert` signature and the 6-argument `updateSectorState` match section 5 exactly.
- [ ] The aggregator closes the valve before any chain call and never blocks on the chain.
- [ ] No fixed-2-second assumptions, no hard-coded `Sector_B`, and no per-call provider creation remain.
- [ ] `DRY_RUN=true` makes zero RPC calls.
- [ ] Sector_A uses RPC port 8546, and nothing uses node1 as a sector.
- [ ] No private keys appear in any committed file. `.gitignore` covers `.env`, wallet files and the state folder.
- [ ] READMEs and `CHANGES.md` are updated, and the "Verify on first live run" list is present. At minimum: zero-gas legacy transactions accepted from unfunded wallets, and the Hardhat deploy over `gasPrice: 0`.

---

## 13. How to answer

1. Start with any contradictions found between this document and the files, plus your assumptions.
2. Then give every new or changed file, complete, with its path as a header. Keep it in this order: contracts, Hardhat project, aggregator, broker and simulation, READMEs, `CHANGES.md`.
3. Do not add features that are not described here. If you think one is needed, list it at the end under "Suggestions".
