# Distributed MQTT Broker (`broker/`)

Local **Eclipse Mosquitto v2.x** MQTT message broker used on each validator laptop to ingest real-time sector flow telemetry (`sensor/flow`) and dispatch valve actuation commands (`actuation/valve`).

---

## 1. Prerequisites & Installation (Windows)

1. Download the **Windows 64-bit installer** (`mosquitto-2.x.x-install-windows-x64.exe`) from the official Eclipse Mosquitto download page: `https://mosquitto.org/download/`
2. Run the installer with default options checked (including **Service**).
3. Add the Mosquitto installation folder to your Windows System **Path**:
   - Press `Win + S`, search **Edit the system environment variables**, and click **Environment Variables**.
   - Under **System variables**, select **Path** → **Edit** → **New**.
   - Add:
     ```text
     C:\Program Files\mosquitto
     ```
   - Click **OK** to save and restart any open terminal windows.

---

## 2. Allow Port `1883` in Windows Firewall

By default, Windows Defender Firewall blocks external Wi-Fi devices (such as the ESP32) from reaching port `1883`. Open **PowerShell as Administrator** and run:

```powershell
New-NetFirewallRule -DisplayName "Mosquitto MQTT (Port 1883)" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Any
```

---

## 3. Running the Broker

Mosquitto runs as a background Windows service by default using a restricted config that only accepts `localhost` connections. To allow external ESP32 nodes on your local Wi-Fi/hotspot to connect and see live console logs, stop the background service and start Mosquitto with the custom `mosquitto.conf` in this directory.

1. Open **PowerShell as Administrator** and stop the default service:
   ```powershell
   Stop-Service mosquitto -ErrorAction SilentlyContinue
   ```
2. Navigate to this `broker/` directory and launch Mosquitto:
   ```powershell
   cd broker
   mosquitto -c mosquitto.conf -v
   ```

Expected startup output:
```text
mosquitto version 2.x.x starting
Config loaded from mosquitto.conf.
Opening ipv4 listen socket on port 1883.
Opening ipv6 listen socket on port 1883.
mosquitto version 2.x.x running
```

---

## 4. Verification (Pub/Sub Test)

With the broker running, open two separate PowerShell terminals:

**Terminal 1 — Subscribe to telemetry topic:**
```powershell
mosquitto_sub -h localhost -p 1883 -t "sensor/flow" -v
```

**Terminal 2 — Publish a test JSON payload (PowerShell-safe syntax):**
```powershell
'{"node_id":"test","flow_rate":20.0}' | mosquitto_pub -h localhost -p 1883 -t "sensor/flow" -s
```

Terminal 1 should immediately print:
```text
sensor/flow {"node_id":"test","flow_rate":20.0}
```

---

## 5. Active MQTT Topics

| Topic | Publisher | Subscriber | Payload Format |
| :--- | :--- | :--- | :--- |
| `sensor/flow` | Node-RED / ESP32 Sensors | Node.js Middleware | `{"node_id": "Sector_B", "flow_rate": 20.0}` |
| `actuation/valve` | Node.js Middleware | ESP32 Relay Controller | `{"command": "CLOSE_VALVE"}` |
