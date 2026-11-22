/**
 * Change the minimum time between two telemetry snapshots of one sector (owner only).
 * The aggregator's SNAPSHOT_INTERVAL_MIN must be at least this long, or snapshots are rejected (TooSoon).
 * Usage (from hydro-contracts): node scripts/admin/set-min-interval.js 100
 */
const { connect, LEGACY } = require("./common");

async function main() {
  const seconds = Number(process.argv[2]);
  if (!Number.isInteger(seconds) || seconds < 0) {
    console.error("Usage: node scripts/admin/set-min-interval.js <seconds>");
    process.exit(1);
  }

  const { telemetry } = connect();
  const before = await telemetry.minIntervalSeconds();
  const tx = await telemetry.setMinInterval(seconds, LEGACY);
  console.log(`submitted ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed block ${receipt.blockNumber}: min snapshot interval ${before} s -> ${seconds} s`);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
