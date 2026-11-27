/**
 * Plain-English history of one sector, read from the chain.
 * Nothing is changed on the chain: it is only read.
 *
 * Usage (from hydro-contracts):
 *   node scripts/admin/read-history.js Sector_A
 *
 * Read only: needs no owner key. Uses RPC_URL from hydro-contracts/.env, so on laptop B
 * set RPC_URL=http://127.0.0.1:8545 and copy deployments/besu.json (addresses only).
 *
 * Layout: every telemetry snapshot starts a group. Under it are the blocks that were
 * written AFTER that snapshot, up to the next one. Blocks before the first snapshot
 * (sector creation, early alerts) are listed first under "Setup".
 */
const { ethers } = require("ethers");
const { connect, sectorIdFromName } = require("./common");

const REGISTRY_ABI = [
  "event SectorAdded(bytes32 indexed sectorId, uint256 quotaLimit)",
  "event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp)",
  "event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp)",
  "event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp)",
  "event QuotaChanged(bytes32 indexed sectorId, uint256 oldQuota, uint256 newQuota, uint256 timestamp)",
  "event LeakThresholdChanged(uint256 oldValue, uint256 newValue)",
  "event DayAdvanced(uint256 newDayIndex, uint256 manualDayShift, address indexed by)",
  "event ReporterAdded(address indexed reporter, bytes32 indexed sectorId)",
  "event ReporterRemoved(address indexed reporter, bytes32 indexed sectorId)",
  "function updateSectorState(bytes32 sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 dailyQuotaLimit)",
];
const TELEMETRY_ABI = [
  "event SnapshotRecorded(bytes32 indexed sectorId, uint256 upstreamFlowRate, uint256 downstreamFlowRate, uint256 deltaQ, uint256 dailyVolumeUsed, uint256 timestamp)",
];

const GLOBAL_EVENTS = new Set(["LeakThresholdChanged", "DayAdvanced"]);

// ---------------------------------------------------------------------------
// Formatting helpers (values are stored on-chain multiplied by 100)
// ---------------------------------------------------------------------------
const num = (v) => (Number(v) / 100).toFixed(2);
const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtDateTime = (ts) =>
  new Date(Number(ts) * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
const fmtTime = (ts) => new Date(Number(ts) * 1000).toLocaleTimeString("en-GB", { hour12: false });

function readingText(r) {
  return `upstream ${num(r.up)} L/min, downstream ${num(r.down)} L/min, difference ${num(r.dq)} L/min`;
}

// ---------------------------------------------------------------------------
// Turn raw chain entries into readable groups (pure function, no RPC)
// ---------------------------------------------------------------------------
function buildGroups(entries) {
  entries.sort((a, b) => a.block - b.block || a.order - b.order);

  let valveClosed = false; // tracked from the events, so valve changes are shown only when they happen
  let snapshotNo = 0;
  const groups = [{ title: "Setup (before the first snapshot)", detail: null, lines: [] }];

  // Reports that arrive while the valve is already closed change nothing on-chain, and there can be
  // dozens in a row (one per block). They are folded into ONE line that names the first and last block.
  // The run can span snapshots; it is closed by any other kind of event (reset, rollover, alert...).
  let run = null; // { lines, index, first: {block, ts}, last: {block, ts}, count }
  const runText = (r) => {
    const tail = "but no alerts were generated because the valve is already closed. Reset is still pending.";
    if (r.count === 1) return `  block ${r.first.block}  ${fmtTime(r.first.ts)}  A further report arrived, ${tail}`;
    return (
      `  block ${r.first.block}  ${fmtTime(r.first.ts)}  -  block ${r.last.block}  ${fmtTime(r.last.ts)}:  ` +
      `${r.count} further reports, ${tail}`
    );
  };

  for (const e of entries) {
    if (e.name !== "SnapshotRecorded" && !(e.name === "Reading" && valveClosed)) run = null;

    if (e.name === "SnapshotRecorded") {
      snapshotNo += 1;
      groups.push({
        title: `[${fmtDateTime(e.ts)}] Snapshot #${snapshotNo}  (block ${e.block})`,
        detail:
          `Averaged readings: upstream ${num(e.a.upstreamFlowRate)} L/min, downstream ${num(e.a.downstreamFlowRate)} L/min, ` +
          `difference ${num(e.a.deltaQ)} L/min. Water used so far this quota day: ${num(e.a.dailyVolumeUsed)} L.`,
        lines: [],
      });
      continue;
    }

    let text = null;
    switch (e.name) {
      case "SectorAdded":
        text = `Sector created with a daily quota of ${num(e.a.quotaLimit)} L. Valve open.`;
        break;
      case "ReporterAdded":
        text = `Reporter ${short(e.a.reporter)} authorised to report for this sector.`;
        break;
      case "ReporterRemoved":
        text = `Reporter ${short(e.a.reporter)} removed from this sector.`;
        break;
      case "QuotaChanged":
        text = `Daily quota changed from ${num(e.a.oldQuota)} L to ${num(e.a.newQuota)} L.`;
        break;
      case "LeakThresholdChanged":
        text = `Leak threshold changed from ${num(e.a.oldValue)} to ${num(e.a.newValue)} L/min (applies to all sectors).`;
        break;
      case "DayAdvanced":
        text = `Owner manually moved the chain to quota day #${e.a.newDayIndex}.`;
        break;
      case "DailyRollover":
        text = `New quota day #${e.a.dayIndex} started. Daily water counter reset to 0 L.`;
        if (e.a.valveReopened) {
          valveClosed = false;
          text += " Valve REOPENED automatically (the quota closure was cleared).";
        }
        break;
      case "SectorAlert": {
        valveClosed = true;
        const r = e.reading;
        if (e.a.reason === "ANOMALY_DETECTED") {
          text = "LEAK DETECTED - valve CLOSED." + (r ? ` Reported: ${readingText(r)}.` : "");
        } else if (e.a.reason === "QUOTA_EXCEEDED") {
          text = "DAILY QUOTA EXCEEDED - valve CLOSED." + (r ? ` Water used: ${num(r.volume)} L.` : "");
        } else {
          text = `ALERT (${e.a.reason}) - valve CLOSED.`;
        }
        break;
      }
      case "SectorReset":
        text = valveClosed
          ? `Owner (${short(e.a.by)}) reset the sector: valve REOPENED.`
          : `Owner (${short(e.a.by)}) reset the sector (the valve was already open on-chain).`;
        valveClosed = false;
        break;
      case "Reading":
        if (valveClosed) {
          const lines = groups[groups.length - 1].lines;
          if (run) {
            run.last = { block: e.block, ts: e.ts };
            run.count += 1;
            run.lines[run.index] = runText(run);
          } else {
            run = { lines, index: lines.length, first: { block: e.block, ts: e.ts }, last: { block: e.block, ts: e.ts }, count: 1 };
            lines.push(runText(run));
          }
          continue;
        }
        text = `Reading reported (${readingText(e.reading)}). No alert was triggered.`;
        break;
      default:
        continue;
    }
    groups[groups.length - 1].lines.push(`  block ${e.block}  ${fmtTime(e.ts)}  ${text}`);
  }
  return groups;
}

function render(header, groups) {
  const out = [...header, ""];
  for (const g of groups) {
    if (g.title.startsWith("Setup") && g.lines.length === 0) continue;
    out.push(g.title);
    if (g.detail) out.push(`  ${g.detail}`);
    if (g.lines.length === 0) out.push("  (no other blocks until the next snapshot)");
    else out.push(...g.lines);
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Reading the chain
// ---------------------------------------------------------------------------
async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: node scripts/admin/read-history.js <sectorName>");
    process.exit(1);
  }

  const { provider, registry, telemetry, deployment, url } = connect({ readOnly: true });
  const regIface = new ethers.Interface(REGISTRY_ABI);
  const telIface = new ethers.Interface(TELEMETRY_ABI);
  const id = sectorIdFromName(name).toLowerCase();
  const registryAddr = deployment.registry.toLowerCase();
  const latest = await provider.getBlockNumber();

  // 1. Walk every block: its time, and the reporter's updateSectorState calls for this sector.
  const blockTime = {};
  const readings = {}; // tx hash -> reading
  for (let start = 0; start <= latest; start += 20) {
    const nums = [];
    for (let n = start; n <= Math.min(start + 19, latest); n++) nums.push(n);
    const blocks = await Promise.all(nums.map((n) => provider.getBlock(n, true)));
    for (const b of blocks) {
      blockTime[b.number] = b.timestamp;
      for (const tx of b.prefetchedTransactions) {
        if (!tx.to || tx.to.toLowerCase() !== registryAddr) continue;
        let parsed;
        try {
          parsed = regIface.parseTransaction({ data: tx.data });
        } catch {
          continue;
        }
        if (!parsed || parsed.name !== "updateSectorState" || parsed.args[0].toLowerCase() !== id) continue;
        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt || receipt.status !== 1) continue; // a failed transaction changed nothing
        const up = parsed.args[1];
        const down = parsed.args[2];
        readings[tx.hash] = {
          block: b.number,
          order: tx.index,
          ts: b.timestamp,
          up,
          down,
          dq: up > down ? up - down : 0n, // the contract recomputes this itself
          volume: parsed.args[4],
        };
      }
    }
  }

  // 2. Events from both contracts, for this sector (plus a few global ones).
  const entries = [];
  const alertTxs = new Set();
  const collect = async (address, iface) => {
    const logs = await provider.getLogs({ address, fromBlock: 0, toBlock: latest });
    for (const log of logs) {
      let ev;
      try {
        ev = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!ev) continue;
      const hasSector = ev.fragment.inputs.some((i) => i.name === "sectorId");
      if (hasSector ? ev.args.sectorId.toLowerCase() !== id : !GLOBAL_EVENTS.has(ev.name)) continue;
      const entry = { block: log.blockNumber, order: log.index, ts: blockTime[log.blockNumber], name: ev.name, a: ev.args };
      if (ev.name === "SectorAlert") {
        entry.reading = readings[log.transactionHash];
        alertTxs.add(log.transactionHash);
      }
      entries.push(entry);
    }
  };
  await collect(deployment.registry, regIface);
  await collect(deployment.telemetry, telIface);

  // 3. Reports that changed no alert (e.g. the valve was already closed on-chain).
  for (const [hash, r] of Object.entries(readings)) {
    if (!alertTxs.has(hash)) entries.push({ block: r.block, order: r.order, ts: r.ts, name: "Reading", reading: r });
  }

  // 4. Header: where things stand right now.
  const id32 = sectorIdFromName(name);
  const [sector, cause, day, chainDay, snap, snapCount] = await Promise.all([
    registry.sectorRegistry(id32),
    registry.closeCause(id32),
    registry.quotaDay(id32),
    registry.currentDay(),
    telemetry.latestSnapshot(id32),
    telemetry.snapshotCount(id32),
  ]);
  const causeText = { 1: "because of a leak", 2: "because the daily quota was exceeded" }[Number(cause)] || "";
  const header = [
    `${name} - on-chain history`,
    `Node ${url} | blocks 0 to ${latest} | times shown in ${TZ}`,
    "",
    "Right now",
    `  Valve:           ${sector.isValveClosed ? `CLOSED ${causeText}`.trim() : "OPEN"}`,
    `  Daily quota:     ${num(sector.dailyQuotaLimit)} L`,
    `  Quota day:       #${day} (the chain is on day #${chainDay})`,
    Number(snapCount) > 0
      ? `  Latest snapshot: ${fmtDateTime(snap.timestamp)} - ${num(snap.dailyVolumeUsed)} L used that day (${snapCount} snapshots in total)`
      : "  Latest snapshot: none yet",
    "",
    "Note: the registry's own 'water used' counter is only written when an alert, a rollover or a reset happens,",
    "so it is often 0. The water used over time is in the snapshots below.",
  ];

  console.log(render(header, buildGroups(entries)));
}

module.exports = { buildGroups, render };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.shortMessage || err.message || err);
    process.exit(1);
  });
}
