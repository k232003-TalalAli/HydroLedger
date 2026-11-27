# HydroLedger: Setting up Laptop B and Laptop C

This guide takes a laptop that has **nothing installed** (no Mosquitto, no Hardhat, no `node_modules`, no wallet) to a running sector that writes to the shared blockchain, and shows you how to look at the data afterwards. Follow the steps in order.

|                                                | Laptop B                                     | Laptop C                                     |
| ---------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Sector                                         | `Sector_B`                                   | `Sector_C`                                   |
| Besu node (Docker)                             | `hydro-node3`                                | `hydro-node4`                                |
| Env file for the node                          | `envs\B.env`                                 | `envs\C.env`                                 |
| Local RPC                                      | `http://127.0.0.1:8545`                      | `http://127.0.0.1:8545`                      |
| Reporter address (already registered on-chain) | `0xD5dED0965DC92CA48ff2B373Dd374da1f3f61B49` | `0xe03f702123677fFb9030724447fb9B9da6b157FE` |
| Node-RED flow to import                        | `simulation\flows.json`                      | `simulation\flows.sector-c.json`             |

Laptop A (the host and contract owner) must have its two Besu containers running **before** B and C start.

---

## 0. Read this first

* **You do not create a wallet.** The reporter wallets for B and C were created on Laptop A and are already bound to their sectors in the deployed contract. You only need **your own** reporter private key, handed to you privately by the person on Laptop A (step 1).
* **Never ask for, or copy, the owner key** (`OWNER_PRIVATE_KEY`, `wallets.local.json`). Laptops B and C must never have it.
* **Never run `docker compose down -v`.** It deletes your copy of the chain. Plain `docker compose down` is fine.
* Gas is free, so wallets are never funded.

---

## 1. What Laptop A sends you (done on Laptop A)

### 1a. A copy of the project without secrets

pull latest changes from git:

```powershell
git pull origin main
```

after you pull, make sure you have the correct `.env` for your laptop B or C in besu-setup

### 1b. Each laptop's own reporter key

These are your private keys for accessing the chain, store a copy safely, losing this would mean losing your access to the chain.


### 1c. The contract addresses

They are in `hydro-contracts\deployments\besu.json`. At the time of writing:

```text
CONTRACT_ADDRESS            = 0xADc48A06940CB4F9066d66891170BE573b47453B
TELEMETRY_CONTRACT_ADDRESS  = 0x597aa018401944D9D36Eca15d1ae5b5a532ABe04
```

If Laptop A ever redeploys, these change, so check the file and tell B and C the new ones.

---

## 2. Install the software (Laptop B and Laptop C)

Install each of these, then **close and reopen PowerShell**.

| Software | Download | Notes |
|---|---|---|
| Mosquitto | https://mosquitto.org/download/ | Windows 64-bit installer, default options (keep **Service** ticked). |

Then install Node-RED:

```powershell
npm install -g --unsafe-perm node-red
```

Check everything is there:

```powershell
node -v
npm -v
docker --version
Test-Path "C:\Program Files\mosquitto\mosquitto.exe"     # must print True
node-red --help | Select-Object -First 1
```

If PowerShell says `npm.ps1 cannot be loaded because running scripts is disabled`, run this once and try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 3. Put the project in place and install packages

The commands below assume that path of your local repository. Change it if yours differs.

```powershell
$P = "C:\Hydroledger"

cd $P\blockchain\chain-client
npm install

cd $P\middleware
npm install

cd $P\hydro-contracts
npm install --omit=dev
#`--omit=dev` keeps Hardhat out. It installs only `ethers` and `dotenv`, which node3 and node4 scripts need.

cd $P\frontend
npm install -g pnpm
pnpm install

```

In the `frontend/` folder, run:

```powershell
copy .env.example .env
```

Then edit `.env` for your laptop:

- `VITE_LOCAL_SECTOR_ID` — `Sector_A`, `Sector_B`, or `Sector_C`
- `VITE_RPC_URL` / contract addresses — match your local Besu deploy
---

## 4. Join the chain and catch up

The blockchain is a copy that every validator node holds. When your node starts it connects to Laptop A and **downloads every block it is missing automatically**. There is nothing to import or sync by hand.

### 4a. Firewall (once, PowerShell as Administrator)

Start menu, type `PowerShell`, right-click **Run as administrator**:

```powershell
New-NetFirewallRule -DisplayName "Besu P2P TCP" -Direction Inbound -Protocol TCP -LocalPort 30303 -RemoteAddress 100.64.0.0/10 -Action Allow
New-NetFirewallRule -DisplayName "Besu P2P UDP" -Direction Inbound -Protocol UDP -LocalPort 30303 -RemoteAddress 100.64.0.0/10 -Action Allow
New-NetFirewallRule -DisplayName "Mosquitto Tailnet" -Direction Inbound -Protocol TCP -LocalPort 1883 -RemoteAddress 100.64.0.0/10 -Action Allow
```

"Rule already exists" is fine.

### 4b. Pick your node's settings file

The project copy may contain Laptop A's `.env` inside `besu-setup`. Replace it with yours:

**Laptop B:**

```powershell
cd $P\blockchain\besu-setup
Copy-Item envs\B.env .env -Force
```

**Laptop C:**

```powershell
cd $P\blockchain\besu-setup
Copy-Item envs\C.env .env -Force
```

Check it is the right one: `Get-Content .env` should say `N1=3` on B or `N1=4` on C.

### 4c. Start the node

Make sure Laptop A's containers are already up, then:

```powershell
docker compose up -d
docker ps
```

`docker ps` must show `hydro-node3` (B) or `hydro-node4` (C) with status **Up**.

### 4d. Check that you caught up

```powershell
cd $P\blockchain\chain-client
node chain.js status
```

You should see `peers` of at least 1 and 4 `validators`. Run it again every 10 to 20 seconds. The `block` number goes up while your node downloads the missing blocks, then it matches Laptop A's. Ask the person on Laptop A to run the same command and compare the `block` numbers. **Do not go on until they match.**

> If your Tailscale IP changed since the env files were made, peers stay at 0. Ask Laptop A to run `node set-ips.js <IP_A> <IP_B> <IP_C>` in the `blockchain` folder, redo step 4b, then `docker compose down` and `docker compose up -d`.

---

## 5. Configure this laptop

### 5a. The aggregator settings: `middleware\.env`

Create the file `$P\middleware\.env` (for example with `notepad $P\middleware\.env`) and paste the block for your laptop. Replace `PASTE_YOUR_KEY_HERE` with the reporter key you received.

**Laptop B:**

```env
DRY_RUN=false
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=PASTE_YOUR_KEY_HERE
CONTRACT_ADDRESS=0xADc48A06940CB4F9066d66891170BE573b47453B
TELEMETRY_CONTRACT_ADDRESS=0x597aa018401944D9D36Eca15d1ae5b5a532ABe04
SECTOR_ID=Sector_B
UPSTREAM_NODE_ID=Upstream_Master
EXPECTED_DOWNSTREAM=Sector_B
LEAK_THRESHOLD=5.0
DAILY_QUOTA_LIMIT=5000
DAY_LENGTH_SECONDS=600
DAY_OFFSET_SECONDS=0
EVAL_INTERVAL_SEC=2
STALE_AFTER_SEC=10
BREACH_CONSECUTIVE=2
SNAPSHOT_INTERVAL_MIN=4
CHAIN_POLL_SEC=30
STATE_DIR=./state
```

**Laptop C:** the same, but with these two lines changed:

```env
SECTOR_ID=Sector_C
EXPECTED_DOWNSTREAM=Sector_C
```

Laptops B and C both use `RPC_URL=http://127.0.0.1:8545`. Only Laptop A uses 8546. If you want a safe first run that makes no chain calls, set `DRY_RUN=true`, test, then change it to `false`.

Also, on laptop B and C, open broker/mosquitto.config, find this section:

# --- Active listener: this laptop only -------------------------------------------------
listener 1883 127.0.0.1
allow_anonymous true

log_dest stdout
log_type all

# -----------------------------------------------------------------------------

and replace "listener 1883 127.0.0.1" with "listener 1883 0.0.0.0".

### 5b. Settings for the read scripts: `hydro-contracts\.env`

Create `$P\hydro-contracts\.env` with just this line:

```env
RPC_URL=http://127.0.0.1:8545
```

Nothing else goes in this file on B and C. It has no owner key, which is exactly what keeps the owner-only reset watcher from starting on your laptop.

### 5c. Sync the Windows clock (PowerShell as Administrator)

The contract uses block time and the aggregator uses your laptop clock. A clock that is off delays the daily rollover.

```powershell
w32tm /resync
```

---

## 6. Prepare Mosquitto and Node-RED (once)

### 6a. Mosquitto

The installer registers a background service that blocks port 1883. Stop it (PowerShell as Administrator):

```powershell
Stop-Service mosquitto -ErrorAction SilentlyContinue
Set-Service mosquitto -StartupType Manual
```

Quick test, from `$P\broker`:

```powershell
cd $P\broker
& "C:\Program Files\mosquitto\mosquitto.exe" -c mosquitto.conf -v
```

You should see `Opening ipv4 listen socket on port 1883` and `mosquitto version ... running`. Press Ctrl+C to stop it. The launcher in step 7 starts it for you.

### 6b. Node-RED flow

```powershell
node-red
```

Open http://127.0.0.1:1880, then: menu (three lines, top right), **Import**, **select a file to import**, choose:

* Laptop B: `$P\simulation\flows.json`
* Laptop C: `$P\simulation\flows.sector-c.json`

Click **Import**, then **Deploy**. Press Ctrl+C in PowerShell to stop Node-RED. It remembers the flow.

---

## 7. Run the system

Order matters: **Laptop A's nodes first**, then your node (step 4c, already running), then the rest.

### open 3 terminals on powershell and run:

```powershell
# Window 1
cd $P\broker
& "C:\Program Files\mosquitto\mosquitto.exe" -c mosquitto.conf -v

# Window 2
node-red

# Window 3
cd $P\middleware
node aggregator.js
```

Optional: Create a powershell script: .\start-simulation.ps1 (already present on Laptop A and B)
that starts all 3. Make sure it is present in gitignore, because its contents vary across systems, as Laptop A needs to run other files first.

### What the aggregator log must show

```text
[CHAIN] Reporter 0xD5dE...1B49 via http://127.0.0.1:8545     <- B (C shows 0xe03f...57FE)
[MQTT] Connected to mqtt://127.0.0.1:1883
[TELEMETRY] Upstream=20.00 | Total Downstream=20.00 | DeltaQ=0.00 ...
```

* The reporter address in the first line **must match your column in the table at the top.** If it does not, the key in `.env` is wrong (see Troubleshooting).
* There must be no `using .env fallback` line.
* Node-RED must be deployed, because the sensors live there. Without them you will only see `[WARMUP] waiting for ...`.

---

## 8. Get your data on the chain, and view it

### 8a. What gets written, and when

| What | When | Log line |
|---|---|---|
| Daily rollover | Within 10 minutes of starting (at the next 10-minute day boundary) | `[CHAIN] Rollover confirmed.` |
| Telemetry snapshot | 4 minutes after start, then every 4 minutes | `[CHAIN] Snapshot confirmed 0x...` |
| Leak alert | A few seconds after a held burst | `[CHAIN] Breach confirmed 0x...` |

Laptop A can bring every sector up to the current day at once with `npm run advance-day` (in `hydro-contracts`).

### 8b. Trigger a leak (optional, to see an alert)

Laptop A:

```powershell
1..16 | ForEach-Object { '{"node_id":"Sector_A","flow_rate":2.0}' | & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -p 1883 -t "sensor/flow" -s; Start-Sleep -Milliseconds 500 }
```

Laptop B:

```powershell
$pub = "C:\Program Files\mosquitto\mosquitto_pub.exe"
1..16 | ForEach-Object { & $pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -m '{"node_id":"Sector_B","flow_rate":2.0}'; Start-Sleep -Milliseconds 500 }
```

Laptop C:

```powershell
$pub = "C:\Program Files\mosquitto\mosquitto_pub.exe"
1..16 | ForEach-Object { & $pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -m '{"node_id":"Sector_B","flow_rate":2.0}'; Start-Sleep -Milliseconds 500 }
```

### 8c. View the data

Run these in `$P\hydro-contracts`. They only read, so no key is needed, and **every laptop sees all three sectors** because the chain is shared:

```powershell
cd $P\hydro-contracts
foreach ($s in "Sector_A","Sector_B","Sector_C") { node scripts/admin/read-history.js $s } #pretty format
```
```powershell
cd $P\hydro-contracts
foreach ($s in "Sector_A","Sector_B","Sector_C") { node scripts/admin/read-sector.js $s } #Raw Blockchain state and event list
```

Or one sector at a time:

```powershell
node scripts/admin/read-history.js Sector_B
node scripts/admin/read-sector.js Sector_B
```

`read-history.js` prints, in your local time zone: a "Right now" summary (valve, quota, quota day, latest snapshot), then every block grouped under the snapshot that came before it, such as snapshots, rollovers, alerts and resets.

**What "all sectors are on the chain" looks like:**

* Each of `Sector_A`, `Sector_B`, `Sector_C` shows at least one `Snapshot #...` and at least one `New quota day ... started`.
* `Quota day` in the summary equals the chain's current day.
* The block numbers you see are the same on every laptop.

### 8d. Reopening a valve after a leak

Only the **owner on Laptop A** can reopen a valve on-chain:

```powershell
cd D:\Projects\Hydroledger\hydro-contracts
node scripts/admin/reset-sector.js Sector_B
```

Within about 30 seconds your aggregator logs `[CHAIN] Owner reset observed` and opens the valve. The Node-RED reset button on B or C only clears the local lock. It does not change the chain.

---

## 9. Every day after setup
### 9a. Start the Backend

```powershell
# 1. Docker Desktop open, Tailscale Connected, Laptop A's nodes running
cd $P\blockchain\besu-setup
docker compose up -d

# 2. Check you are in sync (block matches Laptop A)
cd ..\chain-client
node chain.js status

# 3. Start everything else (laptop B needs to create the ps1 script first)
cd $P
powershell -ExecutionPolicy Bypass -File .\start-simulation.ps1
```

To stop: close the three windows (or Ctrl+C in each). Stop the node with `docker compose down` from `besu-setup` (never `-v`).

If the laptop was off for a while, just do step 1. The node catches up on its own.

### 9b. Start the Frontend

Navigate to frontend/ and Open 3 terminal windows, and run:

```powershell
# Window 1
pnpm --filter @hydroledger/shared build

# Window 2
pnpm --filter @hydroledger/bridge dev

# Window 3
pnpm --filter @hydroledger/web dev
```

The project is now live at http://localhost:5173



---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:8545` | Your node is not running. `docker ps -a`, then `docker logs hydro-node3` (or `hydro-node4`). |
| `peers` stays 0 | Tailscale not connected, Laptop A not started, wrong `.env` in `besu-setup`, or step 4a was not run as Administrator. |
| `Address already in use` on port 1883 | The Mosquitto service is still running. Run `Stop-Service mosquitto` as Administrator. |
| Block number does not catch up | The chain needs 3 of 4 validators online. Check that Laptop A and the other laptop are up. |
| `[CHAIN] Breach reverted: ... unknown custom error` or `Rollover not finished: reverted` | Your reporter key does not match the registered address. Compare the address in the `[CHAIN] Reporter 0x...` log line with the table at the top. Get the correct key from Laptop A. |
| `Cannot create the reporter wallet` | `PRIVATE_KEY` is empty or has extra spaces or quotes. |
| `[CHAIN] Rollover not finished ... chain clock not at the new day yet` and it keeps repeating | Run `w32tm /resync` as Administrator on every laptop, then restart the aggregator. |
| `[WARMUP] waiting for: Upstream_Master,Sector_B` forever | Node-RED is not running or the flow is not deployed. Open http://127.0.0.1:1880 and click **Deploy**. |
| `read-history.js` says `Missing ...besu.json` | Copy `hydro-contracts\deployments\besu.json` from Laptop A, or add `CONTRACT_ADDRESS` and `TELEMETRY_CONTRACT_ADDRESS` to `hydro-contracts\.env`. |
| `npm.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Docker error about `genesis.json (Is a directory)` | A mounted path became a folder. Make sure `besu-net\genesis.json`, `besu-net\node3\key` (or `node4`) and `besu-net\static\static-nodes-3.json` (or `-4`) are real **files**. Delete any same-named folders, copy the real files from Laptop A, then `docker compose down -v` and `docker compose up -d`. This is the only case where `-v` is OK, and the node will re-download the chain. |
