/**
 * Set a sector quota. Does not publish MQTT.
 * Usage (from hydro-contracts): node scripts/admin/set-quota.js Sector_B 50
 */
const { connect, sectorIdFromName, LEGACY } = require("./common");

async function main() {
  const sectorName = process.argv[2];
  const liters = Number(process.argv[3]);
  if (!sectorName || !Number.isFinite(liters) || liters <= 0) {
    console.error("Usage: node scripts/admin/set-quota.js <sectorName> <liters>");
    process.exit(1);
  }

  const { registry } = connect();
  const id = sectorIdFromName(sectorName);
  const scaled = BigInt(Math.round(liters * 100));
  const tx = await registry.setSectorQuota(id, scaled, LEGACY);
  console.log(`submitted ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed block ${receipt.blockNumber}: ${sectorName} quota ${liters} L (${scaled} scaled)`);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
