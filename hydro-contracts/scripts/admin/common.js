/**
 * Shared loader for owner admin scripts.
 * Run from hydro-contracts so dotenv finds .env and deployments/besu.json.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const ROOT = path.join(__dirname, "..", "..");
const LEGACY = { type: 0, gasPrice: 0 };

const REGISTRY_ABI = [
  "function sectorRegistry(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit, bool isValveClosed, uint256 lastUpdated)",
  "function closeCause(bytes32) view returns (uint8)",
  "function quotaDay(bytes32) view returns (uint256)",
  "function leakThreshold() view returns (uint256)",
  "function setSectorQuota(bytes32 id, uint256 newQuota)",
  "function resetSector(bytes32 id)",
  "event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp)",
  "event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp)",
  "event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp)",
];

const TELEMETRY_ABI = [
  "function latestSnapshot(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)",
  "function snapshotCount(bytes32) view returns (uint256)",
  "event SnapshotRecorded(bytes32 indexed sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)",
];

function loadDeployment() {
  const file = path.join(ROOT, "deployments", "besu.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Deploy from laptop A first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function connect() {
  const key = (process.env.OWNER_PRIVATE_KEY || "").trim();
  if (!key) {
    throw new Error("OWNER_PRIVATE_KEY is missing from hydro-contracts/.env.");
  }
  const url = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(url, 1338, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const deployment = loadDeployment();
  const registry = new ethers.Contract(deployment.registry, REGISTRY_ABI, wallet);
  const telemetry = new ethers.Contract(deployment.telemetry, TELEMETRY_ABI, wallet);
  return { provider, wallet, registry, telemetry, deployment, url };
}

function sectorIdFromName(name) {
  if (!name) throw new Error("Sector name is required, for example Sector_B.");
  return ethers.encodeBytes32String(name);
}

module.exports = {
  LEGACY,
  connect,
  sectorIdFromName,
};
