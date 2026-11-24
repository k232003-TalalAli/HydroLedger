require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const { ethers } = require("ethers");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ALPHA = 0.7; // EMA weight of the newest reading
const CHAIN_ID = 1338;
const LEGACY = { type: 0, gasPrice: 0 }; // same as chain-client/chain.js: free gas, legacy tx
const CONFIRM_TIMEOUT_MS = 60000; // never wait longer than this for one confirmation
const RPC_TIMEOUT_MS = 20000; // a hung RPC must not stall anything for minutes
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;
const ROLLOVER_RETRY_MS = 60000; // after an RPC or send failure
const ROLLOVER_NOT_YET_MS = 15000; // chain clock has not reached the new day yet (small clock skew)
// Time-dependent writes (rollover, snapshot) are sent with a fixed gas limit, so the node does not
// pre-simulate them. A simulation runs against the latest block, which on a QBFT chain with empty
// blocks every hour can be old, and it would refuse a call the next real block accepts. Failed
// transactions cost nothing here (gasPrice 0).
const ROLLOVER_GAS_LIMIT = 300000;
const SNAPSHOT_GAS_LIMIT = 500000;

const CAUSE_NONE = 0;
const CAUSE_LEAK = 1;
const CAUSE_QUOTA = 2;

// Own OPEN_VALVE publishes come back on our subscription. These reasons are only ever
// set by this program, so a message carrying one is an echo and has already been applied.
const SELF_OPEN_REASONS = new Set(["OWNER_RESET", "DAILY_ROLLOVER"]);

// Human-readable ABIs. Scaling (x100) happens in scale()/fromChain() only.
const REGISTRY_ABI = [
  "function updateSectorState(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)",
  "function rolloverQuotaDay(bytes32 id)",
  "function sectorRegistry(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit, bool isValveClosed, uint256 lastUpdated)",
  "function leakThreshold() view returns (uint256)",
  "function dayOffsetSeconds() view returns (uint256)",
  "function dayLengthSeconds() view returns (uint256)",
  "function manualDayShift() view returns (uint256)",
  "function quotaDay(bytes32) view returns (uint256)",
  "error RolloverNotDue()",
];

const TELEMETRY_ABI = [
  "function recordSnapshot(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed)",
  "error TooSoon()",
];

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
function main() {
  const config = loadConfig();
  const state = createState(config);
  const chain = {
    provider: null,
    wallet: null,
    registry: null,
    telemetry: null,
    ready: Promise.resolve(), // resolves when the wallet/contracts exist (live mode)
    queue: Promise.resolve(), // the single serial writer queue
  };

  loadPersistedState(config, state);
  start(config, state, chain);
}

function start(config, state, chain) {
  const client = mqtt.connect(config.mqttUrl);
  wireMqtt(client, config, state);

  // Valve protection starts first and never waits for the chain.
  setInterval(safe("evaluate", () => evaluate(config, state, chain)), config.evalIntervalSec * 1000);
  setInterval(safe("snapshot", () => flushSnapshot(config, state, chain)), config.snapshotIntervalMin * 60 * 1000);
  setInterval(safe("save", () => saveState(config, state)), 10000);

  if (config.dryRun) {
    // DRY_RUN makes no RPC calls at all. A day change left over in the state file is applied locally.
    if (state.needsRollover) {
      state.needsRollover = false;
      applyDryRunRollover(config, state);
    }
  } else {
    chain.ready = initChain(config, chain).catch((err) => {
      console.error("[CONFIG] Cannot create the reporter wallet:", err.shortMessage || err.message || err);
      process.exit(1);
    });
    // Jobs wait for the wallet; the first poll and a pending rollover go through the queue.
    chain.ready.then(() => pollChain(config, state, chain).catch(logPollError));
    setInterval(() => pollChain(config, state, chain).catch(logPollError), config.chainPollSec * 1000);

    if (state.needsRollover) beginRollover(config, state, chain);
    if (state.locked && !state.chainLogged && state.pendingBreach) {
      const seq = state.breachSeq;
      const payload = state.pendingBreach;
      enqueue(chain, () => sendBreach(config, state, chain, payload, seq));
    }
  }

  process.on("SIGINT", () => shutdown(config, state));
  process.on("SIGTERM", () => shutdown(config, state));
  process.on("unhandledRejection", (err) => {
    console.error("[ERROR] Unhandled rejection:", err && (err.shortMessage || err.message || err));
  });

  evaluate(config, state, chain);
}

function shutdown(config, state) {
  try {
    saveState(config, state);
  } catch (err) {
    console.error("[STATE] Could not save on exit:", err.message);
  }
  process.exit(0);
}

function safe(label, fn) {
  return () => {
    try {
      const out = fn();
      if (out && typeof out.catch === "function") {
        out.catch((err) => console.error(`[ERROR] ${label}:`, err.shortMessage || err.message || err));
      }
    } catch (err) {
      console.error(`[ERROR] ${label}:`, err.shortMessage || err.message || err);
    }
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
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
  const downstream = [...new Set(expected.filter((id) => id !== upstreamNodeId))];
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
    snapshotIntervalMin: positiveNumber("SNAPSHOT_INTERVAL_MIN", 4),
    chainPollSec: positiveNumber("CHAIN_POLL_SEC", 30),
    dayLengthSeconds: positiveInt("DAY_LENGTH_SECONDS", 600), // one quota "day"; the chain value wins
    dayOffsetSeconds: nonNegativeNumber("DAY_OFFSET_SECONDS", 0),
    stateDir: optional("STATE_DIR", "./state"),
  };
  if (config.dayOffsetSeconds >= config.dayLengthSeconds) fail("DAY_OFFSET_SECONDS must be below DAY_LENGTH_SECONDS.");

  if (!dryRun) {
    config.rpcUrl = required("RPC_URL");
    config.contractAddress = requiredAddress("CONTRACT_ADDRESS");
    config.telemetryAddress = requiredAddress("TELEMETRY_CONTRACT_ADDRESS");
    config.privateKey = (process.env.PRIVATE_KEY || "").trim();
    config.keystorePath = (process.env.KEYSTORE_PATH || "").trim();
    config.keystorePassword = process.env.KEYSTORE_PASSWORD || "";
    if (!config.privateKey && !config.keystorePath) {
      fail("Live mode needs PRIVATE_KEY (or KEYSTORE_PATH plus KEYSTORE_PASSWORD).");
    }
  }

  return config;
}

function createState(config) {
  const now = Date.now();
  const state = {
    sensors: {}, // node_id -> { value, timestamp }
    ema: {},
    unexpectedLogged: new Set(),
    dailyVolumeUsed: 0, // litres (float, not scaled)
    lastUpstreamMs: null,
    dayLengthSeconds: config.dayLengthSeconds, // replaced by the chain value
    dayOffsetSeconds: config.dayOffsetSeconds, // replaced by the chain value
    dayShift: 0, // days the owner advanced by hand (chain manualDayShift)
    dayIndex: 0, // set just below, from the three values above
    offsetSynced: false,
    leakThreshold: config.leakThreshold, // L/min, replaced by the chain value
    quota: config.dailyQuotaLimit, // litres, replaced by the chain value
    locked: false,
    closeCause: CAUSE_NONE,
    chainLogged: false, // the breach write was confirmed on-chain
    chainClosedSeen: false, // after that, the chain was seen reporting a closed valve
    pendingBreach: null,
    breachSeq: 0, // identifies the current breach so a stale write cannot mark a new one
    breachCount: 0,
    needsRollover: false,
    rolloverQueued: false,
    rolloverTrack: newTrack(),
    snapshotBusy: false,
    chainValveClosed: null,
    mismatchLogged: false,
    fallbackLogged: false,
    staleSignature: "",
    warmupSignature: "",
    lastWarmupLogMs: 0,
    window: emptyWindow(),
    client: null,
  };
  state.dayIndex = todayIndex(state, now);
  return state;
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

  // Last day parameters seen on the chain (a manual day advance changes them). Use them so a
  // restart does not mistake today's day for a different one.
  if (Number.isInteger(saved.dayLengthSeconds) && saved.dayLengthSeconds > 0) {
    state.dayLengthSeconds = saved.dayLengthSeconds;
    state.dayOffsetSeconds = Number.isInteger(saved.dayOffsetSeconds) && saved.dayOffsetSeconds >= 0 ? saved.dayOffsetSeconds : state.dayOffsetSeconds;
    state.dayShift = Number.isInteger(saved.dayShift) && saved.dayShift >= 0 ? saved.dayShift : 0;
    state.dayIndex = todayIndex(state, Date.now());
  }

  const savedLocked = Boolean(saved.locked) && (saved.closeCause === CAUSE_LEAK || saved.closeCause === CAUSE_QUOTA);

  if (saved.dayIndex === state.dayIndex) {
    state.dailyVolumeUsed = Number(saved.dailyVolumeUsed) || 0;
    state.locked = savedLocked;
    state.closeCause = savedLocked ? Number(saved.closeCause) : CAUSE_NONE;
    state.chainLogged = savedLocked && Boolean(saved.chainLogged);
    state.chainClosedSeen = savedLocked && Boolean(saved.chainClosedSeen);
    state.pendingBreach = savedLocked ? saved.pendingBreach || null : null;
    console.log(`[STATE] Restored ${config.sectorId} for day ${state.dayIndex}${state.locked ? " (valve locked)" : ""}.`);
    return;
  }

  console.log("[STATE] Saved day is not today. Starting the new day.");
  // Volume stays 0. A leak lock is kept so an owner reset can still reopen it.
  // A quota lock is kept until the rollover is confirmed, then the valve opens.
  if (savedLocked) {
    state.locked = true;
    state.closeCause = Number(saved.closeCause);
    state.chainLogged = Boolean(saved.chainLogged);
    state.chainClosedSeen = Boolean(saved.chainClosedSeen);
    state.pendingBreach = state.chainLogged ? null : saved.pendingBreach || null;
    console.log(
      state.closeCause === CAUSE_LEAK
        ? "[STATE] Leak closure carried into the new day."
        : "[STATE] Quota closure will reopen after the rollover is confirmed."
    );
  }
  if (Number.isFinite(saved.dayIndex) && saved.dayIndex < state.dayIndex) {
    state.needsRollover = true;
  }
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------
function wireMqtt(client, config, state) {
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
    // After a restart or a broker reconnect, say again that the valve must be closed.
    if (state.locked) {
      publish(client, "CLOSE_VALVE", reasonFromCause(state.closeCause));
      zeroFlowSensors(config, state);
      publishFlowZeros(config, state);
    }
  });

  client.on("error", (err) => {
    console.error("[MQTT] Client error:", err.message);
  });

  client.on("message", (topic, payload) => {
    try {
      if (topic === "actuation/valve") onValveMessage(config, state, payload);
      else if (topic === "sensor/flow") onFlowMessage(config, state, payload);
    } catch (err) {
      console.error("[ERROR] Message handler:", err.message);
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
  if (!data || typeof data !== "object" || data.command !== "OPEN_VALVE") return;
  if (SELF_OPEN_REASONS.has(data.reason)) return; // our own publish coming back: already applied

  // Local effect only. Nothing is written to the chain.
  state.locked = false;
  state.dailyVolumeUsed = 0;
  state.breachCount = 0;
  state.closeCause = CAUSE_NONE;
  state.chainLogged = false;
  state.chainClosedSeen = false;
  state.pendingBreach = null;
  saveState(config, state);
  console.log("[RESET] OPEN_VALVE received — alert lock cleared and sector re-armed.");

  if (!config.dryRun && state.chainValveClosed === true) {
    console.warn("[RESET] The chain still reports this valve CLOSED, until the Bootnode approves the reset.");
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

  const nodeId = data && typeof data === "object" ? data.node_id : undefined;
  const raw = data && typeof data === "object" ? data.flow_rate : undefined;
  // Only real numbers or numeric strings. null, "", booleans and objects are dropped.
  const flowRate = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  if (!nodeId || typeof nodeId !== "string" || Number.isNaN(flowRate) || flowRate < 0 || flowRate >= 500) {
    console.log("[FILTERED] Dropped invalid reading:", data);
    return;
  }

  const known = nodeId === config.upstreamNodeId || config.downstream.includes(nodeId);
  if (!known) {
    if (!state.unexpectedLogged.has(nodeId)) {
      state.unexpectedLogged.add(nodeId);
      console.log(`[UNEXPECTED_NODE] Ignoring ${nodeId}`);
    }
    return;
  }

  const now = Date.now();

  // Valve closed: no water through the sector. Keep a heartbeat so sensors stay fresh,
  // but force readings to 0 even if the simulator keeps publishing non-zero flows.
  if (state.locked) {
    state.ema[nodeId] = 0;
    state.sensors[nodeId] = { value: 0, timestamp: now };
    if (nodeId === config.upstreamNodeId) state.lastUpstreamMs = now;
    return;
  }

  const previous = state.ema[nodeId];
  const cleaned = previous === undefined ? flowRate : ALPHA * flowRate + (1 - ALPHA) * previous;
  state.ema[nodeId] = cleaned;

  state.sensors[nodeId] = { value: cleaned, timestamp: now };

  if (nodeId === config.upstreamNodeId) {
    // Volume by real elapsed time, capped so a long silence cannot add a huge block.
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

// ---------------------------------------------------------------------------
// Evaluation tick
// ---------------------------------------------------------------------------
function evaluate(config, state, chain) {
  const now = Date.now();
  rollDay(config, state, chain, now);

  // Warm-up gate: no decision before every required sensor has reported once.
  const waiting = missingSensors(config, state);
  if (waiting.length > 0) {
    logWarmup(state, waiting, now);
    return;
  }

  // While locked, physical flow is zero (simulator chatter is ignored in onFlowMessage).
  if (state.locked) zeroFlowSensors(config, state);
  const upstream = state.locked ? 0 : state.sensors[config.upstreamNodeId].value;
  const downstream = state.locked ? 0 : downstreamSum(config, state);
  const deltaQ = upstream - downstream;
  console.log(
    `[TELEMETRY] Upstream=${upstream.toFixed(2)} | ` +
      `Total Downstream=${downstream.toFixed(2)} | ` +
      `DeltaQ=${deltaQ.toFixed(2)} | ` +
      `Volume Used=${state.dailyVolumeUsed.toFixed(2)} L` +
      (state.locked ? " | VALVE CLOSED: flow forced to 0" : "")
  );

  // Freshness. A stale sensor never closes the valve; the quota check still runs.
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

  // Snapshot window: only warm and fresh ticks. With the valve closed no water moves, so the
  // snapshot records 0 flow even if a simulator (or a faulty sensor) keeps publishing a value.
  state.window.n += 1;
  if (!state.locked) {
    state.window.up += upstream;
    state.window.down += downstream;
    state.window.dq += deltaQ;
  }

  if (state.locked) return;

  // Leak: must hold for BREACH_CONSECUTIVE ticks. Leak takes precedence over quota.
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

  state.locked = true;
  state.closeCause = reason === "ANOMALY_DETECTED" ? CAUSE_LEAK : CAUSE_QUOTA;
  state.chainLogged = false;
  state.chainClosedSeen = false;
  state.breachCount = 0;
  state.breachSeq += 1;
  state.pendingBreach = {
    upstream: scale(state.sensors[config.upstreamNodeId].value),
    downstream: scale(downstream),
    deltaQ: scale(Math.max(0, deltaQ)),
    volume: scale(state.dailyVolumeUsed),
    quota: scale(state.quota),
  };

  // 1. The valve first. Nothing below may delay or undo this.
  publish(state.client, "CLOSE_VALVE", reason);

  // 2. Stop the waterfall: zero local sensors and tell MQTT consumers (UI / sims) flow is 0.
  zeroFlowSensors(config, state);
  publishFlowZeros(config, state);

  // 3. Then remember it, then (live mode) queue the chain write.
  try {
    saveState(config, state);
  } catch (err) {
    console.error("[STATE] Save failed:", err.message);
  }

  if (config.dryRun) {
    console.log("[DRY RUN] Skipping blockchain transaction. Scaled uint256 payload:", state.pendingBreach);
    return;
  }

  const payload = state.pendingBreach;
  const seq = state.breachSeq;
  enqueue(chain, () => sendBreach(config, state, chain, payload, seq));
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
function flushSnapshot(config, state, chain) {
  if (state.window.n === 0) {
    console.log("[SNAPSHOT] Window empty, skipped.");
    return;
  }
  if (!config.dryRun && state.snapshotBusy) {
    // The previous snapshot has not left the queue yet (chain slow or halted). Keep accumulating.
    console.log("[SNAPSHOT] Previous snapshot still in flight, skipped.");
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

  state.snapshotBusy = true;
  enqueue(chain, () => sendSnapshot(config, state, chain, payload)).finally(() => {
    state.snapshotBusy = false;
  });
}

// ---------------------------------------------------------------------------
// Daily rollover
// ---------------------------------------------------------------------------
function rollDay(config, state, chain, now) {
  const today = todayIndex(state, now);
  if (today <= state.dayIndex) return;

  state.dayIndex = today;
  state.dailyVolumeUsed = 0; // accounting is local, so it resets straight away
  state.window = emptyWindow();
  console.log(`[DAY] Rolled local volume to day ${today}.`);

  if (config.dryRun) {
    applyDryRunRollover(config, state);
  } else {
    beginRollover(config, state, chain);
  }
  saveState(config, state);
}

function applyDryRunRollover(config, state) {
  if (state.locked && state.closeCause === CAUSE_QUOTA) {
    publish(state.client, "OPEN_VALVE", "DAILY_ROLLOVER");
    clearLock(state);
  }
  saveState(config, state);
}

function beginRollover(config, state, chain) {
  if (config.dryRun || state.rolloverQueued) return;
  state.rolloverQueued = true;
  state.needsRollover = false;
  enqueue(chain, () => runRollover(config, state, chain));
}

async function runRollover(config, state, chain) {
  const target = state.dayIndex;

  // Ask the chain first. If the sector's stored day already reached the day we want (the owner
  // rolled it over, or an earlier attempt of ours landed), there is nothing to send.
  const stored = await readStoredDay(config, chain);
  if (stored == null) return scheduleRolloverRetry(config, state, chain, ROLLOVER_RETRY_MS, "could not read the stored day");
  if (stored >= target) return rolloverAlreadyDone(config, state, stored, target);

  const result = await submitOnce(chain, "Rollover", state.rolloverTrack, (o) =>
    chain.registry.rolloverQuotaDay(config.sectorIdBytes, { ...o, gasLimit: ROLLOVER_GAS_LIMIT })
  );

  if (result.status === "confirmed") {
    state.rolloverTrack = newTrack();
    finishRollover(config, state);
    return;
  }
  if (result.status === "reverted") state.rolloverTrack = newTrack();

  // The send failed or was refused. Check the chain again before deciding what that means.
  const after = await readStoredDay(config, chain);
  if (after != null && after >= target) return rolloverAlreadyDone(config, state, after, target);

  const why = `${result.status}${result.message ? ` (${result.message})` : ""}`;
  if (after != null) {
    // Refused by the chain while the stored day is still behind: its clock has not reached the new day yet.
    return scheduleRolloverRetry(config, state, chain, ROLLOVER_NOT_YET_MS, `${why}, stored day ${after} < ${target}, chain clock not at the new day yet`);
  }
  scheduleRolloverRetry(config, state, chain, ROLLOVER_RETRY_MS, why);
}

/** The sector's stored day on the chain, or null if it cannot be read right now. */
async function readStoredDay(config, chain) {
  try {
    return Number(await chain.registry.quotaDay(config.sectorIdBytes));
  } catch (err) {
    console.error("[CHAIN] Could not read quotaDay:", err.shortMessage || err.message || err);
    return null;
  }
}

function rolloverAlreadyDone(config, state, stored, target) {
  console.log(`[CHAIN] Rollover already done on-chain (stored day ${stored} >= ${target}). Nothing to send.`);
  state.rolloverTrack = newTrack();
  finishRollover(config, state);
}

// Retry outside the queue so a breach write behind it is never held up.
function scheduleRolloverRetry(config, state, chain, delayMs, why) {
  console.error(`[CHAIN] Rollover not finished: ${why}. Retry in ${Math.round(delayMs / 1000)}s.`);
  setTimeout(() => enqueue(chain, () => runRollover(config, state, chain)), delayMs);
}

function finishRollover(config, state) {
  state.rolloverQueued = false;
  console.log("[CHAIN] Rollover confirmed.");
  // Only a quota closure reopens. A leak closure stays until the owner resets it.
  if (state.locked && state.closeCause === CAUSE_QUOTA) {
    publish(state.client, "OPEN_VALVE", "DAILY_ROLLOVER");
    clearLock(state);
  }
  saveState(config, state);
}

// ---------------------------------------------------------------------------
// Chain: one provider, one wallet, one serial queue
// ---------------------------------------------------------------------------
async function initChain(config, chain) {
  const request = new ethers.FetchRequest(config.rpcUrl);
  request.timeout = RPC_TIMEOUT_MS;
  chain.provider = new ethers.JsonRpcProvider(request, CHAIN_ID, { staticNetwork: true });

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

/** Serial queue: one chain write at a time, in order. Jobs wait for the wallet to exist. */
function enqueue(chain, job) {
  const run = chain.queue.then(() => chain.ready).then(job);
  chain.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function logPollError(err) {
  console.error("[CHAIN] Poll failed:", err.shortMessage || err.message || err);
}

async function pollChain(config, state, chain) {
  if (config.dryRun || !chain.registry) return;

  let sector;
  let leakRaw;
  let offsetRaw;
  let lengthRaw;
  let shiftRaw;
  try {
    [sector, leakRaw, offsetRaw, lengthRaw, shiftRaw] = await Promise.all([
      chain.registry.sectorRegistry(config.sectorIdBytes),
      chain.registry.leakThreshold(),
      chain.registry.dayOffsetSeconds(),
      chain.registry.dayLengthSeconds(),
      chain.registry.manualDayShift(),
    ]);
  } catch (err) {
    if (!state.fallbackLogged) {
      console.error("[CHAIN] RPC unreachable or read failed. Using .env fallback.", err.shortMessage || err.message);
      state.fallbackLogged = true;
    }
    return;
  }

  if (sector.dailyQuotaLimit === 0n) {
    if (!state.fallbackLogged) {
      console.error(`[CHAIN] ${config.sectorId} is missing on-chain. Using .env fallback.`);
      state.fallbackLogged = true;
    }
    return;
  }
  state.fallbackLogged = false;

  const quota = fromChain(sector.dailyQuotaLimit);
  const leak = fromChain(leakRaw);
  const offset = Number(offsetRaw);
  const dayLength = Number(lengthRaw);
  const shift = Number(shiftRaw);

  if (quota !== state.quota) {
    console.log(`[CHAIN] dailyQuotaLimit ${state.quota} -> ${quota}`);
    state.quota = quota;
  }
  if (leak !== state.leakThreshold) {
    console.log(`[CHAIN] leakThreshold ${state.leakThreshold} -> ${leak}`);
    state.leakThreshold = leak;
  }
  if (offset !== state.dayOffsetSeconds || dayLength !== state.dayLengthSeconds || shift !== state.dayShift) {
    console.log(
      `[CHAIN] day clock: length ${state.dayLengthSeconds}s -> ${dayLength}s, offset ${state.dayOffsetSeconds}s -> ${offset}s, manual shift ${state.dayShift} -> ${shift}`
    );
    const now = Date.now();
    const wasToday = state.dayIndex === todayIndex(state, now);
    state.dayLengthSeconds = dayLength;
    state.dayOffsetSeconds = offset;
    state.dayShift = shift;
    // First sync only: a .env fallback that was ahead of the chain must not look like a day change.
    // A later increase (the owner advanced the day) is a real new day: evaluate() rolls it over.
    if (!state.offsetSynced && wasToday) {
      const t = todayIndex(state, now);
      if (t < state.dayIndex) state.dayIndex = t;
    }
    saveState(config, state);
  }
  state.offsetSynced = true;

  state.chainValveClosed = Boolean(sector.isValveClosed);

  // Locked, breach confirmed on-chain, and the chain shows closed: remember that we saw it.
  if (state.locked && state.chainLogged && state.chainValveClosed) {
    if (!state.chainClosedSeen) {
      state.chainClosedSeen = true;
      saveState(config, state);
    }
  }

  // Owner reset sync. Never while the breach write is still pending (chainLogged false).
  // chainClosedSeen guards against reopening when the chain never closed for this breach
  // (ΔQ or volume within rounding of the threshold, so the on-chain re-check disagreed).
  if (state.locked && state.chainLogged && state.chainClosedSeen && !state.chainValveClosed) {
    console.log("[CHAIN] Owner reset observed.");
    publish(state.client, "OPEN_VALVE", "OWNER_RESET");
    clearLock(state);
    state.dailyVolumeUsed = 0;
    saveState(config, state);
  } else if (state.locked && state.chainLogged && !state.chainClosedSeen && !state.chainValveClosed) {
    if (!state.mismatchLogged) {
      state.mismatchLogged = true;
      console.warn(
        "[CHAIN] Breach is logged but the chain does not show a closed valve (value within rounding of the threshold?). " +
          "Valve stays closed locally. Reopen with OPEN_VALVE."
      );
    }
  } else {
    state.mismatchLogged = false;
  }
}

/**
 * One attempt to get a transaction confirmed. Safe to call again with the same `track`:
 * a transaction that is still in the pool is waited for, never sent twice.
 * Returns { status: "confirmed" | "reverted" | "pending" | "error", message?, err? }.
 */
async function submitOnce(chain, label, track, send) {
  try {
    if (track.hash) {
      const receipt = await chain.provider.getTransactionReceipt(track.hash);
      if (receipt) return { status: receipt.status === 1 ? "confirmed" : "reverted", message: track.hash };
      const found = await chain.provider.getTransaction(track.hash);
      if (found) {
        const late = await waitReceipt(chain, track.hash, CONFIRM_TIMEOUT_MS);
        if (late) return { status: late.status === 1 ? "confirmed" : "reverted", message: track.hash };
        return { status: "pending", message: "still in the pool, chain not confirming" };
      }
      // Dropped from the pool: send again with the same nonce.
      track.resendNonce = track.nonce;
      track.hash = null;
    }

    const overrides = track.resendNonce == null ? { ...LEGACY } : { ...LEGACY, nonce: track.resendNonce };
    const tx = await send(overrides);
    track.resendNonce = null;
    track.hash = tx.hash;
    track.nonce = tx.nonce;
    console.log(`[CHAIN] ${label} submitted ${tx.hash}`);

    const receipt = await waitReceipt(chain, tx.hash, CONFIRM_TIMEOUT_MS);
    if (!receipt) {
      console.error(`[CHAIN] ${label} confirmation timeout ${tx.hash}`);
      return { status: "pending", message: "confirmation timeout" };
    }
    return { status: receipt.status === 1 ? "confirmed" : "reverted", message: tx.hash };
  } catch (err) {
    const message = err.shortMessage || err.message || String(err);
    if (err.code === "NONCE_EXPIRED" || /nonce/i.test(message)) track.resendNonce = null;
    if (err.code === "CALL_EXCEPTION") return { status: "reverted", message, err };
    return { status: "error", message, err };
  }
}

async function waitReceipt(chain, hash, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await chain.provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    if (Date.now() >= deadline) return null;
    await sleep(2000);
  }
}

/** Breach write: retried until confirmed (backoff 5 s up to 60 s). Never touches the lock on failure. */
async function sendBreach(config, state, chain, payload, seq) {
  const track = newTrack();
  let delay = RETRY_MIN_MS;
  for (;;) {
    const result = await submitOnce(chain, "Breach", track, (o) =>
      chain.registry.updateSectorState(
        config.sectorIdBytes,
        payload.upstream,
        payload.downstream,
        payload.deltaQ,
        payload.volume,
        payload.quota,
        o
      )
    );

    if (result.status === "confirmed") {
      console.log(`[CHAIN] Breach confirmed ${result.message}`);
      markBreachLogged(config, state, chain, seq);
      return;
    }

    if (result.status === "reverted") {
      // E.g. the reporter was removed or the sector is missing. Keep trying: the owner can fix it.
      track.hash = null;
      track.resendNonce = null;
    }
    console.error(`[CHAIN] Breach ${result.status}: ${result.message || ""}. Retry in ${Math.round(delay / 1000)}s. Valve stays closed.`);
    await sleep(delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  }
}

function markBreachLogged(config, state, chain, seq) {
  if (state.breachSeq !== seq) return; // a newer breach owns the state now
  state.pendingBreach = null;
  if (state.locked) {
    state.chainLogged = true;
    // Read the chain right away so the owner-reset sync knows the chain was closed.
    pollChain(config, state, chain).catch(logPollError);
  }
  saveState(config, state);
}

/** Snapshot: no retry. Skip and try again at the next interval. */
async function sendSnapshot(config, state, chain, payload) {
  const result = await submitOnce(chain, "Snapshot", newTrack(), (o) =>
    chain.telemetry.recordSnapshot(config.sectorIdBytes, payload.upstream, payload.downstream, payload.deltaQ, payload.volume, { ...o, gasLimit: SNAPSHOT_GAS_LIMIT })
  );
  if (result.status === "confirmed") {
    console.log(`[CHAIN] Snapshot confirmed ${result.message}`);
    return;
  }
  const text = `${result.message || ""} ${result.err && result.err.revert ? result.err.revert.name : ""}`;
  if (/TooSoon/i.test(text)) {
    console.log("[CHAIN] Snapshot rejected: TooSoon");
    return;
  }
  console.error(`[CHAIN] Snapshot ${result.status}: ${result.message || ""}. Next try at the next interval.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function newTrack() {
  return { hash: null, nonce: null, resendNonce: null };
}

function clearLock(state) {
  state.locked = false;
  state.closeCause = CAUSE_NONE;
  state.chainLogged = false;
  state.chainClosedSeen = false;
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

/** Force in-memory sensor/EMA readings to 0 after a confirmed shut. */
function zeroFlowSensors(config, state) {
  const now = Date.now();
  for (const id of [config.upstreamNodeId, ...config.downstream]) {
    state.ema[id] = 0;
    state.sensors[id] = { value: 0, timestamp: now };
  }
}

/**
 * Publish 0 L/min for upstream + expected downstream so the dashboard / Node-RED
 * consumers stop showing a live waterfall after CLOSE_VALVE.
 */
function publishFlowZeros(config, state) {
  const client = state.client;
  if (!client) return;
  const nodes = [config.upstreamNodeId, ...config.downstream];
  for (const nodeId of nodes) {
    const message = JSON.stringify({ node_id: nodeId, flow_rate: 0 });
    client.publish("sensor/flow", message, (err) => {
      if (err) console.error(`[ACTUATION] Failed to publish zero flow for ${nodeId}:`, err.message);
    });
  }
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
  for (const id of [config.upstreamNodeId, ...config.downstream]) {
    const sensor = state.sensors[id];
    if (!sensor || now - sensor.timestamp > limit) stale.push(id);
  }
  return stale;
}

function downstreamSum(config, state) {
  let sum = 0;
  for (const id of config.downstream) sum += state.sensors[id].value;
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
      dayLengthSeconds: state.dayLengthSeconds,
      dayOffsetSeconds: state.dayOffsetSeconds,
      dayShift: state.dayShift,
      dailyVolumeUsed: state.dailyVolumeUsed,
      locked: state.locked,
      closeCause: state.closeCause,
      chainLogged: state.chainLogged,
      chainClosedSeen: state.chainClosedSeen,
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

/** Write to a temp file, then rename over the target, so a crash never leaves half a file. */
function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function emptyWindow() {
  return { n: 0, up: 0, down: 0, dq: 0 };
}

/** Same formula as the contract: (timestamp + offset) / dayLength + manual shift. */
function dayIndexAt(nowMs, offsetSeconds, dayLengthSeconds, dayShift) {
  return Math.floor((Math.floor(nowMs / 1000) + offsetSeconds) / dayLengthSeconds) + dayShift;
}

function todayIndex(state, nowMs) {
  return dayIndexAt(nowMs, state.dayOffsetSeconds, state.dayLengthSeconds, state.dayShift);
}

function reasonFromCause(cause) {
  return cause === CAUSE_QUOTA ? "QUOTA_EXCEEDED" : "ANOMALY_DETECTED";
}

// Scaling lives here and nowhere else: x100 going to the chain, /100 coming back.
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
