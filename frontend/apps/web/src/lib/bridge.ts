import {
  MQTT_TOPIC_ACTUATION_VALVE,
  type SensorFlowMessage,
  type ValveActuationMessage,
} from '@hydroledger/shared';

type Handler = (msg: BridgeInbound) => void;

export type BridgeInbound =
  | { type: 'bridge.hello'; mqtt: boolean; topics: string[]; ts: number }
  | { type: 'bridge.status'; mqtt: boolean; error?: string; ts: number }
  | { type: 'mqtt'; topic: string; payload: unknown; ts: number }
  | { type: 'mqtt.published'; topic: string; payload: unknown; ts: number }
  | { type: 'error'; message: string; ts: number };

let socket: WebSocket | null = null;
const handlers = new Set<Handler>();
let connected = false;
let mqttOk = false;

export function getBridgeWsUrl(): string {
  return import.meta.env.VITE_BRIDGE_WS_URL || 'ws://127.0.0.1:8787';
}

export function isBridgeConnected(): boolean {
  return connected;
}

export function isMqttConnected(): boolean {
  return mqttOk;
}

export function subscribeBridge(handler: Handler): () => void {
  handlers.add(handler);
  ensureSocket();
  return () => handlers.delete(handler);
}

function emit(msg: BridgeInbound): void {
  for (const h of handlers) h(msg);
}

function ensureSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = getBridgeWsUrl();
  try {
    socket = new WebSocket(url);
  } catch {
    connected = false;
    return;
  }

  socket.onopen = () => {
    connected = true;
  };
  socket.onclose = () => {
    connected = false;
    mqttOk = false;
    socket = null;
    window.setTimeout(ensureSocket, 3000);
  };
  socket.onerror = () => {
    connected = false;
  };
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as BridgeInbound;
      if (msg.type === 'bridge.hello' || msg.type === 'bridge.status') {
        mqttOk = Boolean(msg.mqtt);
      }
      emit(msg);
    } catch {
      /* ignore */
    }
  };
}

export function publishValve(command: ValveActuationMessage): void {
  ensureSocket();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('[bridge] not connected — cannot publish valve command');
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'mqtt.publish',
      topic: MQTT_TOPIC_ACTUATION_VALVE,
      payload: command,
    }),
  );
}

export function parseSensorFlow(payload: unknown): SensorFlowMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.node_id !== 'string' || typeof p.flow_rate !== 'number') return null;
  return { node_id: p.node_id, flow_rate: p.flow_rate };
}
