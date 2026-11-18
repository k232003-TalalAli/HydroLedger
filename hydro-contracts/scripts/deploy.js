/**
 * Deploy WaterQuotaRegistry and WaterTelemetryLog to Besu (chain ID 1338).
 * Usage (from hydro-contracts, laptop A):
 *   npx hardhat run scripts/deploy.js --network besu
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const LEGACY = { type: 0, gasPrice: 0 };

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("OWNER_PRIVATE_KEY is missing. Put the owner wallet in hydro-contracts/.env.");
  }

  const reporters = {
    Sector_A: requiredAddress("REPORTER_ADDRESS_A"),
    Sector_B: requiredAddress("REPORTER_ADDRESS_B"),
    Sector_C: requiredAddress("REPORTER_ADDRESS_C"),
  };
  const quotas = {
    Sector_A: litersToScaled("INITIAL_QUOTA_LITERS_A"),
    Sector_B: litersToScaled("INITIAL_QUOTA_LITERS_B"),
    Sector_C: litersToScaled("INITIAL_QUOTA_LITERS_C"),
  };
  const minInterval = BigInt(process.env.MIN_SNAPSHOT_INTERVAL_SECONDS || "540");

  const Registry = await ethers.getContractFactory("WaterQuotaRegistry");
  const registry = await Registry.deploy(LEGACY);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`WaterQuotaRegistry ${registryAddress}`);

  const sectorIds = {};
  for (const name of ["Sector_A", "Sector_B", "Sector_C"]) {
    const id = ethers.encodeBytes32String(name);
    sectorIds[name] = id;
    const addTx = await registry.addSector(id, quotas[name], LEGACY);
    await addTx.wait();
    const repTx = await registry.addReporter(reporters[name], id, LEGACY);
    await repTx.wait();
    console.log(`added ${name} quota=${quotas[name].toString()} reporter=${reporters[name]}`);
  }

  const Log = await ethers.getContractFactory("WaterTelemetryLog");
  const telemetry = await Log.deploy(registryAddress, minInterval, LEGACY);
  await telemetry.waitForDeployment();
  const telemetryAddress = await telemetry.getAddress();
  console.log(`WaterTelemetryLog ${telemetryAddress}`);

  const blockNumber = await ethers.provider.getBlockNumber();
  const out = {
    chainId: 1338,
    registry: registryAddress,
    telemetry: telemetryAddress,
    deployer: deployer.address,
    blockNumber,
    sectorIds,
    minSnapshotIntervalSeconds: minInterval.toString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "besu.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Wrote ${file}`);

  console.log("");
  console.log("Paste these into each laptop's middleware/.env:");
  console.log("");
  console.log("# Laptop A — Sector_A — aggregator RPC is hydro-node2, not node1");
  console.log("RPC_URL=http://127.0.0.1:8546");
  console.log(`CONTRACT_ADDRESS=${registryAddress}`);
  console.log(`TELEMETRY_CONTRACT_ADDRESS=${telemetryAddress}`);
  console.log("SECTOR_ID=Sector_A");
  console.log("PRIVATE_KEY=<reporterA private key>");
  console.log("");
  console.log("# Laptop B — Sector_B — hydro-node3");
  console.log("RPC_URL=http://127.0.0.1:8545");
  console.log(`CONTRACT_ADDRESS=${registryAddress}`);
  console.log(`TELEMETRY_CONTRACT_ADDRESS=${telemetryAddress}`);
  console.log("SECTOR_ID=Sector_B");
  console.log("PRIVATE_KEY=<reporterB private key>");
  console.log("");
  console.log("# Laptop C — Sector_C — hydro-node4");
  console.log("RPC_URL=http://127.0.0.1:8545");
  console.log(`CONTRACT_ADDRESS=${registryAddress}`);
  console.log(`TELEMETRY_CONTRACT_ADDRESS=${telemetryAddress}`);
  console.log("SECTOR_ID=Sector_C");
  console.log("PRIVATE_KEY=<reporterC private key>");
}

function requiredAddress(name) {
  const value = (process.env[name] || "").trim();
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${name} must be a checksummed or hex Ethereum address.`);
  }
  return value;
}

function litersToScaled(name) {
  const raw = process.env[name] || "5000";
  const liters = Number(raw);
  if (!Number.isFinite(liters) || liters <= 0) {
    throw new Error(`${name} must be a positive number of litres.`);
  }
  return BigInt(Math.round(liters * 100));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
