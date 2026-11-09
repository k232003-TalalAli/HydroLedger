# HydroLedger Blockchain – How to run

This guide walks you through starting your HydroLedger node step by step.  
Follow every step in order. You do **not** need to understand Docker or blockchain to do this.

Everything for the blockchain lives in this `blockchain` folder:

- `besu-net` – network files (genesis, keys, peer lists)
- `besu-setup` – Docker setup to start your node
- `chain-client` – small tool to check the chain / send data
- `set-ips.js` – one-time helper to fill Tailscale IPs (already done for the team)

**Who runs what**

| Person   | Laptop | Env file to use | Node name     |
|----------|--------|-----------------|---------------|
| *(host)* | A      | `envs\A.env`    | hydro-node1 + hydro-node2 |
| **Umer** | B      | `envs\B.env`    | hydro-node3   |
| **Daniyal** | C   | `envs\C.env`    | hydro-node4   |

---

## Before you start (one-time setup on your PC)

Install and open these **three** things:

1. **Docker Desktop**  
   - Download: https://www.docker.com/products/docker-desktop/  
   - Install it, then **open Docker Desktop** and wait until it says it is running (whale icon in the system tray is steady, not animating forever).

2. **Tailscale**  
   - Download: https://tailscale.com/download  
   - Install it, sign in with the same account / network as the rest of the team.  
   - Make sure the Tailscale icon shows **Connected** (not disconnected).

3. **Node.js**  
   - Download the LTS version: https://nodejs.org/  
   - Install with the default options.  
   - Close and reopen any terminal windows after installing.

You also need the **full HydroLedger project** on your PC, including this `blockchain` folder and the files inside `besu-net`. Copy it from the shared drive / USB / teammate who has the working copy — do not rely on an incomplete download.

---

## Step 0 – Open the right apps

1. Start **Docker Desktop** and wait until it is fully running.  
2. Confirm **Tailscale** is connected.  
3. Keep this README open so you can copy the commands.

---

## Step 1 – Remove the old `.env` file

1. Open File Explorer and go to:  
   `HydroLedger` → `blockchain` → `besu-setup`
2. If you see a file named `.env`, **delete it**.  
   - (You will create a fresh one in Step 4 from the correct template for your laptop.)

If you do not see `.env`, that is fine — continue.

---

## Step 2 – Open PowerShell as Administrator

1. Click the Start menu.  
2. Type `PowerShell`.  
3. Right-click **Windows PowerShell** → **Run as administrator** → Yes.  
4. Go to the `besu-setup` folder. Paste this (change the path if your folder is somewhere else), then press Enter:

```powershell
cd C:\Users\YOUR_USERNAME\Desktop\fyp\HydroLedger\blockchain\besu-setup
```

Replace `YOUR_USERNAME` with your Windows username (for Umer this is usually `umert`).

---

## Step 3 – Allow Besu through the firewall (Tailscale only)

Still in the **Administrator** PowerShell, run these two commands one at a time (press Enter after each):

```powershell
New-NetFirewallRule -DisplayName "Besu P2P TCP" -Direction Inbound -Protocol TCP -LocalPort 30303 -RemoteAddress 100.64.0.0/10 -Action Allow
```

```powershell
New-NetFirewallRule -DisplayName "Besu P2P UDP" -Direction Inbound -Protocol UDP -LocalPort 30303 -RemoteAddress 100.64.0.0/10 -Action Allow
```

If Windows says the rule already exists, that is OK — you can ignore it and continue.

**Only for Laptop A** (the host running two nodes), also run:

```powershell
New-NetFirewallRule -DisplayName "Besu P2P TCP 30304" -Direction Inbound -Protocol TCP -LocalPort 30304 -RemoteAddress 100.64.0.0/10 -Action Allow
New-NetFirewallRule -DisplayName "Besu P2P UDP 30304" -Direction Inbound -Protocol UDP -LocalPort 30304 -RemoteAddress 100.64.0.0/10 -Action Allow
```

---

## Step 4 – Create your `.env` file

Still in `besu-setup`, run **only the line that matches you**:

**If you are Umer (Laptop B):**

```powershell
copy envs\B.env .env
```

**If you are Daniyal (Laptop C):**

```powershell
copy envs\C.env .env
```

**If you are Laptop A (host):**

```powershell
copy envs\A.env .env
```

You should now have a `.env` file inside `besu-setup`.

---

## Step 5 – Start your node

**Important:** Laptop A should start first. Umer and Daniyal start after Laptop A is up.

In the same PowerShell window (still in `besu-setup`):

```powershell
docker compose up -d
```

Wait until it finishes. Then check that your container is running:

```powershell
docker ps
```

You should see something like `hydro-node3` (Umer) or `hydro-node4` (Daniyal) with status **Up**.

If it fails or keeps restarting, see **Troubleshooting** at the bottom.

---

## Step 6 – Install the chain client (first time on this PC)

```powershell
cd ..\chain-client
npm install
```

Wait until it finishes (it may take a minute).

---

## Step 7 – Check that everything works

```powershell
node chain.js status
```

**Success looks like** a block of text with `rpc`, `block`, `peers`, and `validators` — **not** an error like `ECONNREFUSED`.

Example of a good result:

```text
{
  rpc: 'http://127.0.0.1:8545',
  block: ...,
  peers: ...,
  validators: [ ... ]
}
```

If you see `connect ECONNREFUSED 127.0.0.1:8545`, your node is not running yet — go back to Step 5 / Troubleshooting.

---

## Step 8 – Shut down until the test meeting

When the status check worked, stop the node so you are ready for the meeting:

```powershell
cd ..\besu-setup
docker compose down
```

You are now ready for the test meeting.  
On meeting day: open Docker Desktop + Tailscale, go to `blockchain\besu-setup`, run `docker compose up -d`, then check with `node chain.js status` again from `blockchain\chain-client`.

---

## Quick cheat sheet (after setup is done once)

```powershell
# 1. Docker Desktop open, Tailscale connected
# 2. Start node
cd ...\HydroLedger\blockchain\besu-setup
docker compose up -d

# 3. Check
cd ..\chain-client
node chain.js status

# 4. Stop when done
cd ..\besu-setup
docker compose down
```

---

## Troubleshooting

### “ECONNREFUSED 127.0.0.1:8545”
Your Besu container is not running or not ready yet.

```powershell
cd ...\HydroLedger\blockchain\besu-setup
docker ps -a
docker logs hydro-node3
```

(Use `hydro-node4` on Daniyal’s laptop, or `hydro-node1` on Laptop A.)

### “genesis.json (Is a directory)” or mount “not a directory”
Docker once created empty **folders** where **files** should be. Fix:

1. Make sure `besu-net` has real **files** (not folders) for:
   - `blockchain\besu-net\genesis.json`
   - `blockchain\besu-net\node3\key` (or `node4\key` on Daniyal’s laptop)
   - `blockchain\besu-net\static\static-nodes-3.json` (or `static-nodes-4.json`)
2. If any of those names are folders, delete those folders and copy the real files from the working HydroLedger copy.
3. Then wipe old Docker data and start again:

```powershell
cd ...\HydroLedger\blockchain\besu-setup
docker compose down -v
docker compose up -d
```

(`down -v` removes the old volume — needed if a previous broken run left bad data.)

### Peers stay at 0
- Confirm Tailscale is **Connected** on all laptops.  
- Confirm Laptop A started first.  
- Confirm you used the correct `.env` for your laptop (`B.env` / `C.env` / `A.env`).  
- Confirm the firewall commands in Step 3 were run in **Administrator** PowerShell.

### Wrong person / wrong env
Delete `.env` in `besu-setup` and copy the correct one again (Step 4), then:

```powershell
docker compose down
docker compose up -d
```
