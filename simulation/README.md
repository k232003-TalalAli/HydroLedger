# Grid Simulation (`simulation/`)

Node-RED flow that simulates HydroLedger sector telemetry over MQTT. It publishes Upstream / Sector_B flow readings to `sensor/flow`, provides one-click leak and corrupt-spike injectors for demos, and listens on `actuation/valve` so `CLOSE_VALVE` commands appear in the Debug sidebar.

---

## 1. Install & Launch Node-RED

1. Install Node.js (LTS v18 or v20+), then install Node-RED globally:
   ```powershell
   npm install -g --unsafe-perm node-red
   ```
2. Ensure the local Mosquitto broker is running on `127.0.0.1:1883` (see `../broker/README.md`).
3. Start Node-RED:
   ```powershell
   node-red
   ```
4. Open the editor at [http://127.0.0.1:1880](http://127.0.0.1:1880).

---

## 2. Import `flows.json` & Deploy

1. In the Node-RED menu (☰), choose **Import** (or press `Ctrl + I`).
2. Select **select a file to import** and choose `simulation/flows.json`.
3. Confirm the import — you should see the tab **HydroLedger Grid Simulation**.
4. Click **Deploy** (top right).

The flow connects to Mosquitto at `127.0.0.1:1883` (MQTT v3.1.1) and publishes/subscribes as configured.

---

## 3. Operating Modes

### Single-Laptop Mode

Keep **both** repeating inject nodes active:

- `Upstream_Master (20.0 L/min)` — every 2 s
- `Sector_B Normal (20.0 L/min)` — every 2 s

One laptop then simulates the full sector locally. Leave the aggregator (`middleware/aggregator.js`) running against the same broker.

### Two-Laptop Mode (Laptop A & Laptop B)

| Laptop | Keep active | Disable / delete |
| :--- | :--- | :--- |
| **A** | `Upstream_Master (20.0 L/min)` | `Sector_B Normal`, `INJECT PIPE BURST` |
| **B** | `Sector_B Normal (20.0 L/min)`, `INJECT PIPE BURST` button | `Upstream_Master` |

Point both Node-RED MQTT broker configs at the shared Mosquitto host (Laptop A's IP if the broker lives there). Run the aggregator on the machine that should detect leaks and publish valve commands.

---

## 4. Live Leak Demo (Presentation)

1. Confirm normal telemetry is flowing (`Upstream` ≈ `Sector_B` ≈ 20.0 L/min → small `DeltaQ`).
2. Open the Node-RED **Debug** sidebar (bug icon).
3. Click **`INJECT PIPE BURST (Sector_B = 2.0 L/min)`** once.
4. The aggregator should log `ANOMALY_DETECTED` (ΔQ ≈ 18 L/min > 5.0 threshold) and publish `CLOSE_VALVE`.
5. In the Debug sidebar, **Valve Actuation Output** should show a payload like:
   ```json
   {"command":"CLOSE_VALVE","reason":"ANOMALY_DETECTED"}
   ```

Optional: click **`INJECT CORRUPT SPIKE (999 L/min)`** to verify the aggregator's noise filter drops impossible readings (`[FILTERED]`) without triggering actuation.
