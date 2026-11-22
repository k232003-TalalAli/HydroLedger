const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// One quota day is 600 s (10 minutes) in these tests, the deploy default.
const DAY = 600n;

async function deployFixture() {
  const [owner, reporterA, reporterA2, reporterB, stranger] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("WaterQuotaRegistry");
  const registry = await Registry.deploy(DAY);
  await registry.waitForDeployment();

  const idA = ethers.encodeBytes32String("Sector_A");
  const idB = ethers.encodeBytes32String("Sector_B");
  const quota = 5000n * 100n;

  await registry.addSector(idA, quota);
  await registry.addSector(idB, quota);
  await registry.addReporter(reporterA.address, idA);
  await registry.addReporter(reporterA2.address, idA);
  await registry.addReporter(reporterB.address, idB);

  return { registry, owner, reporterA, reporterA2, reporterB, stranger, idA, idB, quota };
}

describe("WaterQuotaRegistry", function () {
  it("sets the deployer as owner", async function () {
    const { registry, owner } = await deployFixture();
    expect(await registry.owner()).to.equal(owner.address);
    expect(await registry.leakThreshold()).to.equal(500n);
  });

  it("lets only the owner call admin functions", async function () {
    const { registry, reporterA, stranger, idA } = await deployFixture();
    const idC = ethers.encodeBytes32String("Sector_C");

    await expect(registry.connect(stranger).addSector(idC, 100n)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(registry.connect(stranger).setSectorQuota(idA, 100n)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(registry.connect(stranger).setLeakThreshold(100n)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(registry.connect(stranger).setDayOffsetSeconds(60n)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(
      registry.connect(stranger).addReporter(stranger.address, idA)
    ).to.be.revertedWithCustomError(registry, "NotOwner");
    await expect(registry.connect(stranger).removeReporter(reporterA.address)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(registry.connect(stranger).transferOwnership(stranger.address)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
    await expect(registry.connect(stranger).resetSector(idA)).to.be.revertedWithCustomError(
      registry,
      "NotOwner"
    );
  });

  it("rejects a reporter writing another sector, an unknown sector, or an unknown caller", async function () {
    const { registry, reporterA, reporterB, stranger, idA, idB } = await deployFixture();
    const unknown = ethers.encodeBytes32String("Sector_Z");

    await expect(
      registry.connect(reporterA).updateSectorState(idB, 100n, 100n, 0n, 0n, 0n)
    ).to.be.revertedWithCustomError(registry, "ReporterSectorMismatch");

    await expect(
      registry.connect(reporterB).updateSectorState(unknown, 100n, 100n, 0n, 0n, 0n)
    ).to.be.revertedWithCustomError(registry, "SectorUnknown");

    await expect(
      registry.connect(stranger).updateSectorState(idA, 100n, 100n, 0n, 0n, 0n)
    ).to.be.revertedWithCustomError(registry, "ReporterSectorMismatch");

    expect(await registry.isReporter(reporterA.address)).to.equal(true);
    expect(await registry.isReporter(stranger.address)).to.equal(false);
  });

  it("allows several reporters on one sector and only that sector", async function () {
    const { registry, reporterA2, idA } = await deployFixture();
    await registry.connect(reporterA2).updateSectorState(idA, 200n, 150n, 1n, 10n, 1n);
    const stored = await registry.sectorRegistry(idA);
    expect(stored.upstreamFlowRate).to.equal(200n);
    expect(stored.deltaQ).to.equal(50n);
  });

  it("stores a safe deltaQ of 0 when downstream is above upstream and ignores the passed deltaQ", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.connect(reporterA).updateSectorState(idA, 100n, 1000n, 99999n, 0n, 1n);
    const stored = await registry.sectorRegistry(idA);
    expect(stored.deltaQ).to.equal(0n);
    expect(stored.isValveClosed).to.equal(false);
  });

  it("ignores the passed quota and uses the stored quota", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.setSectorQuota(idA, 1000n);
    // Passed quota is enormous. Stored quota is 1000. Volume 1500 must still close.
    await expect(registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 1500n, 10n ** 18n))
      .to.emit(registry, "SectorAlert")
      .withArgs(idA, "QUOTA_EXCEEDED", anyValue);

    const stored = await registry.sectorRegistry(idA);
    expect(stored.dailyQuotaLimit).to.equal(1000n);
    expect(stored.deltaQ).to.equal(0n);
    expect(await registry.closeCause(idA)).to.equal(2n);
  });

  it("closes for ANOMALY_DETECTED when computed deltaQ exceeds the leak threshold", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await expect(registry.connect(reporterA).updateSectorState(idA, 2000n, 1000n, 1n, 0n, 1n))
      .to.emit(registry, "SectorAlert")
      .withArgs(idA, "ANOMALY_DETECTED", anyValue);

    const stored = await registry.sectorRegistry(idA);
    expect(stored.isValveClosed).to.equal(true);
    expect(stored.deltaQ).to.equal(1000n);
    expect(await registry.closeCause(idA)).to.equal(1n);
  });

  it("does not close when computed deltaQ equals the leak threshold", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.connect(reporterA).updateSectorState(idA, 500n, 0n, 0n, 0n, 0n);
    expect((await registry.sectorRegistry(idA)).isValveClosed).to.equal(false);
  });

  it("lets a leak take precedence over a quota breach", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.setSectorQuota(idA, 100n);
    await expect(
      registry.connect(reporterA).updateSectorState(idA, 2000n, 1000n, 0n, 99999n, 1n)
    )
      .to.emit(registry, "SectorAlert")
      .withArgs(idA, "ANOMALY_DETECTED", anyValue);
    expect(await registry.closeCause(idA)).to.equal(1n);
  });

  it("emits SectorAlert only on the open-to-closed transition", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.connect(reporterA).updateSectorState(idA, 2000n, 0n, 0n, 0n, 0n);
    await registry.connect(reporterA).updateSectorState(idA, 2100n, 0n, 0n, 50n, 0n);

    const alerts = await registry.queryFilter(registry.filters.SectorAlert(idA));
    expect(alerts).to.have.length(1);
    expect(alerts[0].args.reason).to.equal("ANOMALY_DETECTED");
    expect((await registry.sectorRegistry(idA)).upstreamFlowRate).to.equal(2100n);
    expect(await registry.closeCause(idA)).to.equal(1n);
  });

  it("does not open a closed valve on a later normal update", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.connect(reporterA).updateSectorState(idA, 2000n, 0n, 0n, 0n, 0n);
    await registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 0n, 0n);

    const stored = await registry.sectorRegistry(idA);
    expect(stored.isValveClosed).to.equal(true);
    expect(stored.deltaQ).to.equal(0n);
    expect(await registry.closeCause(idA)).to.equal(1n);
  });

  it("keeps a quota cause when a later update would have been a leak", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await registry.setSectorQuota(idA, 100n);
    await registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 200n, 0n);
    await registry.connect(reporterA).updateSectorState(idA, 5000n, 0n, 0n, 200n, 0n);
    expect(await registry.closeCause(idA)).to.equal(2n);
    expect((await registry.sectorRegistry(idA)).isValveClosed).to.equal(true);
  });

  it("resetSector opens a leak closure and clears volume", async function () {
    const { registry, owner, reporterA, idA } = await deployFixture();
    await registry.connect(reporterA).updateSectorState(idA, 2000n, 0n, 0n, 80n, 0n);

    await expect(registry.resetSector(idA))
      .to.emit(registry, "SectorReset")
      .withArgs(idA, owner.address, anyValue);

    const stored = await registry.sectorRegistry(idA);
    expect(stored.isValveClosed).to.equal(false);
    expect(stored.dailyVolumeUsed).to.equal(0n);
    expect(await registry.closeCause(idA)).to.equal(0n);
  });

  it("reverts rollover on the same day", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await expect(registry.connect(reporterA).rolloverQuotaDay(idA)).to.be.revertedWithCustomError(
      registry,
      "RolloverNotDue"
    );
  });

  it("reopens a quota closure on rollover and leaves a leak closure shut", async function () {
    const { registry, reporterA, reporterB, idA, idB } = await deployFixture();

    await registry.setSectorQuota(idA, 100n);
    await registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 200n, 0n);
    await registry.connect(reporterB).updateSectorState(idB, 2000n, 0n, 0n, 0n, 0n);

    await time.increase(Number(DAY));

    await expect(registry.connect(reporterA).rolloverQuotaDay(idA))
      .to.emit(registry, "DailyRollover")
      .withArgs(idA, anyValue, true, anyValue);
    expect((await registry.sectorRegistry(idA)).isValveClosed).to.equal(false);
    expect((await registry.sectorRegistry(idA)).dailyVolumeUsed).to.equal(0n);
    expect(await registry.closeCause(idA)).to.equal(0n);

    const leakRoll = await registry.connect(reporterB).rolloverQuotaDay(idB);
    await expect(leakRoll).to.emit(registry, "DailyRollover").withArgs(idB, anyValue, false, anyValue);
    expect((await registry.sectorRegistry(idB)).isValveClosed).to.equal(true);
    expect(await registry.closeCause(idB)).to.equal(1n);

    await expect(registry.connect(reporterA).rolloverQuotaDay(idA)).to.be.revertedWithCustomError(
      registry,
      "RolloverNotDue"
    );
  });

  it("applies quota and leak-threshold changes on the next update", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await expect(registry.setLeakThreshold(100n))
      .to.emit(registry, "LeakThresholdChanged")
      .withArgs(500n, 100n);
    await expect(registry.setSectorQuota(idA, 500n))
      .to.emit(registry, "QuotaChanged")
      .withArgs(idA, 5000n * 100n, 500n, anyValue);

    await expect(registry.connect(reporterA).updateSectorState(idA, 250n, 100n, 0n, 0n, 999999n))
      .to.emit(registry, "SectorAlert")
      .withArgs(idA, "ANOMALY_DETECTED", anyValue);
  });

  it("blocks writes after removeReporter", async function () {
    const { registry, reporterA, idA } = await deployFixture();
    await expect(registry.removeReporter(reporterA.address))
      .to.emit(registry, "ReporterRemoved")
      .withArgs(reporterA.address, idA);

    expect(await registry.isReporter(reporterA.address)).to.equal(false);
    await expect(
      registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 0n, 0n)
    ).to.be.revertedWithCustomError(registry, "ReporterSectorMismatch");
  });

  it("rejects bad sector, quota, threshold, offset, and reporter arguments", async function () {
    const { registry, reporterA, stranger, idA } = await deployFixture();

    await expect(registry.addSector(ethers.ZeroHash, 100n)).to.be.revertedWithCustomError(
      registry,
      "ZeroSectorId"
    );
    await expect(registry.addSector(idA, 100n)).to.be.revertedWithCustomError(
      registry,
      "SectorAlreadyExists"
    );
    await expect(registry.setSectorQuota(idA, 0n)).to.be.revertedWithCustomError(
      registry,
      "QuotaMustBePositive"
    );
    await expect(registry.setLeakThreshold(0n)).to.be.revertedWithCustomError(
      registry,
      "ThresholdMustBePositive"
    );
    await expect(registry.setDayOffsetSeconds(DAY)).to.be.revertedWithCustomError(
      registry,
      "DayOffsetTooLarge"
    );
    await expect(registry.addReporter(ethers.ZeroAddress, idA)).to.be.revertedWithCustomError(
      registry,
      "ZeroAddress"
    );
    await expect(registry.addReporter(reporterA.address, idA)).to.be.revertedWithCustomError(
      registry,
      "AlreadyReporter"
    );
    await expect(registry.removeReporter(stranger.address)).to.be.revertedWithCustomError(
      registry,
      "NotAReporter"
    );
    await expect(registry.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      registry,
      "ZeroAddress"
    );
  });

  it("transfers ownership", async function () {
    const { registry, owner, stranger } = await deployFixture();
    await expect(registry.transferOwnership(stranger.address))
      .to.emit(registry, "OwnershipTransferred")
      .withArgs(owner.address, stranger.address);
    expect(await registry.owner()).to.equal(stranger.address);
    await expect(registry.setLeakThreshold(10n)).to.be.revertedWithCustomError(registry, "NotOwner");
  });

  it("starts a new day every dayLengthSeconds", async function () {
    const { registry } = await deployFixture();
    expect(await registry.dayLengthSeconds()).to.equal(DAY);
    const d0 = await registry.currentDay();
    await time.increase(Number(DAY));
    expect(await registry.currentDay()).to.equal(d0 + 1n);
    await time.increase(Number(DAY) * 3);
    expect(await registry.currentDay()).to.equal(d0 + 4n);
  });

  it("rejects a zero day length at deploy", async function () {
    const Registry = await ethers.getContractFactory("WaterQuotaRegistry");
    await expect(Registry.deploy(0n)).to.be.revertedWithCustomError(Registry, "DayLengthMustBePositive");
  });

  it("lets only the owner advance the day", async function () {
    const { registry, stranger, reporterA } = await deployFixture();
    await expect(registry.connect(stranger).advanceDay()).to.be.revertedWithCustomError(registry, "NotOwner");
    await expect(registry.connect(reporterA).advanceDay()).to.be.revertedWithCustomError(registry, "NotOwner");
  });

  it("advanceDay makes a rollover due at once and reopens a quota closure", async function () {
    const { registry, owner, reporterA, idA } = await deployFixture();

    await registry.setSectorQuota(idA, 100n);
    await registry.connect(reporterA).updateSectorState(idA, 100n, 100n, 0n, 200n, 0n);
    expect((await registry.sectorRegistry(idA)).isValveClosed).to.equal(true);
    await expect(registry.connect(reporterA).rolloverQuotaDay(idA)).to.be.revertedWithCustomError(
      registry,
      "RolloverNotDue"
    );

    const before = await registry.currentDay();
    await expect(registry.advanceDay())
      .to.emit(registry, "DayAdvanced")
      .withArgs(before + 1n, 1n, owner.address);
    expect(await registry.currentDay()).to.equal(before + 1n);
    expect(await registry.manualDayShift()).to.equal(1n);

    // The owner rolls the sector over by hand.
    await expect(registry.rolloverQuotaDay(idA))
      .to.emit(registry, "DailyRollover")
      .withArgs(idA, before + 1n, true, anyValue);
    expect(await registry.quotaDay(idA)).to.equal(before + 1n);
    expect((await registry.sectorRegistry(idA)).isValveClosed).to.equal(false);
    expect((await registry.sectorRegistry(idA)).dailyVolumeUsed).to.equal(0n);

    // The aggregator's own attempt for the same day is now refused. This is the "already done" case.
    await expect(registry.connect(reporterA).rolloverQuotaDay(idA)).to.be.revertedWithCustomError(
      registry,
      "RolloverNotDue"
    );
  });

  it("advanceDay still lets the natural clock move on afterwards", async function () {
    const { registry, idA } = await deployFixture();
    await registry.advanceDay();
    await registry.rolloverQuotaDay(idA);
    const stored = await registry.quotaDay(idA);
    await time.increase(Number(DAY));
    expect(await registry.currentDay()).to.be.greaterThan(stored);
    await registry.rolloverQuotaDay(idA);
  });

  it("shifts currentDay with dayOffsetSeconds", async function () {
    const { registry } = await deployFixture();
    const before = await registry.currentDay();
    await registry.setDayOffsetSeconds(DAY - 1n);
    const after = await registry.currentDay();
    expect(after === before || after === before + 1n).to.equal(true);
  });
});

describe("London bytecode", function () {
  it("does not emit PUSH0 in the executable bytecode", async function () {
    const names = ["WaterQuotaRegistry", "WaterTelemetryLog"];
    for (const name of names) {
      const artifact = await ethers.getContractFactory(name);
      const bytecode = artifact.bytecode;
      expect(containsPush0(stripMetadata(bytecode)), name).to.equal(false);
    }
  });
});

function stripMetadata(bytecode) {
  const hex = bytecode.replace(/^0x/, "");
  const metaLen = parseInt(hex.slice(-4), 16);
  return hex.slice(0, hex.length - 4 - metaLen * 2);
}

function containsPush0(hex) {
  let i = 0;
  while (i < hex.length) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(op)) return false;
    if (op === 0x5f) return true;
    if (op >= 0x60 && op <= 0x7f) {
      const pushBytes = op - 0x5f;
      i += 2 + pushBytes * 2;
    } else {
      i += 2;
    }
  }
  return false;
}
