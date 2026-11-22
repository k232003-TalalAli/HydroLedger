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
  "function currentDay() view returns (uint256)",
  "function dayLengthSeconds() view returns (uint256)",
  "function manualDayShift() view returns (uint256)",
  "function advanceDay()",
  "function rolloverQuotaDay(bytes32 id)",
  "event DayAdvanced(uint256 newDayIndex, uint256 manualDayShift, address indexed by)",
  "function setSectorQuota(bytes32 id, uint256 newQuota)",
  "function resetSector(bytes32 id)",
  "event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp)",
  "event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp)",
  "event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp)",
];

const TELEMETRY_ABI = [
  "function latestSnapshot(bytes32) view returns (uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)",
  "function snapshotCount(bytes32) view returns (uint256)",
  "function minIntervalSeconds() view returns (uint256)",
  "function setMinInterval(uint256 v)",
  "event SnapshotRecorded(bytes32 indexed sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)",
];

/**
 * Contract addresses come from deployments/besu.json (written by deploy.js). On a laptop that
 * only reads, copy that file (it holds no secrets) or set CONTRACT_ADDRESS and
 * TELEMETRY_CONTRACT_ADDRESS in .env, the same names the aggregator uses.
 */
function loadDeployment() {
  const file = path.join(ROOT, "deployments", "besu.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));

  const registry = (process.env.CONTRACT_ADDRESS || "").trim();
  const telemetry = (process.env.TELEMETRY_CONTRACT_ADDRESS || "").trim();
  if (ethers.isAddress(registry) && ethers.isAddress(telemetry)) return { registry, telemetry };
  throw new Error(
    `Missing ${file}. Copy it from laptop A, or set CONTRACT_ADDRESS and TELEMETRY_CONTRACT_ADDRESS in .env.`
  );
}

/**
 * @param {{ readOnly?: boolean }} opts readOnly scripts need no owner key: they use the provider only.
 */
function connect(opts = {}) {
  const url = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(url, 1338, { staticNetwork: true });

  const key = (process.env.OWNER_PRIVATE_KEY || "").trim();
  if (!key && !opts.readOnly) {
    throw new Error("OWNER_PRIVATE_KEY is missing from hydro-contracts/.env.");
  }
  const wallet = key ? new ethers.Wallet(key, provider) : null;
  const runner = wallet || provider;

  const deployment = loadDeployment();
  const registry = new ethers.Contract(deployment.registry, REGISTRY_ABI, runner);
  const telemetry = new ethers.Contract(deployment.telemetry, TELEMETRY_ABI, runner);
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
