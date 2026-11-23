/**
 * Explains why recordSnapshot reverts for THIS laptop's aggregator.
 * Read only: sends no transaction, and never prints the private key.
 *
 * Usage (from middleware, same folder and .env as aggregator.js):
 *   node diagnose-snapshot.js
 */
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ quiet: true });

const rpc = process.env.RPC_URL;
const key = (process.env.PRIVATE_KEY || "").trim();
const registryAddr = process.env.CONTRACT_ADDRESS;
const telemetryAddr = process.env.TELEMETRY_CONTRACT_ADDRESS;
const sector = process.env.SECTOR_ID;

for (const [name, v] of Object.entries({ RPC_URL: rpc, PRIVATE_KEY: key, CONTRACT_ADDRESS: registryAddr, TELEMETRY_CONTRACT_ADDRESS: telemetryAddr, SECTOR_ID: sector })) {
  if (!v) {
    console.error(`${name} is missing from middleware/.env`);
    process.exit(1);
  }
}

const provider = new ethers.JsonRpcProvider(rpc, 1338, { staticNetwork: true });
const reporter = new ethers.Wallet(key).address; // the address only, computed locally
const sectorId = ethers.encodeBytes32String(sector);

const telemetry = new ethers.Contract(
  telemetryAddr,
  [
    "function registry() view returns (address)",
    "function minIntervalSeconds() view returns (uint256)",
    "function latestSnapshot(bytes32) view returns (uint256 up, uint256 down, uint256 dq, uint256 volume, uint256 timestamp)",
    "function snapshotCount(bytes32) view returns (uint256)",
    "function recordSnapshot(bytes32 sectorId, uint256 up, uint256 down, uint256 dq, uint256 volume)",
    "error ZeroRegistry()",
    "error NotSectorReporter()",
    "error TooSoon()",
    "error FlowOutOfRange()",
    "error NotRegistryOwner()",
  ],
  provider
);

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);
const fmt = (ts) => new Date(Number(ts) * 1000).toLocaleString("en-GB", { hour12: false });

async function main() {
  console.log(`Node:      ${rpc}`);
  console.log(`Sector:    ${sector}`);
  console.log(`Reporter:  ${reporter}`);
  console.log(`Registry:  ${registryAddr}`);
  console.log(`Telemetry: ${telemetryAddr}\n`);

  const latest = await provider.getBlock("latest");
  console.log(`Chain head: block ${latest.number}, time ${fmt(latest.timestamp)} (this laptop's clock: ${fmt(Date.now() / 1000)})\n`);

  // 1. Is the telemetry contract the one that belongs to this registry?
  console.log("1. Telemetry contract and registry");
  const code = await provider.getCode(telemetryAddr);
  if (code === "0x") {
    bad("There is no contract at TELEMETRY_CONTRACT_ADDRESS. The address is wrong, or this node is not synced yet.");
    return;
  }
  const usedRegistry = await telemetry.registry();
  if (usedRegistry.toLowerCase() === registryAddr.toLowerCase()) {
    ok("The telemetry contract uses the same registry as CONTRACT_ADDRESS.");
  } else {
    bad(`The telemetry contract reads reporters from ${usedRegistry}, but CONTRACT_ADDRESS is ${registryAddr}.`);
    console.log("        -> TELEMETRY_CONTRACT_ADDRESS is from a different deployment. Copy both addresses from deployments/besu.json.");
  }

  // 2. Is this reporter bound to this sector?
  console.log("\n2. Reporter binding");
  const registry = new ethers.Contract(usedRegistry, ["function reporterSector(address) view returns (bytes32)"], provider);
  const bound = await registry.reporterSector(reporter);
  if (bound === ethers.ZeroHash) {
    bad("This reporter address is not bound to any sector.");
    console.log("        -> The owner (laptop A) must run: node scripts/admin/add-reporter.js " + sector + " " + reporter);
  } else {
    const name = ethers.decodeBytes32String(bound);
    if (bound.toLowerCase() === sectorId.toLowerCase()) ok(`Bound to ${name}.`);
    else {
      bad(`Bound to ${name}, but SECTOR_ID is ${sector}.`);
      console.log("        -> Fix SECTOR_ID and EXPECTED_DOWNSTREAM in .env, or use the key that belongs to this sector.");
    }
  }

  // 3. Is the minimum interval the problem?
  console.log("\n3. Snapshot timing");
  const [snap, count, minInterval] = await Promise.all([telemetry.latestSnapshot(sectorId), telemetry.snapshotCount(sectorId), telemetry.minIntervalSeconds()]);
  console.log(`  Snapshots on chain for ${sector}: ${count}`);
  if (Number(snap.timestamp) === 0) {
    ok("No snapshot yet, so the interval cannot be the problem.");
  } else {
    const nowTs = Math.floor(Date.now() / 1000);
    const since = nowTs - Number(snap.timestamp);
    console.log(`  Last snapshot: ${fmt(snap.timestamp)} (${since} s ago). Minimum gap on chain: ${minInterval} s.`);
    if (since < Number(minInterval)) {
      bad("A snapshot was recorded less than the minimum gap ago, so a new one reverts with TooSoon.");
      console.log("        -> Usually two aggregators are writing for this sector, or it was restarted quickly. Check: Get-Process node");
    } else {
      ok("Enough time has passed since the last snapshot.");
    }
  }

  // 4. Ask the chain directly.
  console.log("\n4. Dry run of recordSnapshot from this reporter (no transaction is sent)");
  try {
    await provider.call({ from: reporter, to: telemetryAddr, data: telemetry.interface.encodeFunctionData("recordSnapshot", [sectorId, 2000, 2000, 0, 0]) });
    ok("The call would succeed.");
  } catch (err) {
    let reason = "unknown error";
    try {
      reason = telemetry.interface.parseError(err.data).name;
    } catch {
      reason = err.shortMessage || err.message;
    }
    bad(`The call reverts with: ${reason}`);
    if (reason === "TooSoon") console.log("        (The dry run uses the chain's last block time, so this can be stricter than a real send.)");
  }
}

main().catch((err) => {
  console.error("Could not complete the check:", err.shortMessage || err.message || err);
  process.exit(1);
});
