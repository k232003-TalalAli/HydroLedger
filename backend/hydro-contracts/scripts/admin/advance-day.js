/**
 * Start a new quota day right now (owner only), instead of waiting for the next day boundary.
 *
 * 1. advanceDay() moves the chain's currentDay() forward by one.
 * 2. rolloverQuotaDay() is then called for each sector, so volume resets and a quota closure
 *    reopens straight away. A leak closure stays closed (use reset-sector.js for that).
 *
 * The aggregators notice the new day on their next chain poll, see that the sector's stored day
 * is already current, and do not send a second rollover.
 *
 * Usage (from hydro-contracts):
 *   npm run advance-day                       all sectors in deployments/besu.json
 *   npm run advance-day -- Sector_B           only the named sectors
 *   npm run advance-day -- --day-only         advance the day, leave sectors to the aggregators
 */
const { connect, sectorIdFromName, LEGACY } = require("./common");

const DEFAULT_SECTORS = ["Sector_A", "Sector_B", "Sector_C"];

async function main() {
  const args = process.argv.slice(2);
  const dayOnly = args.includes("--day-only");
  const named = args.filter((a) => !a.startsWith("--"));

  const { registry, deployment } = connect();
  const sectors = named.length ? named : Object.keys(deployment.sectorIds || {}).length ? Object.keys(deployment.sectorIds) : DEFAULT_SECTORS;

  const before = await registry.currentDay();
  const tx = await registry.advanceDay(LEGACY);
  console.log(`advanceDay submitted ${tx.hash}`);
  const receipt = await tx.wait();
  const after = await registry.currentDay();
  console.log(`confirmed block ${receipt.blockNumber}: chain day ${before} -> ${after}`);

  if (dayOnly) {
    console.log("Sectors not rolled over (--day-only). Each aggregator will do it on its next chain poll.");
    return;
  }

  let failed = 0;
  for (const name of sectors) {
    try {
      const rtx = await registry.rolloverQuotaDay(sectorIdFromName(name), LEGACY);
      const rr = await rtx.wait();
      const ev = rr.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "DailyRollover");
      const reopened = ev ? ev.args.valveReopened : false;
      console.log(`${name}: rolled over to day ${ev ? ev.args.dayIndex : after}${reopened ? ", valve reopened (quota closure)" : ""} (block ${rr.blockNumber})`);
    } catch (err) {
      failed += 1;
      console.error(`${name}: rollover failed: ${err.shortMessage || err.message || err}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
