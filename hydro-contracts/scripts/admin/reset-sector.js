/**
 * Owner reset of one sector. Does not publish MQTT.
 * The sector aggregator sees isValveClosed == false and opens the valve itself.
 * Usage (from hydro-contracts): node scripts/admin/reset-sector.js Sector_B
 */
const { connect, sectorIdFromName, LEGACY } = require("./common");

async function main() {
  const sectorName = process.argv[2];
  if (!sectorName) {
    console.error("Usage: node scripts/admin/reset-sector.js <sectorName>");
    process.exit(1);
  }

  const { registry } = connect();
  const tx = await registry.resetSector(sectorIdFromName(sectorName), LEGACY);
  console.log(`submitted ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed block ${receipt.blockNumber}: ${sectorName} reset. Aggregator opens the valve on its next chain poll.`);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
