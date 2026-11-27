# HydroLedger Contracts (`hydro-contracts/`)

Hardhat project for the two smart contracts that give the water network a tamper-proof audit trail on our private Besu chain (QBFT, chain ID 1338).

| Contract | Purpose |
| :--- | :--- |
| `WaterQuotaRegistry` | Per-sector state, alerts (`SectorAlert`), quotas, leak threshold, roles (one owner, reporter wallets bound to one sector each). |
| `WaterTelemetryLog` | One snapshot per sector every 4 minutes (averages). History lives in events. Not connected to valve logic. |

A smart contract cannot talk to MQTT or to a valve. The **aggregator closes the valve physically**; the contract re-checks the thresholds on-chain, sets `isValveClosed` and emits `SectorAlert`, which is the audit record. **Closing a valve never waits for the chain. Reopening does.**

You use Hardhat only on **laptop A** (compile, test, deploy, owner admin). The aggregators never use Hardhat; they only need the deployed addresses.

---

## 1. Layout

```text
hydro-contracts/
  contracts/WaterQuotaRegistry.sol  contracts/WaterTelemetryLog.sol
  test/registry.test.js             test/telemetry.test.js
  scripts/make-wallets.js           scripts/deploy.js
  scripts/admin/set-quota.js        scripts/admin/reset-sector.js    scripts/admin/read-sector.js
  deployments/besu.json             (written by deploy.js, holds no secrets)
  hardhat.config.js  package.json  .env.example  .gitignore
```

Solidity `0.8.24`, `evmVersion: "london"` (the chain has `londonBlock: 0` and no later fork, so PUSH0 and similar opcodes would fail). No OpenZeppelin. A test checks the bytecode contains no PUSH0.

---

## 2. Wallets

An Ethereum wallet is a private key and its address. The contracts identify callers by **address only**.

| Wallet | Lives on | Purpose |
| :--- | :--- | :--- |
| `owner` | Laptop A, `hydro-contracts/.env` | Deploys and administers: sectors, reporters, quota, threshold, reset. **Back this key up.** Losing it means losing admin rights. |
| `reporterA` | Laptop A, `middleware/.env` | Writes `Sector_A` only |
| `reporterB` | Laptop B, `middleware/.env` | Writes `Sector_B` only |
| `reporterC` | Laptop C, `middleware/.env` | Writes `Sector_C` only |

* Gas is free (`zeroBaseFee`, `--min-gas-price=0`), so **wallets are never funded**.
* **Never** reuse `besu-net/nodeN/key`. Those are validator identities.
* If a reporter key leaks, the owner removes it on-chain. No chain rebuild is needed.

---

## 3. Runbook, laptop A (PowerShell)

```powershell
cd hydro-contracts
npm install
npx hardhat test                      # 26 tests, must all pass
node scripts/make-wallets.js          # creates wallets.local.json (gitignored) and prints where each key goes
Copy-Item .env.example .env
```

Edit `.env`: put the **owner** key in `OWNER_PRIVATE_KEY` and the three reporter **addresses** (not keys) in `REPORTER_ADDRESS_A/B/C`. Then check the chain is healthy:

```powershell
cd ..\blockchain\chain-client; npm install          # first time only
node chain.js status                                # expect 4 validators and peers connected
cd ..\..\hydro-contracts
```

Deploy once:

```powershell
npx hardhat run scripts/deploy.js --network besu
```

`deploy.js` deploys the registry, adds `Sector_A/B/C` with quota `INITIAL_QUOTA_LITERS_X * 100`, binds each reporter, deploys `WaterTelemetryLog` (`MIN_SNAPSHOT_INTERVAL_SECONDS`, default 210) and the registry with `DAY_LENGTH_SECONDS` (default 600: a quota day lasts 10 minutes), writes `deployments/besu.json`, and prints ready-to-paste `.env` lines for each laptop. Copy the `CONTRACT_ADDRESS` and `TELEMETRY_CONTRACT_ADDRESS` lines into each laptop's `middleware/.env` (see `../middleware/README.md`). Hand each reporter private key to its laptop by a private channel and delete the copies.

> Do **not** run the deploy twice. A second run creates a second, empty set of contracts that nobody uses.

---

## 4. Owner admin scripts (laptop A, network `besu`)

```powershell
node scripts/admin/read-sector.js Sector_B     # state, closeCause, quotaDay, latest snapshot, recent events
node scripts/admin/set-quota.js Sector_B 50    # quota in litres; aggregators pick it up within ~30 s
node scripts/admin/reset-sector.js Sector_B    # owner reopen (leak closures need this)
npm run advance-day                            # start a new day now and roll every sector over
npm run advance-day -- Sector_B                # same, only for the named sector(s)
npm run advance-day -- --day-only              # only advance the chain day; the aggregators roll over by themselves
```

* `advance-day.js` calls `advanceDay()` (owner only, adds one day to `currentDay()` through `manualDayShift`) and then `rolloverQuotaDay` for each sector: volume resets and a **quota** closure reopens at once; a **leak** closure stays closed. The aggregators see the new day on their next poll, find the sector's stored day already current, and send nothing.
* `reset-sector.js` **does not touch MQTT**. The sector's aggregator notices the on-chain reopen on its next poll (up to `CHAIN_POLL_SEC`, default 30 s) and opens its own valve.
* `read-sector.js` is read-only and needs **no owner key**. To check from laptop B or C, copy `hydro-contracts` there (without `.env` keys), set `RPC_URL=http://127.0.0.1:8545`, and either copy `deployments/besu.json` or put `CONTRACT_ADDRESS` and `TELEMETRY_CONTRACT_ADDRESS` in `.env`. On laptop A use `8545` (node1) or `8546` (node2).

Other owner actions (`setLeakThreshold`, `setDayOffsetSeconds`, `addReporter`, `removeReporter`, `transferOwnership`) have no script by design. Call them from a short Hardhat console session if you need them.

---

## 5. Contract behaviour in short

* `updateSectorState(id, up, down, deltaQ, volume, quota)` keeps the **6-argument ABI** the aggregator uses, but the contract **ignores the passed `deltaQ` and `quota`**. It recomputes `deltaQ = max(up - down, 0)` and uses the owner's stored quota. `dailyVolumeUsed` is trusted from the reporter (a compromised reporter could under-report volume; limit the damage by removing it).
* If the valve is already closed it stores the numbers and stops: no re-alert, cause unchanged.
* `deltaQ > leakThreshold` closes with `ANOMALY_DETECTED` (cause 1). Otherwise `volume > quota` closes with `QUOTA_EXCEEDED` (cause 2). Leak wins over quota.
* A normal update **never reopens** a valve.
* `currentDay() = (block.timestamp + dayOffsetSeconds) / dayLengthSeconds + manualDayShift`. `dayLengthSeconds` is fixed at deploy (constructor argument, default 600). `dayOffsetSeconds` must stay below it. `advanceDay` (owner) adds one to `manualDayShift`.
* `rolloverQuotaDay` (sector reporter or owner, once per day index; reverts `RolloverNotDue` if the sector's stored day is already current): resets volume and reopens a **quota** closure; a **leak** closure stays closed.
* `resetSector` (owner): valve open, volume 0, cause cleared.
* All flows and volumes are scaled **x100** (`500` = 5.00 L/min).

---

## 6. Offline note for building

`npx hardhat test` downloads the Solidity 0.8.24 compiler from `binaries.soliditylang.org` the first time. If a machine cannot reach it, Hardhat stops with `HH502`. Run the test on a machine that can, or allow that host once.

---

## 7. Verify on first live run

These cannot be proven without the real Besu chain:

1. **Zero-gas legacy transactions from unfunded wallets are accepted.** The first aggregator write from a fresh reporter wallet must be mined (`type: 0`, `gasPrice: 0`).
2. **Hardhat deploy over `gasPrice: 0`.** `deploy.js` must finish on Besu without "insufficient funds" or "gas price below minimum".
3. **Contract creation fits Besu's limits.** The contract is small; the genesis gas limit is huge, so this is expected to pass.
4. **Hardhat's automatic gas estimate works on Besu** (`eth_estimateGas` for a zero-gas-price call).
5. **`block.timestamp` runs close to wall-clock time.** QBFT with `emptyblockperiodseconds: 3600` can leave the latest block up to an hour old, but the next mined block gets a fresh timestamp. Confirm that `DailyRollover` and the `TooSoon` 540 s check behave on the real chain.
6. **Custom errors decode** in the aggregator logs (`TooSoon`, `ReporterSectorMismatch`) through Besu's revert reasons.
