/**
 * Explain why a reporter's rolloverQuotaDay (or snapshot) is refused. Read only: no key needed.
 * Usage (from hydro-contracts):
 *   node scripts/admin/check-rollover.js Sector_A 0xReporterAddressFromTheAggregatorLog
 */
const { ethers } = require("ethers");
const { connect, sectorIdFromName } = require("./common");

const EXTRA_ABI = [
  "function reporterSector(address) view returns (bytes32)",
  "function sectorExists(bytes32) view returns (bool)",
  "function currentDay() view returns (uint256)",
  "function owner() view returns (address)",
  "function rolloverQuotaDay(bytes32 id)",
  "error NotOwner()",
  "error SectorUnknown()",
  "error ReporterSectorMismatch()",
  "error RolloverNotDue()",
];

async function main() {
  const [name, reporter] = process.argv.slice(2);
  if (!name || !ethers.isAddress(reporter || "")) {
    console.error("Usage: node scripts/admin/check-rollover.js <sectorName> <reporterAddress>");
    process.exit(1);
  }
  const { provider, registry, deployment, url } = connect({ readOnly: true });
  const reg = new ethers.Contract(deployment.registry, [...EXTRA_ABI], provider);
  const id = sectorIdFromName(name);

  const [exists, bound, stored, chainDay, owner, latest] = await Promise.all([
    reg.sectorExists(id),
    reg.reporterSector(reporter),
    registry.quotaDay(id),
    reg.currentDay(),
    reg.owner(),
    provider.getBlock("latest"),
  ]);
  const boundName = bound === ethers.ZeroHash ? "(none)" : ethers.decodeBytes32String(bound);

  console.log(`rpc ${url}`);
  console.log(`registry ${deployment.registry}`);
  console.log(`sector ${name} exists: ${exists}`);
  console.log(`reporter ${reporter} is bound to: ${boundName}  ${bound === id ? "OK" : "<-- NOT " + name}`);
  console.log(`owner ${owner}`);
  console.log(`stored quotaDay ${stored}, chain currentDay at latest block ${chainDay}`);
  console.log(`latest block time ${new Date(latest.timestamp * 1000).toISOString()} (now ${new Date().toISOString()})`);

  try {
    await reg.rolloverQuotaDay.staticCall(id, { from: reporter });
    console.log("rolloverQuotaDay simulation: would succeed");
  } catch (err) {
    const why = (err.revert && err.revert.name) || err.shortMessage || err.message;
    console.log(`rolloverQuotaDay simulation: refused with ${why}`);
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
