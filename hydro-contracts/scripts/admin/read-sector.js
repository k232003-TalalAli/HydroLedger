/**
 * Print sector state and recent audit events.
 * Usage (from hydro-contracts): node scripts/admin/read-sector.js Sector_B
 * Point RPC_URL at this laptop's local Besu RPC.
 */
const { connect, sectorIdFromName } = require("./common");

async function main() {
  const sectorName = process.argv[2];
  if (!sectorName) {
    console.error("Usage: node scripts/admin/read-sector.js <sectorName>");
    process.exit(1);
  }

  const { registry, telemetry, deployment, url } = connect();
  const id = sectorIdFromName(sectorName);
  const fromBlock = 0;

  const [sector, cause, day, snap, count] = await Promise.all([
    registry.sectorRegistry(id),
    registry.closeCause(id),
    registry.quotaDay(id),
    telemetry.latestSnapshot(id),
    telemetry.snapshotCount(id),
  ]);

  const causeName = { 0: "none", 1: "leak", 2: "quota" }[Number(cause)] || String(cause);

  console.log(`rpc ${url}`);
  console.log(`registry ${deployment.registry}`);
  console.log(`telemetry ${deployment.telemetry}`);
  console.log(`sector ${sectorName} ${id}`);
  console.log("sectorRegistry:");
  console.log(`  upstreamFlowRate   ${sector.upstreamFlowRate} (${Number(sector.upstreamFlowRate) / 100} L/min)`);
  console.log(`  downstreamFlowRate ${sector.downstreamFlowRate} (${Number(sector.downstreamFlowRate) / 100} L/min)`);
  console.log(`  deltaQ             ${sector.deltaQ} (${Number(sector.deltaQ) / 100} L/min)`);
  console.log(`  dailyVolumeUsed    ${sector.dailyVolumeUsed} (${Number(sector.dailyVolumeUsed) / 100} L)`);
  console.log(`  dailyQuotaLimit    ${sector.dailyQuotaLimit} (${Number(sector.dailyQuotaLimit) / 100} L)`);
  console.log(`  isValveClosed      ${sector.isValveClosed}`);
  console.log(`  lastUpdated        ${sector.lastUpdated}`);
  console.log(`closeCause ${cause} (${causeName})`);
  console.log(`quotaDay ${day}`);
  console.log("latestSnapshot:");
  console.log(`  upstreamFlowRate   ${snap.upstreamFlowRate}`);
  console.log(`  downstreamFlowRate ${snap.downstreamFlowRate}`);
  console.log(`  deltaQ             ${snap.deltaQ}`);
  console.log(`  dailyVolumeUsed    ${snap.dailyVolumeUsed}`);
  console.log(`  timestamp          ${snap.timestamp}`);
  console.log(`snapshotCount ${count}`);

  const [alerts, resets, rollovers, snapshots] = await Promise.all([
    registry.queryFilter(registry.filters.SectorAlert(id), fromBlock),
    registry.queryFilter(registry.filters.SectorReset(id), fromBlock),
    registry.queryFilter(registry.filters.DailyRollover(id), fromBlock),
    telemetry.queryFilter(telemetry.filters.SnapshotRecorded(id), fromBlock),
  ]);

  printEvents("SectorAlert", alerts, (e) => `reason=${e.args.reason} timestamp=${e.args.timestamp}`);
  printEvents("SectorReset", resets, (e) => `by=${e.args.by} timestamp=${e.args.timestamp}`);
  printEvents(
    "DailyRollover",
    rollovers,
    (e) => `dayIndex=${e.args.dayIndex} valveReopened=${e.args.valveReopened} timestamp=${e.args.timestamp}`
  );
  printEvents(
    "SnapshotRecorded",
    snapshots,
    (e) =>
      `up=${e.args.upstreamFlowRate} down=${e.args.downstreamFlowRate} dQ=${e.args.deltaQ} volume=${e.args.dailyVolumeUsed} timestamp=${e.args.timestamp}`
  );
}

function printEvents(label, events, format) {
  console.log(`${label} (${events.length})`);
  for (const event of events) {
    console.log(`  block ${event.blockNumber} ${format(event)}`);
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
