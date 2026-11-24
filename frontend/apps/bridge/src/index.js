/**
 * Frontend-owned MQTT ↔ WebSocket bridge.
 * Does not modify backend Mosquitto config — connects as a normal MQTT client.
 *
 * Env:
 *   MQTT_URL=mqtt://127.0.0.1:1883
 *   BRIDGE_PORT=8787
 */
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 8787);
const TOPICS = ['sensor/flow', 'actuation/valve'];

const clients = new Set();

function broadcast(obj) {
  const raw = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

const mqttClient = mqtt.connect(MQTT_URL);

mqttClient.on('connect', () => {
  console.log(`[bridge] MQTT connected ${MQTT_URL}`);
  mqttClient.subscribe(TOPICS, (err) => {
    if (err) console.error('[bridge] subscribe failed', err.message);
    else console.log('[bridge] subscribed', TOPICS.join(', '));
  });
  broadcast({ type: 'bridge.status', mqtt: true, ts: Date.now() });
});

mqttClient.on('reconnect', () => {
  console.log('[bridge] MQTT reconnecting…');
});

mqttClient.on('error', (err) => {
  console.error('[bridge] MQTT error', err.message);
  broadcast({ type: 'bridge.status', mqtt: false, error: err.message, ts: Date.now() });
});

mqttClient.on('close', () => {
  broadcast({ type: 'bridge.status', mqtt: false, ts: Date.now() });
});

mqttClient.on('message', (topic, buf) => {
  let payload;
  try {
    payload = JSON.parse(buf.toString('utf8'));
  } catch {
    payload = { raw: buf.toString('utf8') };
  }
  broadcast({ type: 'mqtt', topic, payload, ts: Date.now() });
});

const wss = new WebSocketServer({ port: BRIDGE_PORT });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: 'bridge.hello',
      mqtt: mqttClient.connected,
      topics: TOPICS,
      ts: Date.now(),
    }),
  );

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    // Client wants to publish to MQTT (valve commands)
    if (msg.type === 'mqtt.publish' && typeof msg.topic === 'string') {
      const body = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload ?? {});
      mqttClient.publish(msg.topic, body, (err) => {
        if (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message, ts: Date.now() }));
        } else {
          ws.send(
            JSON.stringify({
              type: 'mqtt.published',
              topic: msg.topic,
              payload: msg.payload,
              ts: Date.now(),
            }),
          );
        }
      });
    }
  });

  ws.on('close', () => clients.delete(ws));
});

console.log(`[bridge] WebSocket listening on ws://127.0.0.1:${BRIDGE_PORT}`);

process.on('SIGINT', () => {
  mqttClient.end(true);
  wss.close();
  process.exit(0);
});
