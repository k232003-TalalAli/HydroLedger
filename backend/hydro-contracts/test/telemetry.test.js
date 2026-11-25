const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

async function deployFixture() {
  const [owner, reporterA, reporterB, stranger] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("WaterQuotaRegistry");
  const registry = await Registry.deploy(600n);
  await registry.waitForDeployment();

  const idA = ethers.encodeBytes32String("Sector_A");
  const idB = ethers.encodeBytes32String("Sector_B");
  await registry.addSector(idA, 5000n * 100n);
  await registry.addSector(idB, 5000n * 100n);
  await registry.addReporter(reporterA.address, idA);
  await registry.addReporter(reporterB.address, idB);

  const Log = await ethers.getContractFactory("WaterTelemetryLog");
  const log = await Log.deploy(await registry.getAddress(), 210n);
  await log.waitForDeployment();

  return { registry, log, owner, reporterA, reporterB, stranger, idA, idB };
}

describe("WaterTelemetryLog", function () {
  it("records a snapshot for the sector reporter", async function () {
    const { log, reporterA, idA } = await deployFixture();
    await expect(log.connect(reporterA).recordSnapshot(idA, 2000n, 1800n, 200n, 50000n))
      .to.emit(log, "SnapshotRecorded")
      .withArgs(idA, 2000n, 1800n, 200n, 50000n, anyValue);

    const snap = await log.latestSnapshot(idA);
    expect(snap.upstreamFlowRate).to.equal(2000n);
    expect(snap.deltaQ).to.equal(200n);
    expect(await log.snapshotCount(idA)).to.equal(1n);
  });

  it("reverts with TooSoon until the interval has elapsed", async function () {
    const { log, reporterA, idA } = await deployFixture();
    await log.connect(reporterA).recordSnapshot(idA, 1n, 1n, 1n, 1n);
    const t0 = BigInt(await time.latest());
    await expect(
      log.connect(reporterA).recordSnapshot(idA, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "TooSoon");

    // One second short of the interval: still rejected.
    await time.setNextBlockTimestamp(t0 + 209n);
    await expect(
      log.connect(reporterA).recordSnapshot(idA, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "TooSoon");

    // Exactly the interval: accepted.
    await time.setNextBlockTimestamp(t0 + 210n);
    await log.connect(reporterA).recordSnapshot(idA, 2n, 2n, 2n, 2n);
    expect(await log.snapshotCount(idA)).to.equal(2n);
  });

  it("rejects flow values above 50000 and accepts a large volume", async function () {
    const { log, reporterA, idA } = await deployFixture();
    await expect(
      log.connect(reporterA).recordSnapshot(idA, 50001n, 0n, 0n, 0n)
    ).to.be.revertedWithCustomError(log, "FlowOutOfRange");

    await log.connect(reporterA).recordSnapshot(idA, 50000n, 50000n, 50000n, 10n ** 30n);
    expect((await log.latestSnapshot(idA)).dailyVolumeUsed).to.equal(10n ** 30n);

    await time.increase(210);
    await expect(
      log.connect(reporterA).recordSnapshot(idA, 1n, 50001n, 0n, 0n)
    ).to.be.revertedWithCustomError(log, "FlowOutOfRange");

    await expect(
      log.connect(reporterA).recordSnapshot(idA, 1n, 1n, 50001n, 0n)
    ).to.be.revertedWithCustomError(log, "FlowOutOfRange");
  });

  it("rejects a reporter writing a different sector", async function () {
    const { log, reporterA, reporterB, stranger, idA, idB } = await deployFixture();
    await expect(
      log.connect(reporterA).recordSnapshot(idB, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "NotSectorReporter");
    await expect(
      log.connect(reporterB).recordSnapshot(idA, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "NotSectorReporter");
    await expect(
      log.connect(stranger).recordSnapshot(idA, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "NotSectorReporter");
    await expect(
      log.connect(stranger).recordSnapshot(ethers.ZeroHash, 1n, 1n, 1n, 1n)
    ).to.be.revertedWithCustomError(log, "NotSectorReporter");
  });

  it("lets only the registry owner change the minimum interval", async function () {
    const { log, registry, owner, reporterA, stranger, idA } = await deployFixture();
    await expect(log.connect(stranger).setMinInterval(0n)).to.be.revertedWithCustomError(
      log,
      "NotRegistryOwner"
    );
    await expect(log.connect(reporterA).setMinInterval(0n)).to.be.revertedWithCustomError(
      log,
      "NotRegistryOwner"
    );

    await log.connect(owner).setMinInterval(0n);
    expect(await log.minIntervalSeconds()).to.equal(0n);
    expect(await log.registry()).to.equal(await registry.getAddress());

    await log.connect(reporterA).recordSnapshot(idA, 1n, 1n, 1n, 1n);
    await log.connect(reporterA).recordSnapshot(idA, 2n, 2n, 2n, 2n);
    expect(await log.snapshotCount(idA)).to.equal(2n);
  });
});
