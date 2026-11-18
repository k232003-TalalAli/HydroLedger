require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const { ethers } = require("ethers");

const ALPHA = 0.7;
const CHAIN_ID = 1338;
const LEGACY = { type: 0, gasPrice: 0 };
const CONFIRM_TIMEOUT_MS = 60000;

  const REGISTRY_ABI = [
  "function updateSectorState(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)",
  "function rolloverQuotaDay(bytes32 id)",
  "function sectorRegistry(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit, bool isValveClosed, uint256 lastUpdated)",
  "function leakThreshold() view returns (uint256)",
  "function dayOffsetSeconds() view returns (uint256)",
  "function closeCause(bytes32) view returns (uint8)",
];

const TELEMETRY_ABI = [
  "function recordSnapshot(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed)",
  "error TooSoon()",
];

const CAUSE_NONE = 0;
const CAUSE_LEAK = 1;
const CAUSE_QUOTA = 2;

function main() {
  const config = loadConfig();
  const state = createState(config);
  const chain = { provider: null, wallet: null, registry: null, telemetry: null, queue: Promise.resolve() };

  loadPersistedState(config, state);
  start(config, state, chain).catch((err) => {
    console.error("[CONFIG]", err.message || err);
    process.exit(1);
  });
}

async function start(config, state, chain) {
  const client = mqtt.connect(config.mqttUrl);
  wireMqtt(client, config, state, chain);

  if (!config.dryRun) {
    await initChain(config, chain);
    await pollChain(config, state, chain, false);
    setInterval(() => {
      pollChain(config, state, chain, true).catch((err) => {
        console.error("[CHAIN] Poll failed:", err.shortMessage || err.message || err);
      });
    }, config.chainPollSec * 1000);
  }

  if (state.needsRollover) {
    if (config.dryRun) {
      state.needsRollover = false;
      if (state.locked && state.closeCause === CAUSE_QUOTA) {
        state.chainValveClosed = false;
        publish(client, "OPEN_VALVE", "DAILY_ROLLOVER");
        clearLock(state);
        saveState(config, state);
      }
    } else {
      beginRollover(config, state, chain);
    }
  }

  setInterval(() => evaluate(config, state, chain), config.evalIntervalSec * 1000);
  setInterval(() => flushSnapshot(config, state, chain), config.snapshotIntervalMin * 60 * 1000);
  setInterval(() => saveState(config, state), 10000);
  evaluate(config, state, chain);

  if (state.locked) {
    publish(client, "CLOSE_VALVE", reasonFromCause(state.closeCause));
    if (!config.dryRun && !state.chainLogged && state.pendingBreach) {
      enqueue(chain, () => sendBreach(config, state, chain, state.pendingBreach));
    }
  }
}

function loadConfig() {
  const dryRun = process.env.DRY_RUN === "true";
  const sectorId = required("SECTOR_ID");
  const expected = required("EXPECTED_DOWNSTREAM")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (expected.length === 0) {
    fail("EXPECTED_DOWNSTREAM needs at least one node id.");
  }

  const upstreamNodeId = optional("UPSTREAM_NODE_ID", "Upstream_Master");
  const downstream = expected.filter((id) => id !== upstreamNodeId);
  if (downstream.length === 0) {
    fail("EXPECTED_DOWNSTREAM must list a node other than UPSTREAM_NODE_ID.");
  }

  let sectorIdBytes;
  try {
    sectorIdBytes = ethers.encodeBytes32String(sectorId);
  } catch (err) {
    fail(`SECTOR_ID cannot be encoded to bytes32 (${err.message}).`);
  }

  const config = {
    dryRun,
    sectorId,
    sectorIdBytes,
    mqttUrl: optional("MQTT_BROKER_URL", "mqtt://127.0.0.1:1883"),
    upstreamNodeId,
    downstream,
    leakThreshold: positiveNumber("LEAK_THRESHOLD", 5),
    dailyQuotaLimit: positiveNumber("DAILY_QUOTA_LIMIT", 5000),
    evalIntervalSec: positiveNumber("EVAL_INTERVAL_SEC", 2),
    staleAfterSec: positiveNumber("STALE_AFTER_SEC", 10),
    breachConsecutive: positiveInt("BREACH_CONSECUTIVE", 2),
    snapshotIntervalMin: positiveNumber("SNAPSHOT_INTERVAL_MIN", 10),
    chainPollSec: positiveNumber("CHAIN_POLL_SEC", 30),
    dayOffsetSeconds: nonNegativeNumber("DAY_OFFSET_SECONDS", 0),
    stateDir: optional("STATE_DIR", "./state"),
  };

  if (!dryRun) {
    config.rpcUrl = required("RPC_URL");
    config.contractAddress = requiredAddress("CONTRACT_ADDRESS");
    config.telemetryAddress = requiredAddress("TELEMETRY_CONTRACT_ADDRESS");
    config.privateKey = (process.env.PRIVATE_KEY || "").trim();
    config.keystorePath = (process.env.KEYSTORE_PATH || "").trim();
    config.keystorePassword = process.env.KEYSTORE_PASSWORD || "";
    if (!config.privateKey && !config.keystorePath) {
      fail("Live mode needs PRIVATE_KEY or KEYSTORE_PATH plus KEYSTORE_PASSWORD.");
    }
  }

  return config;
}

function createState(config) {
  const now = Date.now();
  return {
    sensors: {},
    ema: {},
    unexpectedLogged: new Set(),
    dailyVolumeUsed: 0,
    lastUpstreamMs: null,
    dayIndex: dayIndexAt(now, config.dayOffsetSeconds),
    dayOffsetSeconds: config.dayOffsetSeconds,
    leakThreshold: config.leakThreshold,
    quota: config.dailyQuotaLimit,
    locked: false,
    closeCause: CAUSE_NONE,
    chainLogged: false,
    pendingBreach: null,
    breachCount: 0,
    needsRollover: false,
    rolloverQueued: false,
    chainValveClosed: null,
    openedLocally: false,
    usingFallback: true,
    fallbackLogged: false,
    staleSignature: "",
    warmupSignature: "",
    lastWarmupLogMs: 0,
    window: emptyWindow(),
    client: null,
  };
}

function loadPersistedState(config, state) {
  const file = statePath(config);
  if (!fs.existsSync(file)) return;

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[STATE] Could not read state file, starting fresh:", err.message);
    return;
  }

  if (saved.dayIndex === state.dayIndex) {
    state.dailyVolumeUsed = Number(saved.dailyVolumeUsed) || 0;
    state.locked = Boolean(saved.locked);
    state.closeCause = Number(saved.closeCause) || CAUSE_NONE;
    state.chainLogged = Boolean(saved.chainLogged);
    state.pendingBreach = saved.pendingBreach || null;
    console.log(`[STATE] Restored ${config.sectorId} for day ${state.dayIndex}.`);
    return;
  }

  console.log("[STATE] Saved day is not today. Starting the new day.");
  // Volume stays at 0. A leak lock is kept so an owner reset can still reopen it.
  // A quota lock is kept until rollover confirms, then the valve opens.
  if (saved.locked && (saved.closeCause === CAUSE_LEAK || saved.closeCause === CAUSE_QUOTA)) {
    state.locked = true;
    state.closeCause = Number(saved.closeCause);
    state.chainLogged = Boolean(saved.chainLogged);
    state.pendingBreach = state.chainLogged ? null : saved.pendingBreach || null;
    state.needsRollover = true;
    console.log(
      state.closeCause === CAUSE_LEAK
        ? "[STATE] Leak closure carried into the new day."
        : "[STATE] Quota closure will reopen after rollover confirms."
    );
  } else if (Number.isFinite(saved.dayIndex)) {
    state.needsRollover = true;
  }
}

function wireMqtt(client, config, state, chain) {
  state.client = client;
  client.on("connect", () => {
    console.log(`[MQTT] Connected to ${config.mqttUrl}`);
    client.subscribe(["sensor/flow", "actuation/valve"], (err) => {
      if (err) {
        console.error("[MQTT] Failed to subscribe:", err.message);
        return;
      }
      console.log("[MQTT] Subscribed to sensor/flow and actuation/valve");
    });
  });

  client.on("error", (err) => {
    console.error("[MQTT] Client error:", err.message);
  });

  client.on("message", (topic, payload) => {
    if (topic === "actuation/valve") {
      onValveMessage(config, state, payload);
      return;
    }
    if (topic === "sensor/flow") {
      onFlowMessage(config, state, payload);
    }
  });
}

function onValveMessage(config, state, payload) {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }
  if (data.command !== "OPEN_VALVE") return;

  // Our own OPEN_VALVE publishes come back on this subscription. Clearing again is harmless.
  state.openedLocally = true;
  state.locked = false;
  state.dailyVolumeUsed = 0;
  state.breachCount = 0;
  state.closeCause = CAUSE_NONE;
  state.chainLogged = false;
  state.pendingBreach = null;
  saveState(config, state);
  console.log("[RESET] OPEN_VALVE received — alert lock cleared and sector re-armed.");

  if (!config.dryRun && state.chainValveClosed === true) {
    console.warn("[RESET] Chain still reports the valve closed. The owner must run reset-sector.js.");
  }
}

function onFlowMessage(config, state, payload) {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    console.log("[FILTERED] Dropped invalid reading:", payload.toString());
    return;
  }

  const nodeId = data.node_id;
  const flowRate = typeof data.flow_rate === "number" ? data.flow_rate : Number(data.flow_rate);
  if (!nodeId || typeof flowRate !== "number" || Number.isNaN(flowRate) || flowRate < 0 || flowRate >= 500) {
    console.log("[FILTERED] Dropped invalid reading:", data);
    return;
  }

  const known =
    nodeId === config.upstreamNodeId || config.downstream.includes(nodeId);
  if (!known) {
    if (!state.unexpectedLogged.has(nodeId)) {
      state.unexpectedLogged.add(nodeId);
      console.log(`[UNEXPECTED_NODE] Ignoring ${nodeId}`);
    }
    return;
  }

  const previous = state.ema[nodeId];
  const cleaned = previous === undefined ? flowRate : ALPHA * flowRate + (1 - ALPHA) * previous;
  state.ema[nodeId] = cleaned;

  const now = Date.now();
  state.sensors[nodeId] = { value: cleaned, timestamp: now };

  if (nodeId === config.upstreamNodeId) {
    let dt = 0;
    if (state.lastUpstreamMs != null) {
      dt = (now - state.lastUpstreamMs) / 1000;
      if (dt > config.staleAfterSec) dt = config.staleAfterSec;
      if (dt < 0) dt = 0;
    }
    state.lastUpstreamMs = now;
    state.dailyVolumeUsed += (cleaned / 60) * dt;
  }
}

function evaluate(config, state, chain) {
  const now = Date.now();
  rollDay(config, state, chain, now);

  const waiting = missingSensors(config, state);
  if (waiting.length > 0) {
    logWarmup(state, waiting, now);
    return;
  }

  const upstream = state.sensors[config.upstreamNodeId].value;
  const downstream = downstreamSum(config, state);
  const deltaQ = upstream - downstream;
  console.log(
    `[TELEMETRY] Upstream=${upstream.toFixed(2)} | ` +
      `Total Downstream=${downstream.toFixed(2)} | ` +
      `DeltaQ=${deltaQ.toFixed(2)} | ` +
      `Volume Used=${state.dailyVolumeUsed.toFixed(2)} L`
  );

  const stale = staleSensors(config, state, now);
  if (stale.length > 0) {
    const signature = stale.join(",");
    if (signature !== state.staleSignature) {
      state.staleSignature = signature;
      console.log(`[SENSOR_STALE] ${signature}`);
    }
    state.breachCount = 0;
    if (!state.locked && state.dailyVolumeUsed > state.quota) {
      triggerBreach(config, state, chain, "QUOTA_EXCEEDED", downstream, deltaQ);
    }
    return;
  }

  if (state.staleSignature) {
    state.staleSignature = "";
    console.log("[SENSOR_STALE] clear");
  }

  state.window.n += 1;
  state.window.up += upstream;
  state.window.down += downstream;
  state.window.dq += deltaQ;

  if (state.locked) return;

  if (deltaQ > state.leakThreshold) {
    state.breachCount += 1;
    if (state.breachCount >= config.breachConsecutive) {
      triggerBreach(config, state, chain, "ANOMALY_DETECTED", downstream, deltaQ);
    }
    return;
  }

  state.breachCount = 0;
  if (state.dailyVolumeUsed > state.quota) {
    triggerBreach(config, state, chain, "QUOTA_EXCEEDED", downstream, deltaQ);
  }
}

function triggerBreach(config, state, chain, reason, downstream, deltaQ) {
  if (state.locked) return;

  state.openedLocally = false;
  state.locked = true;
  state.closeCause = reason === "ANOMALY_DETECTED" ? CAUSE_LEAK : CAUSE_QUOTA;
  state.chainLogged = false;
  state.breachCount = 0;
  state.pendingBreach = {
    upstream: scale(state.sensors[config.upstreamNodeId].value),
    downstream: scale(downstream),
    deltaQ: scale(Math.max(0, deltaQ)),
    volume: scale(state.dailyVolumeUsed),
    quota: scale(state.quota),
  };
  saveState(config, state);

  publish(state.client, "CLOSE_VALVE", reason);

  if (config.dryRun) {
    console.log("[DRY RUN] Skipping blockchain transaction. Scaled uint256 payload:", state.pendingBreach);
    return;
  }

  const payload = state.pendingBreach;
  enqueue(chain, () => sendBreach(config, state, chain, payload));
}

function flushSnapshot(config, state, chain) {
  if (state.window.n === 0) {
    console.log("[SNAPSHOT] Window empty, skipped.");
    return;
  }

  const n = state.window.n;
  const payload = {
    upstream: scale(state.window.up / n),
    downstream: scale(state.window.down / n),
    deltaQ: scale(Math.max(0, state.window.dq / n)),
    volume: scale(state.dailyVolumeUsed),
  };
  state.window = emptyWindow();

  if (config.dryRun) {
    console.log("[DRY RUN] Snapshot payload:", payload);
    return;
  }

  enqueue(chain, () => sendSnapshot(chain, config, payload));
}

function rollDay(config, state, chain, now) {
  const today = dayIndexAt(now, state.dayOffsetSeconds);
  if (today <= state.dayIndex) return;

  const cause = state.closeCause;
  const wasLocked = state.locked;
  state.dayIndex = today;
  state.dailyVolumeUsed = 0;
  state.window = emptyWindow();
  saveState(config, state);
  console.log(`[DAY] Rolled local volume to day ${today}.`);

  if (config.dryRun) {
    if (wasLocked && cause === CAUSE_QUOTA) {
      state.chainValveClosed = false;
      publish(state.client, "OPEN_VALVE", "DAILY_ROLLOVER");
      clearLock(state);
      saveState(config, state);
    }
    return;
  }

  beginRollover(config, state, chain);
}

function beginRollover(config, state, chain) {
  if (config.dryRun || state.rolloverQueued) return;
  state.rolloverQueued = true;
  state.needsRollover = false;
  enqueue(chain, () => sendRollover(config, state, chain));
}

async function initChain(config, chain) {
  chain.provider = new ethers.JsonRpcProvider(config.rpcUrl, CHAIN_ID, { staticNetwork: true });
  if (config.privateKey) {
    chain.wallet = new ethers.Wallet(config.privateKey, chain.provider);
  } else {
    const json = fs.readFileSync(config.keystorePath, "utf8");
    const unlocked = await ethers.Wallet.fromEncryptedJson(json, config.keystorePassword);
    chain.wallet = unlocked.connect(chain.provider);
  }
  chain.registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI, chain.wallet);
  chain.telemetry = new ethers.Contract(config.telemetryAddress, TELEMETRY_ABI, chain.wallet);
  console.log(`[CHAIN] Reporter ${chain.wallet.address} via ${config.rpcUrl}`);
}

async function pollChain(config, state, chain, announceAdoptedClose) {
  if (config.dryRun) return;

  let sector;
  let leakRaw;
  let offsetRaw;
  let causeRaw;
  try {
    [sector, leakRaw, offsetRaw, causeRaw] = await Promise.all([
      chain.registry.sectorRegistry(config.sectorIdBytes),
      chain.registry.leakThreshold(),
      chain.registry.dayOffsetSeconds(),
      chain.registry.closeCause(config.sectorIdBytes),
    ]);
  } catch (err) {
    if (!state.fallbackLogged) {
      console.error("[CHAIN] RPC unreachable or read failed. Using .env fallback.", err.shortMessage || err.message);
      state.fallbackLogged = true;
    }
    state.usingFallback = true;
    return;
  }

  if (sector.dailyQuotaLimit === 0n) {
    if (!state.fallbackLogged) {
      console.error(`[CHAIN] ${config.sectorId} is missing on-chain. Using .env fallback.`);
      state.fallbackLogged = true;
    }
    state.usingFallback = true;
    return;
  }

  state.fallbackLogged = false;
  state.usingFallback = false;

  const quota = fromChain(sector.dailyQuotaLimit);
  const leak = fromChain(leakRaw);
  const offset = Number(offsetRaw);
  if (quota !== state.quota) {
    console.log(`[CHAIN] dailyQuotaLimit ${state.quota} -> ${quota}`);
    state.quota = quota;
  }
  if (leak !== state.leakThreshold) {
    console.log(`[CHAIN] leakThreshold ${state.leakThreshold} -> ${leak}`);
    state.leakThreshold = leak;
  }
  if (offset !== state.dayOffsetSeconds) {
    console.log(`[CHAIN] dayOffsetSeconds ${state.dayOffsetSeconds} -> ${offset}`);
    state.dayOffsetSeconds = offset;
  }

  state.chainValveClosed = Boolean(sector.isValveClosed);
  if (state.openedLocally && state.chainValveClosed === false) {
    state.openedLocally = false;
  }

  // A manual OPEN_VALVE stays local until the owner resets the chain. Do not force it shut again.
  if (!state.locked && state.chainValveClosed && !state.openedLocally) {
    state.locked = true;
    state.chainLogged = true;
    state.closeCause = Number(causeRaw);
    state.pendingBreach = null;
    saveState(config, state);
    console.log("[CHAIN] Adopted on-chain valve closure.");
    if (announceAdoptedClose) {
      publish(state.client, "CLOSE_VALVE", reasonFromCause(state.closeCause));
    }
  }

  if (state.locked && state.chainLogged && state.chainValveClosed === false) {
    console.log("[CHAIN] Owner reset observed.");
    state.chainValveClosed = false;
    publish(state.client, "OPEN_VALVE", "OWNER_RESET");
    clearLock(state);
    state.dailyVolumeUsed = 0;
    saveState(config, state);
  }
}

function enqueue(chain, job) {
  const run = chain.queue.then(job, job);
  chain.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function sendBreach(config, state, chain, payload) {
  let delay = 5000;
  let pending = null;
  let resendNonce = null;

  for (;;) {
    try {
      if (pending) {
        const receipt = await chain.provider.getTransactionReceipt(pending.hash);
        if (receipt && receipt.status === 1) {
          markBreachLogged(config, state);
          console.log(`[CHAIN] Breach confirmed ${pending.hash}`);
          return;
        }
        if (receipt && receipt.status === 0) {
          console.error(`[CHAIN] Breach reverted ${pending.hash}. Lock stays. Not retrying a revert.`);
          return;
        }
        const found = await chain.provider.getTransaction(pending.hash);
        if (found) {
          await sleep(delay);
          delay = Math.min(delay * 2, 60000);
          continue;
        }
        resendNonce = pending.nonce;
        pending = null;
      }

      const overrides = resendNonce === null ? LEGACY : { ...LEGACY, nonce: resendNonce };
      resendNonce = null;
      const tx = await chain.registry.updateSectorState(
        config.sectorIdBytes,
        payload.upstream,
        payload.downstream,
        payload.deltaQ,
        payload.volume,
        payload.quota,
        overrides
      );
      pending = { hash: tx.hash, nonce: tx.nonce };
      console.log(`[CHAIN] Breach submitted ${tx.hash}`);

      const receipt = await Promise.race([tx.wait(), sleep(CONFIRM_TIMEOUT_MS).then(() => null)]);
      if (receipt && receipt.status === 1) {
        markBreachLogged(config, state);
        console.log(`[CHAIN] Breach confirmed ${tx.hash}`);
        return;
      }
      if (receipt && receipt.status === 0) {
        console.error(`[CHAIN] Breach reverted ${tx.hash}. Lock stays. Not retrying a revert.`);
        return;
      }
      console.error(`[CHAIN] Breach confirmation timeout ${tx.hash}`);
    } catch (err) {
      const msg = err.shortMessage || err.message || String(err);
      console.error(`[CHAIN] Breach error: ${msg}`);
      if (err.code === "CALL_EXCEPTION" || err.receipt) {
        console.error("[CHAIN] Breach reverted. Lock stays. Not retrying a revert.");
        return;
      }
      pending = null;
    }

    await sleep(delay);
    delay = Math.min(delay * 2, 60000);
  }
}

async function sendSnapshot(chain, config, payload) {
  try {
    const tx = await chain.telemetry.recordSnapshot(
      config.sectorIdBytes,
      payload.upstream,
      payload.downstream,
      payload.deltaQ,
      payload.volume,
      LEGACY
    );
    console.log(`[CHAIN] Snapshot submitted ${tx.hash}`);
    const receipt = await Promise.race([tx.wait(), sleep(CONFIRM_TIMEOUT_MS).then(() => null)]);
    if (!receipt) {
      console.error(`[CHAIN] Snapshot confirmation timeout ${tx.hash}. Will try the next interval.`);
      return;
    }
    if (receipt.status === 0) {
      console.error(`[CHAIN] Snapshot reverted ${tx.hash}`);
      return;
    }
    console.log(`[CHAIN] Snapshot confirmed ${tx.hash}`);
  } catch (err) {
    const msg = err.shortMessage || err.message || String(err);
    if (/TooSoon/i.test(msg)) {
      console.log("[CHAIN] Snapshot rejected: TooSoon");
      return;
    }
    console.error(`[CHAIN] Snapshot failed: ${msg}`);
  }
}

async function sendRollover(config, state, chain) {
  let pending = null;
  let resendNonce = null;
  for (;;) {
    try {
      if (pending) {
        const receipt = await chain.provider.getTransactionReceipt(pending.hash);
        if (receipt && receipt.status === 1) {
          finishRollover(config, state);
          console.log(`[CHAIN] Rollover confirmed ${pending.hash}`);
          return;
        }
        if (receipt && receipt.status === 0) {
          console.error(`[CHAIN] Rollover reverted ${pending.hash}. Retry in 60s.`);
          pending = null;
          resendNonce = null;
          await sleep(60000);
          continue;
        }
        const found = await chain.provider.getTransaction(pending.hash);
        if (found) {
          await sleep(60000);
          continue;
        }
        resendNonce = pending.nonce;
        pending = null;
      }

      const tx = await chain.registry.rolloverQuotaDay(
        config.sectorIdBytes,
        resendNonce === null ? LEGACY : { ...LEGACY, nonce: resendNonce }
      );
      resendNonce = null;
      pending = { hash: tx.hash, nonce: tx.nonce };
      console.log(`[CHAIN] Rollover submitted ${tx.hash}`);
      const receipt = await Promise.race([tx.wait(), sleep(CONFIRM_TIMEOUT_MS).then(() => null)]);
      if (receipt && receipt.status === 1) {
        finishRollover(config, state);
        console.log(`[CHAIN] Rollover confirmed ${tx.hash}`);
        return;
      }
      console.error("[CHAIN] Rollover not confirmed. Retry in 60s.");
    } catch (err) {
      console.error(`[CHAIN] Rollover failed, retry in 60s: ${err.shortMessage || err.message || err}`);
      pending = null;
    }
    await sleep(60000);
  }
}

function finishRollover(config, state) {
  state.rolloverQueued = false;
  if (state.locked && state.closeCause === CAUSE_QUOTA) {
    state.chainValveClosed = false;
    publish(state.client, "OPEN_VALVE", "DAILY_ROLLOVER");
    clearLock(state);
  }
  saveState(config, state);
}

function markBreachLogged(config, state) {
  state.pendingBreach = null;
  if (state.locked && !state.openedLocally) {
    state.chainLogged = true;
  }
  saveState(config, state);
}

function clearLock(state) {
  state.locked = false;
  state.closeCause = CAUSE_NONE;
  state.chainLogged = false;
  state.pendingBreach = null;
  state.breachCount = 0;
}

function publish(client, command, reason) {
  if (!client) return;
  const message = JSON.stringify({ command, reason });
  client.publish("actuation/valve", message, (err) => {
    if (err) {
      console.error(`[ACTUATION] Failed to publish ${command}:`, err.message);
      return;
    }
    console.log(`[ACTUATION] Published ${command} reason=${reason}`);
  });
}

function missingSensors(config, state) {
  const waiting = [];
  if (!state.sensors[config.upstreamNodeId]) waiting.push(config.upstreamNodeId);
  for (const id of config.downstream) {
    if (!state.sensors[id]) waiting.push(id);
  }
  return waiting;
}

function staleSensors(config, state, now) {
  const stale = [];
  const limit = config.staleAfterSec * 1000;
  const required = [config.upstreamNodeId, ...config.downstream];
  for (const id of required) {
    const sensor = state.sensors[id];
    if (!sensor || now - sensor.timestamp > limit) stale.push(id);
  }
  return stale;
}

function downstreamSum(config, state) {
  let sum = 0;
  for (const id of config.downstream) {
    sum += state.sensors[id].value;
  }
  return sum;
}

function logWarmup(state, waiting, now) {
  const signature = waiting.join(",");
  if (signature === state.warmupSignature && now - state.lastWarmupLogMs < 10000) return;
  state.warmupSignature = signature;
  state.lastWarmupLogMs = now;
  console.log(`[WARMUP] waiting for: ${signature}`);
}

function saveState(config, state) {
  const file = statePath(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify(
    {
      dayIndex: state.dayIndex,
      dailyVolumeUsed: state.dailyVolumeUsed,
      locked: state.locked,
      closeCause: state.closeCause,
      chainLogged: state.chainLogged,
      pendingBreach: state.pendingBreach,
    },
    null,
    2
  );
  atomicWrite(file, body);
}

function statePath(config) {
  return path.join(config.stateDir, `${config.sectorId}.json`);
}

function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function emptyWindow() {
  return { n: 0, up: 0, down: 0, dq: 0 };
}

function dayIndexAt(nowMs, offsetSeconds) {
  return Math.floor((Math.floor(nowMs / 1000) + offsetSeconds) / 86400);
}

function reasonFromCause(cause) {
  if (cause === CAUSE_QUOTA) return "QUOTA_EXCEEDED";
  return "ANOMALY_DETECTED";
}

function scale(value) {
  return Math.round(value * 100);
}

function fromChain(value) {
  return Number(value) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) fail(`Missing required variable ${name}.`);
  return value;
}

function requiredAddress(name) {
  const value = required(name);
  if (!ethers.isAddress(value)) fail(`${name} is not an Ethereum address.`);
  return value;
}

function optional(name, fallback) {
  const value = (process.env[name] || "").trim();
  return value || fallback;
}

function positiveNumber(name, fallback) {
  const value = numberOrDefault(name, fallback);
  if (value <= 0) fail(`${name} must be greater than 0.`);
  return value;
}

function positiveInt(name, fallback) {
  const value = positiveNumber(name, fallback);
  if (!Number.isInteger(value)) fail(`${name} must be a whole number.`);
  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = numberOrDefault(name, fallback);
  if (value < 0) fail(`${name} must be 0 or greater.`);
  return value;
}

function numberOrDefault(name, fallback) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`${name} must be a number.`);
  return value;
}

function fail(message) {
  console.error(`[CONFIG] ${message}`);
  process.exit(1);
}

main();
