const { ethers } = require("ethers");
const { connect, sectorIdFromName, LEGACY } = require("./common");

async function main() {
  const [sector, reporter] = process.argv.slice(2);
  const { wallet, deployment } = connect();
  const reg = new ethers.Contract(
    deployment.registry,
    [
      "function addReporter(address r, bytes32 id)",
      "function removeReporter(address r)",
      "function reporterSector(address) view returns (bytes32)",
    ],
    wallet
  );
  const current = await reg.reporterSector(reporter);
  if (current !== ethers.ZeroHash) {
    console.log(`bound to ${ethers.decodeBytes32String(current)}, removing first`);
    await (await reg.removeReporter(reporter, LEGACY)).wait();
  }
  const tx = await reg.addReporter(reporter, sectorIdFromName(sector), LEGACY);
  await tx.wait();
  console.log(`${reporter} bound to ${sector}`);
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });