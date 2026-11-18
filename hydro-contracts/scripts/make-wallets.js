/**
 * Create the owner wallet and one reporter wallet per sector.
 * Writes wallets.local.json (gitignored). Does not fund anything: gas is free.
 *
 * Never reuse besu-net/nodeN/key. Those keys are validator identities.
 *
 * Usage (from hydro-contracts): node scripts/make-wallets.js
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const PLAN = [
  {
    name: "owner",
    envFile: "hydro-contracts/.env on laptop A",
    envVar: "OWNER_PRIVATE_KEY",
  },
  {
    name: "reporterA",
    envFile: "middleware/.env on laptop A (Sector_A aggregator)",
    envVar: "PRIVATE_KEY",
  },
  {
    name: "reporterB",
    envFile: "middleware/.env on laptop B (Sector_B aggregator)",
    envVar: "PRIVATE_KEY",
  },
  {
    name: "reporterC",
    envFile: "middleware/.env on laptop C (Sector_C aggregator)",
    envVar: "PRIVATE_KEY",
  },
];

function main() {
  const wallets = {};
  console.log("Created 4 application wallets. Gas is free; do not fund them.");
  console.log("Back up the owner key. Losing it means losing admin rights.");
  console.log("");

  for (const item of PLAN) {
    const wallet = ethers.Wallet.createRandom();
    wallets[item.name] = {
      address: wallet.address,
      privateKey: wallet.privateKey,
      envFile: item.envFile,
      envVar: item.envVar,
    };
    console.log(item.name);
    console.log(`  address:    ${wallet.address}`);
    console.log(`  privateKey: ${wallet.privateKey}`);
    console.log(`  put ${item.envVar} in ${item.envFile}`);
    console.log("");
  }

  const dest = path.join(__dirname, "..", "wallets.local.json");
  fs.writeFileSync(dest, JSON.stringify(wallets, null, 2));
  console.log(`Wrote ${dest}`);
  console.log("This file is gitignored. Do not commit it.");
  console.log("Copy REPORTER_ADDRESS_A/B/C (the addresses, not the keys) into hydro-contracts/.env before deploy.");
}

main();
