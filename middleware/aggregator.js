require('dotenv').config();

const mqtt = require('mqtt');
const { ethers } = require('ethers');

const ALPHA = 0.7;
const ABI = [
  'function updateSectorState(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)',
];

const sectorState = {
  upstreamFlow: 0,
  downstreamSensors: { Sector_B: 0 },
  dailyVolumeUsed: 0,
};

/** Tracks last EMA value per node_id for smoothing. */
const emaPrevious = {};

/** True once any downstream sensor has reported a cleaned reading. */
let downstreamHasReported = false;

/** Prevents duplicate breach transactions while the valve is closing. */
let alertDispatched = false;

const client = mqtt.connect(process.env.MQTT_BROKER_URL);

client.on('connect', () => {
  console.log(`[MQTT] Connected to ${process.env.MQTT_BROKER_URL}`);
  client.subscribe(['sensor/flow', 'actuation/valve'], (err) => {
    if (err) {
      console.error('[MQTT] Failed to subscribe:', err.message);
      return;
    }
    console.log('[MQTT] Subscribed to sensor/flow and actuation/valve');
  });
});

client.on('error', (err) => {
  console.error('[MQTT] Client error:', err.message);
});

client.on('message', (topic, payload) => {
  if (topic === 'actuation/valve') {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (data.command === 'OPEN_VALVE') {
      alertDispatched = false;
      sectorState.dailyVolumeUsed = 0;
      console.log(
        '[RESET] OPEN_VALVE received — alert lock cleared and sector re-armed.'
      );
    }
    return;
  }

  if (topic !== 'sensor/flow') return;

  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    console.log('[FILTERED] Dropped invalid reading:', payload.toString());
    return;
  }

  const { node_id, flow_rate } = data;
  const flowRate = typeof flow_rate === 'number' ? flow_rate : Number(flow_rate);

  if (
    !node_id ||
    typeof flowRate !== 'number' ||
    Number.isNaN(flowRate) ||
    flowRate < 0 ||
    flowRate >= 500
  ) {
    console.log('[FILTERED] Dropped invalid reading:', data);
    return;
  }

  // EMA smoothing: cleaned = 0.7 * incoming + 0.3 * previous (or init to incoming)
  const previous = emaPrevious[node_id];
  const cleaned =
    previous === undefined ? flowRate : ALPHA * flowRate + (1 - ALPHA) * previous;
  emaPrevious[node_id] = cleaned;

  if (node_id === 'Upstream_Master') {
    sectorState.upstreamFlow = cleaned;
    // 2-second telemetry interval: (L/min) / 60 * 2s = liters this interval
    sectorState.dailyVolumeUsed += (cleaned / 60) * 2;
  } else {
    sectorState.downstreamSensors[node_id] = cleaned;
    downstreamHasReported = true;
  }

  runMassBalanceCheck();
});

function runMassBalanceCheck() {
  if (!downstreamHasReported) return;

  const totalDownstreamFlow = Object.values(sectorState.downstreamSensors).reduce(
    (sum, v) => sum + v,
    0
  );
  const deltaQ = sectorState.upstreamFlow - totalDownstreamFlow;

  console.log(
    `[TELEMETRY] Upstream=${sectorState.upstreamFlow.toFixed(2)} | ` +
      `Total Downstream=${totalDownstreamFlow.toFixed(2)} | ` +
      `DeltaQ=${deltaQ.toFixed(2)} | ` +
      `Volume Used=${sectorState.dailyVolumeUsed.toFixed(2)} L`
  );

  const leakThreshold = parseFloat(process.env.LEAK_THRESHOLD);
  const dailyQuotaLimit = parseFloat(process.env.DAILY_QUOTA_LIMIT);

  let reason = null;
  if (deltaQ > leakThreshold) {
    console.log('ANOMALY_DETECTED');
    reason = 'ANOMALY_DETECTED';
  } else if (sectorState.dailyVolumeUsed > dailyQuotaLimit) {
    console.log('QUOTA_EXCEEDED');
    reason = 'QUOTA_EXCEEDED';
  }

  if (reason) {
    handleBreach(reason, totalDownstreamFlow, deltaQ, dailyQuotaLimit);
  }
}

async function handleBreach(reason, totalDownstreamFlow, deltaQ, dailyQuotaLimit) {
  if (alertDispatched) return;
  alertDispatched = true;

  const scaled = {
    upstreamFlow: Math.round(sectorState.upstreamFlow * 100),
    totalDownstreamFlow: Math.round(totalDownstreamFlow * 100),
    deltaQ: Math.round(Math.max(0, deltaQ) * 100),
    dailyVolumeUsed: Math.round(sectorState.dailyVolumeUsed * 100),
    dailyQuotaLimit: Math.round(dailyQuotaLimit * 100),
  };

  if (process.env.DRY_RUN === 'true') {
    console.log(
      '[DRY RUN] Skipping blockchain transaction. Scaled uint256 payload:',
      scaled
    );
    publishValveClose(reason);
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      ABI,
      wallet
    );

    const sectorId = ethers.encodeBytes32String(process.env.SECTOR_ID);
    const tx = await contract.updateSectorState(
      sectorId,
      scaled.upstreamFlow,
      scaled.totalDownstreamFlow,
      scaled.deltaQ,
      scaled.dailyVolumeUsed,
      scaled.dailyQuotaLimit
    );

    console.log(`[CHAIN] Transaction submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`[CHAIN] Transaction confirmed: ${tx.hash}`);

    publishValveClose(reason);
  } catch (err) {
    console.error('[CHAIN] RPC / transaction error:', err.message || err);
    // Unlock so a later reading can retry after a transient RPC failure
    alertDispatched = false;
  }
}

function publishValveClose(reason) {
  const message = JSON.stringify({ command: 'CLOSE_VALVE', reason });
  client.publish('actuation/valve', message, (err) => {
    if (err) {
      console.error('[ACTUATION] Failed to publish CLOSE_VALVE:', err.message);
      return;
    }
    console.log('[ACTUATION] Published CLOSE_VALVE to actuation/valve');
  });
}
