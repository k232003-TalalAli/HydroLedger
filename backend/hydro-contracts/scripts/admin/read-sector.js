/**
 * Print sector state and recent audit events.
 * Usage (from hydro-contracts): node scripts/admin/read-sector.js Sector_B
 * Read only: needs no owner key. Point RPC_URL at this laptop's local Besu RPC
 * (laptop A: node1 8545 or node2 8546, B and C: 8545).
 */
const { connect, sectorIdFromName } = require("./common");

async function main() {
  const sectorName = process.argv[2];
  if (!sectorName) {
    console.error("Usage: node scripts/admin/read-sector.js <sectorName>");
    process.exit(1);
  }

  const { registry, telemetry, deployment, url } = connect({ readOnly: true });
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
  const n = (v) => (Number(v) / 100).toFixed(2);
  const when = (ts) =>
    Number(ts) === 0
      ? "never"
      : new Date(Number(ts) * 1000).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        });
  const [chainDay, dayLength, dayShift] = await Promise.all([
    registry.currentDay(),
    registry.dayLengthSeconds(),
    registry.manualDayShift(),
  ]);

  console.log("");
  console.log(`Valve:        ${sector.isValveClosed ? `CLOSED (cause: ${causeName})` : "OPEN"}`);
  console.log(`Daily quota:  ${n(sector.dailyQuotaLimit)} L`);
  console.log(`Quota day:    #${day} (chain is on day #${chainDay}, a day lasts ${dayLength} s, manual shift ${dayShift})`);
  console.log("");
  console.log("Last report stored in the registry");
  console.log("  (only written when the aggregator reports a leak/quota breach: NOT a live reading,");
  console.log("   and not an average. It is the single reading the breach was decided on.)");
  console.log(`  Reported at:          ${when(sector.lastUpdated)}`);
  console.log(`  Upstream flow:        ${n(sector.upstreamFlowRate)} L/min`);
  console.log(`  Downstream flow:      ${n(sector.downstreamFlowRate)} L/min`);
  console.log(`  Difference (up-down): ${n(sector.deltaQ)} L/min`);
  console.log(`  Water used that day:  ${n(sector.dailyVolumeUsed)} L at that report (cleared to 0 by an owner reset or a new quota day, so 0 here does not mean no water was used)`);
  console.log("");
  if (Number(count) > 0) {
    console.log(`Latest snapshot (${count} in total; one is written every few minutes, each is an AVERAGE over its window)`);
    console.log(`  Taken at:             ${when(snap.timestamp)}`);
    console.log(`  Avg upstream flow:    ${n(snap.upstreamFlowRate)} L/min`);
    console.log(`  Avg downstream flow:  ${n(snap.downstreamFlowRate)} L/min`);
    console.log(`  Avg difference:       ${n(snap.deltaQ)} L/min`);
    console.log(`  Water used that day:  ${n(snap.dailyVolumeUsed)} L (running total at snapshot time)`);
  } else {
    console.log("Latest snapshot: none yet");
  }

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
