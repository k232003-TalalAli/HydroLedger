# Grid Simulation (`simulation/`)

Node-RED flows that simulate one sector's telemetry over MQTT until real ESP32s are connected. They publish an `Upstream_Master` and one downstream sensor to `sensor/flow`, give one-click leak, corrupt-spike and valve-reset buttons for demos, and listen on `actuation/valve` so `CLOSE_VALVE` / `OPEN_VALVE` show up in the Debug sidebar.

Each laptop runs **its own** Mosquitto, Node-RED and aggregator. The downstream sensor name is only a label inside that laptop, so it can be `Sector_B` everywhere, but there are ready-made per-sector flows so the names match the sector.

| File | Downstream sensor | Use on | Aggregator `.env` |
| :--- | :--- | :--- | :--- |
| `flows.json` | `Sector_B` | Laptop B (and any laptop, see below) | `SECTOR_ID=Sector_B`, `EXPECTED_DOWNSTREAM=Sector_B` |
| `flows.sector-a.json` | `Sector_A` | Laptop A | `SECTOR_ID=Sector_A`, `EXPECTED_DOWNSTREAM=Sector_A` |
| `flows.sector-c.json` | `Sector_C` | Laptop C | `SECTOR_ID=Sector_C`, `EXPECTED_DOWNSTREAM=Sector_C` |

`flows.json` is **unchanged**. `flows.sector-a.json` and `flows.sector-c.json` are generated from it (they only rename `Sector_B` to `Sector_A` / `Sector_C` in the inject names and payloads). To regenerate:

```powershell
cd simulation
node make-sector-flows.js
```

If you would rather not use the per-sector files, use `flows.json` on every laptop and set `EXPECTED_DOWNSTREAM=Sector_B` in that laptop's aggregator `.env`. Nothing breaks, because the label is per broker.

---

## 1. Install and launch Node-RED

```powershell
npm install -g --unsafe-perm node-red
```

1. Start this laptop's Mosquitto on `127.0.0.1:1883` (see `..\broker\README.md`).
2. Start Node-RED: `node-red`
3. Open the editor at [http://127.0.0.1:1880](http://127.0.0.1:1880).

---

## 2. Import a flow and deploy

1. Menu (☰), **Import** (or `Ctrl + I`), **select a file to import**, choose this laptop's file from the table above.
2. Confirm. You should see the tab **HydroLedger Grid Simulation**.
3. Click **Deploy**.

The flow connects to Mosquitto at `127.0.0.1:1883` (MQTT v3.1.1).

---

## 3. What the flow does

* Two repeating injectors, every 2 s: `Upstream_Master` at 20.0 L/min and the downstream sensor at 20.0 L/min. Keep **both** active: the aggregator will not decide anything until both have reported (warm-up), and a sensor that goes silent for more than 10 s is marked stale.
* `INJECT PIPE BURST`: the downstream sensor reads 2.0 L/min **once** (not enough on its own, see the demo section).
* `INJECT CORRUPT SPIKE (999 L/min)`: `Upstream_Master` reads 999, which the filter must drop.
* `RESET / OPEN VALVE`: publishes `{"command":"OPEN_VALVE"}` to `actuation/valve`.
* `Subscribe actuation/valve`: prints valve commands in the Debug sidebar.

> **Retired:** the old "two-laptop shared broker" mode (laptop A publishes the upstream, laptop B the downstream, both on one broker) is no longer supported. Each laptop is its own sector now, with its own broker.

---

## 4. Live leak demo

1. Confirm normal telemetry: the aggregator prints `[TELEMETRY] ... DeltaQ=0.00`.
2. Open the Debug sidebar (bug icon).
3. Start a **sustained** burst (see the box below). Do not rely on a single click.
4. After the leak has held for two evaluation ticks (about 4 s) the aggregator logs `ANOMALY_DETECTED` (ΔQ above the 5.0 threshold) and publishes `CLOSE_VALVE`. **Valve Actuation Output** shows:

   ```json
   {"command":"CLOSE_VALVE","reason":"ANOMALY_DETECTED"}
   ```
5. In live mode the aggregator then writes the alert to the chain (`[CHAIN] Breach confirmed`). The valve is already closed by then.
6. Re-arm in one of two ways:
   * **Owner reset (the proper way, live mode):** on laptop A run `node scripts/admin/reset-sector.js Sector_B` in `hydro-contracts`. Within about 30 s the aggregator publishes `OPEN_VALVE` with reason `OWNER_RESET`.
   * **Local button (demos, dry run):** click **`RESET / OPEN VALVE`**. The aggregator logs `[RESET] OPEN_VALVE received`. It writes nothing to the chain; if the chain still says closed, the log warns that the owner must run `reset-sector.js`.

> **A single click on `INJECT PIPE BURST` no longer triggers a leak.** The old aggregator fired on the first reading above the threshold. The new one requires the leak to hold for 2 evaluation ticks (about 4 s), and the repeating `Sector_B Normal` injector publishes 20.0 L/min again within 2 s, which smooths a single 2.0 reading away before a second tick can see it (tested). `flows.json` is unchanged on purpose, so hold the burst in one of these ways:
>
> * **PowerShell (most reliable).** Publishes 2.0 L/min every 0.5 s for 8 s, so the sensor really stays low:
>
>   ```powershell
>   1..16 | ForEach-Object { '{"node_id":"Sector_B","flow_rate":2.0}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s; Start-Sleep -Milliseconds 500 }
>   ```
>   On laptop A or C use `Sector_A` / `Sector_C` in the payload.
> * **Node-RED.** Disable the `Sector_B Normal (20.0 L/min)` injector (open it, set it to disabled, Deploy), then click `INJECT PIPE BURST` once. With no later reading the sensor keeps its low value until it goes stale after 10 s, which is long enough. Re-enable the injector afterwards.

Optional: click **`INJECT CORRUPT SPIKE (999 L/min)`** to see the noise filter drop it (`[FILTERED]`) without any valve action.
