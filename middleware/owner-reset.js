/**
 * Owner reset watcher (laptop A only).
 *
 * When someone sends OPEN_VALVE (the Node-RED reset button) and the chain still shows that
 * sector's valve closed, this calls resetSector() as the owner, so nobody has to run
 * scripts/admin/reset-sector.js by hand.
 *
 * Modes:
 *   node owner-reset.js          every sector: A (this laptop's broker) plus B and C
 *                                (it listens to their brokers over Tailscale)
 *   node owner-reset.js secure   only Sector_A. B and C must be reset by hand with
 *                                node scripts/admin/reset-sector.js Sector_B   (or Sector_C)
 *
 * It is a separate process on purpose: the aggregator keeps only the low-privilege reporter key.
 * The owner key stays in hydro-contracts/.env and is read only here.
 *
 * Reads:
 *   middleware/.env                 MQTT_BROKER_URL, SECTOR_ID (this laptop's sector)
 *                                   optional: SECTOR_B_BROKER, SECTOR_C_BROKER
 *   hydro-contracts/.env            OWNER_PRIVATE_KEY, RPC_URL (the owner's node, default :8545)
 *   hydro-contracts/deployments/besu.json   registry address
 *
 * For B and C the broker on their laptop must accept connections from the Tailscale network
 * (see broker/mosquitto-tailnet.conf).
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mqtt = require("mqtt");
const { ethers } = require("ethers");

dotenv.config({ quiet: true }); // middleware/.env

const ownerEnvFile = path.join(__dirname, "..", "hydro-contracts", ".env");
const deploymentFile = path.join(__dirname, "..", "hydro-contracts", "deployments", "besu.json");
const ownerEnv = fs.existsSync(ownerEnvFile) ? dotenv.parse(fs.readFileSync(ownerEnvFile)) : {};

const LEGACY = { type: 0, gasPrice: 0 };
const CHAIN_ID = 1338;
// The aggregator's own OPEN_VALVE publishes carry these reasons: they are echoes, not a reset request.
const SELF_REASONS = new Set(["OWNER_RESET", "DAILY_ROLLOVER"]);

const args = process.argv.slice(2).map((a) => a.replace(/^-+/, "").toLowerCase());
const secure = args.includes("secure");

// Sector A runs on this laptop; B and C are reached over Tailscale.
const SECTORS = [
  { id: process.env.SECTOR_ID || "Sector_A", broker: process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883", remote: false },
  { id: "Sector_B", broker: process.env.SECTOR_B_BROKER || "mqtt://100.107.111.92:1883", remote: true },
  { id: "Sector_C", broker: process.env.SECTOR_C_BROKER || "mqtt://100.125.122.118:1883", remote: true },
].filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);

const watched = secure ? SECTORS.filter((s) => !s.remote) : SECTORS;
const manual = secure ? SECTORS.filter((s) => s.remote) : [];

const rpcUrl = ownerEnv.RPC_URL || "http://127.0.0.1:8545";
const ownerKey = (ownerEnv.OWNER_PRIVATE_KEY || "").trim();

if (!ownerKey) {
  console.error("OWNER_PRIVATE_KEY is missing from hydro-contracts/.env.");
  process.exit(1);
}
if (!fs.existsSync(deploymentFile)) {
  console.error(`Missing ${deploymentFile}. Run the deploy first.`);
  process.exit(1);
}
const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
const wallet = new ethers.Wallet(ownerKey, provider);
const registry = new ethers.Contract(
  deployment.registry,
  [
    "function owner() view returns (address)",
    "function sectorRegistry(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit, bool isValveClosed, uint256 lastUpdated)",
    "function resetSector(bytes32 id)",
  ],
  wallet
);

// All resets go through one queue: they share the owner wallet, so two at once would clash on the nonce.
let queue = Promise.resolve();
const enqueue = (fn) => {
  queue = queue.then(fn, fn);
  return queue;
};
const pending = new Set(); // sectors with a reset already waiting or running

async function handleReset(sector) {
  const tag = `[OWNER-RESET][${sector.id}]`;
  try {
    const idBytes = ethers.encodeBytes32String(sector.id);
    const state = await registry.sectorRegistry(idBytes);
    if (!state.isValveClosed) {
      console.log(
        `${tag} The chain already shows the valve open. Nothing to do. ` +
          'If a breach is still being written, press reset again after "Breach confirmed".'
      );
      return;
    }
    const tx = await registry.resetSector(idBytes, LEGACY);
    console.log(`${tag} resetSector submitted ${tx.hash}`);
    const receipt = await tx.wait(1, 60000);
    if (receipt && receipt.status === 1) {
      console.log(`${tag} Reopened on-chain in block ${receipt.blockNumber}.`);
    } else {
      console.error(`${tag} resetSector was mined but failed.`);
    }
  } catch (err) {
    console.error(`${tag} Failed:`, err.shortMessage || err.message || err);
  } finally {
    pending.delete(sector.id);
  }
}

function watch(sector) {
  const tag = `[OWNER-RESET][${sector.id}]`;
  const client = mqtt.connect(sector.broker, { reconnectPeriod: 5000, connectTimeout: 10000 });
  let lastError = "";

  client.on("connect", () => {
    lastError = "";
    console.log(`${tag} Connected to ${sector.broker}`);
    client.subscribe("actuation/valve");
  });
  client.on("error", (err) => {
    const msg = err.message || err.code || String(err);
    if (msg !== lastError) {
      lastError = msg;
      console.error(`${tag} Cannot reach ${sector.broker}: ${msg} (retrying every 5 s)`);
    }
  });
  client.on("message", (_topic, payload) => {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!data || data.command !== "OPEN_VALVE" || SELF_REASONS.has(data.reason)) return;
    if (pending.has(sector.id)) {
      console.log(`${tag} A reset is already in progress, ignoring.`);
      return;
    }
    pending.add(sector.id);
    console.log(`${tag} OPEN_VALVE received, checking the chain.`);
    enqueue(() => handleReset(sector));
  });
}

async function main() {
  const owner = await registry.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`The key in hydro-contracts/.env (${wallet.address}) is not the contract owner (${owner}).`);
    process.exit(1);
  }
  console.log(`[OWNER-RESET] Owner ${wallet.address}, chain ${rpcUrl}`);
  if (secure) {
    console.log(`[OWNER-RESET] SECURE mode: only ${watched.map((s) => s.id).join(", ")} is reset automatically.`);
    for (const s of manual) {
      console.log(`[OWNER-RESET]   ${s.id} is manual: node scripts/admin/reset-sector.js ${s.id}`);
    }
  } else {
    console.log(`[OWNER-RESET] Watching: ${watched.map((s) => s.id).join(", ")}`);
  }
  watched.forEach(watch);
}

main().catch((err) => {
  console.error("[OWNER-RESET]", err.shortMessage || err.message || err);
  process.exit(1);
});