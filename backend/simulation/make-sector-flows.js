/**
 * Build Node-RED flows for Sector_A and Sector_C from flows.json.
 * flows.json stays the Sector_B simulation and is not modified.
 *
 * Usage (from simulation): node make-sector-flows.js
 */
const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "flows.json");
const raw = fs.readFileSync(source, "utf8");

for (const sector of ["Sector_A", "Sector_C"]) {
  const out = raw.replaceAll("Sector_B", sector);
  const file = path.join(__dirname, `flows.${sector.toLowerCase().replaceAll("_", "-")}.json`);
  fs.writeFileSync(file, out);
  console.log(`Wrote ${file}`);
}
