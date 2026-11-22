# MQTT Broker (`broker/`)

**Eclipse Mosquitto 2.x**, one broker **per laptop**. It carries real-time sector flow telemetry (`sensor/flow`) in and valve commands (`actuation/valve`) out. Each laptop (A, B, C) is a self-contained sector with its own broker, Node-RED and aggregator, so nothing needs to be shared between laptops and sensor names only need to be unique within one laptop.

By default the broker listens on **loopback only** (`127.0.0.1:1883`, anonymous). Nothing outside the laptop can reach it, so **no firewall rule is needed**.

---

## 1. Install Mosquitto (Windows)

1. Download the **Windows 64-bit installer** (`mosquitto-2.x.x-install-windows-x64.exe`) from `https://mosquitto.org/download/` and run it with the defaults (including **Service**).
2. Add `C:\Program Files\mosquitto` to the system **Path** (Win + S, "Edit the system environment variables", Environment Variables, System variables, Path, Edit, New). Restart open terminals.

---

## 2. Remove the old open firewall rule

The previous setup opened port 1883 to every network profile. Delete that rule once on each laptop (**PowerShell as Administrator**):

```powershell
Remove-NetFirewallRule -DisplayName "Mosquitto MQTT (Port 1883)" -ErrorAction SilentlyContinue
```

Loopback traffic does not go through the Windows Firewall, so the default config needs no rule at all.

---

## 3. Run the broker

The installer registers a background Windows **service** that already uses port 1883. Stop it, then start Mosquitto with this folder's config (**PowerShell as Administrator** for the first line):

```powershell
Stop-Service mosquitto -ErrorAction SilentlyContinue
cd broker
mosquitto -c mosquitto.conf -v
```

Expected startup output:

```text
mosquitto version 2.x.x starting
Config loaded from mosquitto.conf.
Opening ipv4 listen socket on port 1883.
mosquitto version 2.x.x running
```

If you see `Address already in use`, the service or another Mosquitto is still running.

---

## 4. Verify (publish and subscribe)

**Window 1:**

```powershell
mosquitto_sub -h 127.0.0.1 -p 1883 -t "sensor/flow" -v
```

**Window 2:**

```powershell
'{"node_id":"test","flow_rate":20.0}' | mosquitto_pub -h 127.0.0.1 -p 1883 -t "sensor/flow" -s
```

Window 1 prints `sensor/flow {"node_id":"test","flow_rate":20.0}`.

---

## 5. Why `per_listener_settings true` is the first line

Mosquitto 2.x applies `allow_anonymous`, `password_file` and `acl_file` globally unless `per_listener_settings true` is set. With it set, each of those lines belongs to the **listener declared just above it**, so the loopback listener can stay anonymous while a LAN listener demands a password. The option **must be the first setting in the file**: if it comes after `allow_anonymous` (or any other security line) Mosquitto refuses to start. In the shipped config it is already first and the optional blocks are written for it.

---

## 6. Optional: let other laptops reach this broker (Tailscale)

Normally not needed, because every sector is self-contained. If you want it:

1. **Start Tailscale first.** Mosquitto fails to start if the listener address does not exist yet. Find the address: `tailscale ip -4`.
2. In `mosquitto.conf` uncomment the **OPTIONAL 1** block and put that address in `listener 1883 100.x.x.x`.
3. Open the port for the Tailscale range only (**Administrator PowerShell**):

   ```powershell
   New-NetFirewallRule -DisplayName "Mosquitto MQTT Tailscale" -Direction Inbound -Protocol TCP -LocalPort 1883 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```
4. Start order every time: **Tailscale, then Mosquitto**.

---

## 7. Optional: real ESP32 devices on the Wi-Fi LAN

Real ESP32s are on the Wi-Fi LAN and are **not on Tailscale**. A Tailscale-only broker would lock them out, and the loopback listener cannot be reached from the LAN. The **OPTIONAL 2** block adds a LAN listener on its own port (**1884**) so it never collides with the loopback listener, and it requires a user name and password plus an ACL:

| User | May write | May read |
| :--- | :--- | :--- |
| `sensor` (the ESP32s) | `sensor/flow` | `actuation/valve` |
| `aggregator` | `actuation/valve` | `sensor/flow` |

Steps (the same ones are in the comments of `mosquitto.conf`):

1. Create the password file in this folder. `-c` creates the file, so use it for the first user only:

   ```powershell
   mosquitto_passwd -c passwords.txt sensor
   mosquitto_passwd passwords.txt aggregator
   ```
2. Create `acl.conf` next to it:

   ```text
   user sensor
   topic write sensor/flow
   topic read actuation/valve

   user aggregator
   topic read sensor/flow
   topic write actuation/valve
   ```
3. Open the port for the local subnet on the **Private** profile only (**Administrator PowerShell**):

   ```powershell
   New-NetFirewallRule -DisplayName "Mosquitto MQTT LAN" -Direction Inbound -Protocol TCP -LocalPort 1884 -RemoteAddress LocalSubnet -Profile Private -Action Allow
   ```
4. Find this laptop's LAN address with `ipconfig`, put it in `listener 1884 192.168.x.x`, uncomment the block, restart Mosquitto.
5. Point each ESP32 at `<laptop LAN IP>:1884` with the `sensor` user.

`passwords.txt` and `acl.conf` hold credentials. Do not commit them.

---

## 8. Active MQTT topics

| Topic | Publisher | Subscriber | Payload |
| :--- | :--- | :--- | :--- |
| `sensor/flow` | Node-RED / ESP32 sensors | Aggregator | `{"node_id": "Sector_B", "flow_rate": 20.0}` |
| `actuation/valve` | Aggregator | ESP32 relay | `{"command": "CLOSE_VALVE", "reason": "ANOMALY_DETECTED"}` or `"QUOTA_EXCEEDED"` |
| `actuation/valve` | Aggregator or operator | ESP32 relay, aggregator | `{"command": "OPEN_VALVE"}`, optionally `"reason": "OWNER_RESET"` or `"DAILY_ROLLOVER"` |

The topics and base payload shapes are unchanged. `reason` is the only addition on `OPEN_VALVE`, and receivers that ignore it keep working.
