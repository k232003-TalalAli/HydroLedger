/**
 * Owner reset watcher (laptop A only).
 *
 * When someone sends OPEN_VALVE on this laptop's MQTT broker (the Node-RED reset button), and the
 * chain still shows the sector's valve closed, this calls resetSector() as the owner, so nobody
 * has to run scripts/admin/reset-sector.js by hand.
 *
 * It is a separate process on purpose: the aggregator keeps only the low-privilege reporter key.
 * The owner key stays in hydro-contracts/.env and is read only here.
 *
 * Usage (from middleware, in a second terminal next to the aggregator):
 *   node owner-reset.js
 *
 * Reads:
 *   middleware/.env                 MQTT_BROKER_URL, SECTOR_ID
 *   hydro-contracts/.env            OWNER_PRIVATE_KEY, RPC_URL (the owner's node, default :8545)
 *   hydro-contracts/deployments/besu.json   registry address
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

const sectorId = process.env.SECTOR_ID || "Sector_A";
const sectorIdBytes = ethers.encodeBytes32String(sectorId);
const mqttUrl = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
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

let busy = false;

async function handleReset() {
  if (busy) {
    console.log("[OWNER-RESET] A reset is already in progress, ignoring.");
    return;
  }
  busy = true;
  try {
    const sector = await registry.sectorRegistry(sectorIdBytes);
    if (!sector.isValveClosed) {
      console.log(`[OWNER-RESET] ${sectorId} is already open on-chain. Nothing to do.`);
      return;
    }
    const tx = await registry.resetSector(sectorIdBytes, LEGACY);
    console.log(`[OWNER-RESET] resetSector submitted ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt && receipt.status === 1) {
      console.log(`[OWNER-RESET] ${sectorId} reopened on-chain in block ${receipt.blockNumber}.`);
    } else {
      console.error("[OWNER-RESET] resetSector was mined but failed.");
    }
  } catch (err) {
    console.error("[OWNER-RESET] Failed:", err.shortMessage || err.message || err);
  } finally {
    busy = false;
  }
}

async function main() {
  const owner = await registry.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`The key in hydro-contracts/.env (${wallet.address}) is not the contract owner (${owner}).`);
    process.exit(1);
  }
  console.log(`[OWNER-RESET] Owner ${wallet.address}, watching ${sectorId} via ${rpcUrl}`);

  const client = mqtt.connect(mqttUrl);
  client.on("connect", () => {
    console.log(`[OWNER-RESET] Connected to ${mqttUrl}`);
    client.subscribe("actuation/valve");
  });
  client.on("error", (err) => console.error("[OWNER-RESET] MQTT error:", err.message));
  client.on("message", (_topic, payload) => {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!data || data.command !== "OPEN_VALVE" || SELF_REASONS.has(data.reason)) return;
    console.log("[OWNER-RESET] OPEN_VALVE received, checking the chain.");
    handleReset();
  });
}

main().catch((err) => {
  console.error("[OWNER-RESET]", err.shortMessage || err.message || err);
  process.exit(1);
});
