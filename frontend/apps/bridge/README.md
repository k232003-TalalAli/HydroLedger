# @hydroledger/bridge

Frontend-owned MQTT ↔ WebSocket bridge. **Does not modify** the repo-root `broker/` stack.

## Run

```bash
# Mosquitto must already be running (backend broker)
pnpm --filter @hydroledger/bridge dev
```

- MQTT: `mqtt://127.0.0.1:1883` (`MQTT_URL`)
- WS: `ws://127.0.0.1:8787` (`BRIDGE_PORT`)

## Messages (browser ← bridge)

```json
{ "type": "mqtt", "topic": "sensor/flow", "payload": { "node_id": "Sector_B", "flow_rate": 20 }, "ts": 0 }
{ "type": "bridge.status", "mqtt": true, "ts": 0 }
```

## Publish (browser → bridge → MQTT)

```json
{ "type": "mqtt.publish", "topic": "actuation/valve", "payload": { "command": "CLOSE_VALVE", "reason": "ANOMALY_DETECTED" } }
```
