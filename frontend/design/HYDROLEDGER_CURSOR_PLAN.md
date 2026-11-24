# HydroLedger: Cursor Build Plan (Production-Ready Dashboard)

> Paste this whole file into Cursor (Agent mode) at the repo root. Also add these as context files in the repo under `/design/`:
>
> - `HydroLedger Dashboard: Front Page Design` (the design doc, saved as `design/front-page-design.md`)
> - `HydroLedger Dashboard.html` (visual mock: Operator/Admin view 1440x1080 + Citizen view 1440x1000, saved as `design/mock.html`)
>
> \*\*The mock and the design doc are the source of truth for visuals and behavior. Open `design/mock.html` in a browser and match it pixel-for-pixel in layout, spacing, typography, color, and states. If this plan and the mock disagree on visuals, the mock wins. If they disagree on behavior, the design doc wins.\*\*

\---

## 0\. How to work (rules for the agent)

1. Plan first, then build in the phases in section 12. Finish each phase's acceptance criteria before starting the next. Commit after each phase with a conventional commit message.
2. Keep it simple. No speculative abstractions, no extra libraries beyond those listed, no dead code, no TODO stubs that pretend to work. If something is mocked (the sensors), it must be an explicit, isolated simulator.
3. TypeScript strict mode everywhere. No `any`. Shared types live in `packages/shared` and are imported by web, api, and the simulator.
4. Every feature ships with tests (section 11). Do not mark a phase done with failing tests, lint errors, or type errors.
5. Never hardcode secrets, private keys, or RPC URLs. Use `.env` with a committed `.env.example`.
6. Ask me before: adding a dependency not listed here, changing the contract's public interface after Phase 3, or deviating from the design.
7. At the end of each phase, output: what was built, how to run it, what is verified, and any known gaps. No fluff.

\---

## 1\. Product summary

**HydroLedger** is a blockchain-backed water distribution monitoring dashboard for a benchtop pipeline network (Reservoir, Node 1, Node 2, Valve, Node 3, Sectors). It:

- Reads flow from sensor nodes and computes upstream/downstream differential `ΔQ` per pipe segment.
- Flags a **leak** when `ΔQ > ε` (configurable threshold) and a **blockage** when downstream flow is about 0 while upstream is nonzero (or a node reads about 0 upstream).
- Anchors batches of sensor readings on-chain as **Merkle roots** (EVM, Hardhat testnet, Ethers.js) so any reading can be verified later (auditability is the main contribution, so it is on the front page).
- Enforces **sector quotas** (population-weighted daily allocation).
- Lets operators/admins **isolate segments / close valves**, with every action logged on-chain (wallet-signed for overrides).
- Serves three roles from one app: **Citizen** (read-only), **Operator**, **Admin**.

Requirements traceability (keep IDs in code comments and tests): FR-01 flow capture, FR-03 differential/leak detection, FR-05 sector quotas, FR-07 Merkle verification, NFR-03 detection latency <= 3 s, NFR-04 node availability. Alerting, Report Generation, User Interface, and Admin Interface are the named modules.

\---

## 2\. Tech stack (fixed, do not substitute)

| Layer            | Choice                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo         | pnpm workspaces                                                                                                                                                                             |
| Web              | React 18 + Vite + TypeScript, React Router, Tailwind CSS (tokens from section 4), TanStack Query, Zustand (UI/session state only)                                                           |
| Charts           | uPlot (live flow chart, performant at 1 Hz) + small custom SVG for sparklines and quota bars                                                                                                |
| Sensor simulator | Node script in `apps/simulator`, publishes readings over HTTP/WS to the API (same contract as real hardware would use)                                                                      |
| Auth             | JWT (access + refresh in httpOnly cookies) for operator/admin accounts; citizen view is public/unauthenticated. Wallet signature (SIWE-style nonce challenge) required for on-chain actions |
| Testing          | Vitest (unit), Playwright (e2e + visual regression), Hardhat tests (contracts), Testing Library                                                                                             |
| Quality          | ESLint, Prettier, `tsc --noEmit`, Husky + lint-staged, GitHub Actions CI                                                                                                                    |
| Fonts            | Space Grotesk (headings/labels), JetBrains Mono (numbers/hashes), self-hosted via `@fontsource` (no runtime CDN)                                                                            |

### Repo layout

```
hydroledger/
  apps/
    web/            # React dashboard
    api/            # Fastify API + WebSocket + detection engine + anchoring worker
    simulator/      # sensor node simulator (6 nodes, scriptable leak/blockage)
  packages/
    shared/         # types, zod schemas, constants, merkle utils, role/permission map
    contracts/      # Hardhat project: contracts, tests, deploy scripts, typechain output
  design/           # front-page-design.md, mock.html
  docker-compose.yml
  .env.example
  .github/workflows/ci.yml
  README.md
```

\---

## 3\. Domain model

Define in `packages/shared` as TypeScript types plus zod schemas, and mirror in Drizzle tables.

- **Node**: `id` (N1..N3, plus Reservoir R0, Valve V1, sector meters SA/SB/SC; total 6 sensor nodes), `type` (`reservoir|junction|valve|sector`), `position` (x,y for topology), `lastSeenAt`, `status` (`online|stale|offline`). Stale after 10 s without data, offline after 30 s (configurable).
- **Segment**: `id`, `upstreamNodeId`, `downstreamNodeId`, `epsilon` (L/min, default 1.0), `blockageThreshold`.
- **Reading**: `id`, `nodeId`, `ts`, `flowLpm` (float), `seq` (monotonic per node), `hash` (keccak256 of canonical JSON), `batchId` (nullable until batched).
- **Batch**: `id` (incrementing, e.g. #1482), `fromTs`, `toTs`, `merkleRoot`, `leafCount`, `status` (`pending|submitted|anchored|failed`), `txHash`, `blockNumber`, `anchoredAt`.
- **Alert**: `id`, `type` (`leak|blockage|quota\_reached|node\_offline|node\_stale`), `severity` (`warning|critical`), `segmentId|sectorId|nodeId`, `measuredDeltaQ`, `epsilon`, `detectedAt`, `latencyMs`, `status` (`active|acknowledged|resolved`), `acknowledgedBy`, `txHash` (nullable), `onchainStatus` (`pending|logged|failed`).
- **Valve**: `id`, `state` (`open|closed|throttled`), `lastChangedAt`, `mode` (`auto|manual\_override`), `changedBy`, `txHash`.
- **Sector**: `id`, `name`, `populationWeight`, `dailyQuotaL`, `usedTodayL`, resets at local midnight (timezone configurable, default Asia/Karachi).
- **User**: `id`, `email`, `passwordHash` (argon2id), `role` (`operator|admin`), `walletAddress` (nullable, linked via signature).
- **AuditEvent** (off-chain mirror of on-chain events): `name` (`LeakDetected|RootAnchored|ValveClosed|ValveOpened|QuotaReached|ThresholdUpdated|OverrideSet`), `txHash`, `blockNumber`, `ts`, `payload`.

### Detection engine (API, `apps/api/src/detection`)

- Sliding window per segment (default 5 s, 1 Hz samples). Compute `ΔQ = Q\_up - Q\_down` using the window mean to suppress noise.
- Leak: `ΔQ > ε` for N consecutive windows (default 2) raises a `critical` leak alert; `ΔQ > 0.6 \* ε` raises `warning`. Hysteresis: resolve only after `ΔQ < 0.5 \* ε` for N windows.
- Blockage: `Q\_up > minFlow` and `Q\_down < 0.05 \* Q\_up` for N windows.
- Record `latencyMs = alertCreatedAt - timestamp of the first offending reading`. Add a test asserting the pipeline meets NFR-03 (<= 3 s) in the simulator.
- Quota: when `usedTodayL >= 0.9 \* dailyQuotaL` raise warning; at 100% raise `quota\_reached` and (if auto mode enabled) throttle/close the sector valve via the contract.
- All thresholds are admin-editable (with audit trail and on-chain `ThresholdUpdated` event).

\---

## 4\. Design system (match the mock exactly)

Industrial control-room: black canvas, white data, yellow only for "look here / interact". **No red or green anywhere.** Status is carried by shape, fill, pattern, and text, never by hue alone.

### Tokens (`apps/web/src/styles/tokens.css` + Tailwind theme)

```
--bg: #0A0A0A;          --surface: #161616;     --border: #2A2A2A;
--text: #FFFFFF;        --text-2: #A0A0A0;      --accent: #FFC400;
--accent-ink: #0A0A0A;  /\* text on yellow \*/
--hazard: repeating-linear-gradient(45deg, #FFC400 0 8px, #0A0A0A 8px 16px);
```

Radii small (4px cards, 2px buttons). 1px borders, no soft shadows. Spacing on a 4px grid. Dark only (no light theme).

### Status language (component `<StatusGlyph />`, used everywhere)

| State         | Glyph             | Style                                            |
| ------------- | ----------------- | ------------------------------------------------ |
| Normal        | ○ hollow circle   | white outline                                    |
| Warning       | ▲ filled triangle | solid yellow                                     |
| Critical      | ◆ filled diamond  | hazard-striped card edge + pulsing yellow border |
| Offline/stale | ×                 | gray, dashed outline                             |

Always pair the glyph with a text label (`aria-label` + visible text).

### Typography

- Headings and small labels: Space Grotesk, uppercase labels with wide letter-spacing (about 0.12em), 11-12px.
- Numbers, hashes, tx ids, timestamps: JetBrains Mono. KPI values large, bold, white. Units (L/min) small, gray.

### Motion

- Live values update in place with a brief yellow flash (150 ms) on change, no page reloads.
- Flow animation on pipes: small yellow dashes moving along the path, speed proportional to L/min (SVG `stroke-dashoffset` animation or rAF; cap at 60 fps; pause when tab hidden).
- Pulse only on critical alerts. Honor `prefers-reduced-motion`: disable pulse, flash, and dash animation (show static dashes).

\---

## 5\. Pages and layout (desktop 1440 wide; follow the mock)

Global shell: **Top bar** (56px) + **collapsible left sidebar** (icon + label; active item has a yellow left bar and yellow text) + content.

### Top bar

- Logo: yellow droplet/chain-link mark + `HYDROLEDGER` wordmark (white).
- **Network indicator**: chain name (e.g. `Hardhat Testnet`), live block number, status dot (○ connected / ▲ lagging / × unreachable) with text.
- **Notification bell** with badge = active alert count (opens alert drawer).
- **Role badge + user menu** (Citizen / Operator / Admin).
- **Connect Wallet** button (yellow outlined). Shows truncated address when connected; handles wrong-network with a "Switch network" action.

### Sidebar routes

`/` Overview, `/flow` Live Flow (per-node detail), `/alerts` history + acknowledgement, `/quotas`, `/ledger` (Merkle proof tool + batch history), `/valves` (Operator/Admin), `/reports`, `/admin` (Admin only). Role-gated items are **hidden** (not disabled) for unauthorized roles, and the routes are also guarded server-side.

### Overview (`/`), exact structure from the doc

1. Header row: `OVERVIEW` + "Last sync: Ns ago" (live counter).
2. **KPI strip (5 cards)**: Total Inflow (FR-01, sparkline), Total Outflow, ΔQ Loss (value + % of inflow; turns yellow with ▲ when > ε), Active Alerts (count; hazard-striped edge when a leak is confirmed), Nodes Online (`6/6`; hover lists stale nodes).
3. **Pipeline topology map (hero)**: SVG schematic Reservoir → N1 → N2 → Valve → N3 → Sectors. White pipes, animated yellow flow dashes, nodes as circles with ID + live L/min (click opens node drawer), valves as bowtie icons (open = hollow, closed = solid yellow), leaking segment drawn with hazard-striped pipe + ◆ marker + tooltip (ΔQ value and bracketing nodes), "BLOCKAGE" tag on a node with about 0 upstream flow. Legend under it. Valve status strip (chips: ID, state, last changed, auto vs manual override).
4. **Active alerts panel** (newest first): severity glyph, title, affected segment/sector, measured ΔQ vs ε, timestamp + detection latency, on-chain badge (`Logged on-chain ✓` + tx link, or `Pending anchoring…`), actions: Details, Acknowledge, Isolate / Close Valve (solid yellow, Operator/Admin only, confirmation modal).
5. **Live flow chart**: upstream (yellow) vs downstream (white), translucent yellow fill between = ΔQ gap, dashed ε band, node/segment selector, time pills (1m, 15m, 1h, 24h), hover crosshair with exact values.
6. **Data integrity panel**: latest batch #, Merkle root (mono, truncated, copy button), anchored block, status chip (`✓ Anchored` / `⏳ Pending`), "next anchor in mm:ss" countdown, **Verify a batch** button.
7. **Sector quota bars**: per-sector bar, percent, litres used / daily quota, population weight. White fill; > 90% yellow + ▲; 100% hazard-striped cap + "Quota Reached".
8. **Recent events (on-chain feed)**: event name, relative time, short tx hash, link icon; "View full audit log" goes to `/ledger`.

### Verification modal (3 steps, white-on-black)

1. Choose a batch / time window, or paste a reading hash.
2. Compute: render the Merkle path as a small tree (nodes white, verified path yellow). **Verification must be real**: fetch the leaf and proof from the API, recompute the root client-side in `packages/shared`, then compare against `getRoot(batchId)` read directly from the contract via Ethers (not via the API).
3. Result banner: `✓ INTEGRITY CONFIRMED: matches on-chain root 0x9f3a…` or `◆ MISMATCH: data differs from anchored record`.

### Role views

| Element                | Citizen      | Operator       | Admin                |
| ---------------------- | ------------ | -------------- | -------------------- |
| KPIs, topology, charts | yes          | yes            | yes                  |
| Quotas, verification   | yes          | yes            | yes                  |
| Alert details          | summary only | full           | full                 |
| Valve controls         | hidden       | view + isolate | override + configure |
| Admin page             | hidden       | hidden         | yes                  |

The **Citizen view** is a separate public route tree (`/public`, also the default when logged out) that matches the second canvas in the mock. It must not receive operator-only fields from the API (enforce server-side by returning a reduced DTO, not by hiding in the UI).

### Critical alert banner

Full-width yellow banner slides under the top bar with a single CTA, shown for unacknowledged critical alerts.

### States

- Loading: charcoal skeleton cards with slow shimmer.
- Stale node: tile greys out, "Last seen 38s ago", dashed outline, × glyph.
- Empty states for alerts/events/batches with clear copy.
- Error states per panel (panel-level error boundary + retry), never a blank page.
- Destructive actions (close valve): modal with affected segment, reason (required text), and typed confirmation or wallet signature.

### Responsive

- Tablet (<= 1024): sidebar collapses to icons; right-hand panels stack under the topology map.
- Mobile (<= 640, citizen focus): single column order KPI carousel → active alert → quotas → integrity status; topology becomes a vertical node list; bell and Verify pinned in a bottom bar.

### Accessibility

WCAG AA minimum (yellow on black about 12:1). Full keyboard navigation, visible focus ring (2px yellow), focus trap in modals, `aria-live="polite"` for KPI/alert updates (throttled), `role="img"` + text alternative for the topology SVG and charts (with a data-table fallback toggle), no information by color alone.

\---

\---

## 8\. Web app implementation notes (`apps/web`)

- Feature-folder structure: `features/{overview,flow,alerts,quotas,ledger,valves,reports,admin,public}`, shared `components/ui` (Card, Button, Modal, Tooltip, StatusGlyph, Chip, Skeleton, DataTable), `lib/{api,ws,chain,format}`.
- Data: TanStack Query for REST with WS pushing updates into the query cache (single source of truth). Do not poll when WS is healthy.
- Chain: `lib/chain.ts` wraps Ethers `BrowserProvider` (wallet) and a read-only `JsonRpcProvider` (for verification and block number even without a wallet). Handle: no wallet installed, user rejects, wrong chain (auto `wallet\_switchEthereumChain`), account change.
- Performance budget: LCP < 2 s on local, JS < 250 kB gz initial route (route-level code splitting, lazy-load uPlot and the Merkle tree modal), 60 fps animation, no re-render storms (memoize topology nodes; update flow values via refs/selectors).
- Formatting helpers: L/min to 1 decimal, hashes truncated `0x9f3a…c21e` with copy button, relative times with absolute tooltip, timezone from settings.
- i18n-ready strings (a simple `t()` wrapper, English only for now).
- Visual match: build components against the mock with Storybook-free approach: add a hidden `/\_\_design` route that renders every component in every state (normal/warning/critical/stale/loading/empty) for review and for Playwright visual snapshots.

\---

## 9\. Sensor simulator (`apps/simulator`)

- Emits 6 nodes at 1 Hz with realistic noise (about ±0.15 L/min), consistent mass balance in the healthy state (inflow 42.6, outflow about 42.5 baseline).
- CLI scenarios: `pnpm sim --scenario healthy|leak|blockage|node-drop|quota-surge`, plus a REPL/`POST /sim/control` (dev only) to trigger a leak of X L/min between N1 and N2 at runtime. The default seeded demo reproduces the mock: ΔQ 4.5 L/min on N1→N2, node N3 delayed signal, Sector C at 93%.
- Uses the real ingest endpoint with an API key, so swapping in real hardware later needs no API changes.

\---

## 10\. Reports module

- Generate PDF/CSV for a time range: flow summary per segment, alerts with latency, valve actions, quota usage, and the list of anchored batches with roots and tx hashes. PDF generated server-side (Playwright/Chromium print of an HTML template using the same design tokens, or `pdfkit` if lighter). Each report embeds a verification footer: report hash + batch IDs covered.
- `/reports` page: list, generate form (range + sections), download.

\---

## 11\. Testing and quality gates

- **Unit (Vitest)**: detection engine (leak, blockage, hysteresis, noise, NFR-03 latency), quota math and midnight rollover (timezone), Merkle build/proof/verify, role/permission map, formatters.
- **Contract (Hardhat)**: per section 6, >= 95% coverage.
- **API integration**: ingest to detection to alert to WS push to anchoring (against a local Hardhat node), auth flows, RBAC matrix test (every endpoint x every role returns the right status and the right DTO shape; citizen never sees operator fields).
- **E2E (Playwright)**: citizen loads and sees live data with no auth; operator logs in, triggers simulator leak, sees ◆ alert within 3 s, acknowledges, closes valve with wallet signature (mock wallet via injected provider), sees `Logged on-chain ✓`; verify-batch flow shows CONFIRMED, and after tampering a reading in the test DB shows MISMATCH; admin edits ε and the contract event appears in the feed.
- **Visual regression**: Playwright snapshots of `/\_\_design` and both canvases at 1440, 1024, 390 widths against baselines taken from the mock.
- **A11y**: axe-core in Playwright on every route (zero serious/critical violations), keyboard-only e2e for the valve-close modal.
- **CI** (GitHub Actions): install, lint, typecheck, unit, contracts, api integration (Postgres service + Hardhat node), e2e, build. Block merge on failure. Dependabot enabled, `pnpm audit` in CI.

\---

## 12\. Phases and acceptance criteria

**Phase 1: Foundation.** Monorepo, tooling, CI, tokens, fonts, `components/ui`, `/\_\_design` route, app shell (top bar, sidebar, routing, role-aware nav with a dev role switcher behind an env flag).
_Done when:_ shell matches the mock at 1440/1024/390; lint/type/tests green; CI passes.

**Phase 2: Contracts.** `HydroLedger.sol`, Merkle lib in shared, tests, deploy script, TypeChain, deployment JSON.
_Done when:_ >= 95% coverage; local deploy works; OZ proof compatibility test passes.

**Phase 3: API core + simulator.** DB schema/migrations, ingest, detection engine, alerts, quotas, REST + WS, simulator scenarios.
_Done when:_ running `pnpm dev` + `pnpm sim --scenario leak` produces a critical leak alert within 3 s; detection tests pass.

**Phase 4: Anchoring + chain integration.** Anchoring worker, on-chain alert/valve/quota logging, event indexer that mirrors chain events into `AuditEvent`, chain WS channel.
_Done when:_ batches go `pending → submitted → anchored` with real tx hashes on Hardhat; restart-safety test passes.

**Phase 5: Overview dashboard (operator/admin).** All section 5 components wired to live data: KPIs, topology with animated flow, alerts panel, live chart, integrity panel, quotas, events feed, valve strip, critical banner.
_Done when:_ visually matches the mock in the healthy and leak scenarios; Playwright snapshot diffs under threshold; reduced-motion respected.

**Phase 6: Verification + wallet + valve control.** Wallet connect, SIWE-style challenge, verify-batch modal with real client-side proof vs on-chain root, close/open valve with confirmation modal and signature, override toggle (Admin).
_Done when:_ tampered data shows MISMATCH; valve actions appear in the on-chain feed with correct actor.

**Phase 7: Remaining pages + Citizen view.** `/flow`, `/alerts`, `/quotas`, `/ledger`, `/valves`, `/reports`, `/admin`, and the public Citizen experience with reduced DTOs and mobile layout.
_Done when:_ RBAC matrix test and e2e suite pass; mobile layout matches the mock.

**Phase 8: Hardening and release.** Performance pass against budgets, security review checklist (OWASP ASVS L1 items relevant here), `docker-compose up` brings up db + hardhat node + deploy + api + web + simulator, README (architecture diagram, setup, env vars, runbook, how to demo each scenario, how to point at a real testnet such as Sepolia), seed data, backup/restore note.
_Done when:_ clean clone to running demo in <= 5 commands; CI green; all acceptance items above verified.

\---

## 13\. Definition of done (production-ready checklist)

- \[ ] Matches the mock (both canvases) at all three breakpoints; no red/green anywhere; every status has glyph + text.
- \[ ] Real data path end-to-end: sensor → ingest → detection → alert → WS → UI, and reading → batch → Merkle root → on-chain → in-browser verification.
- \[ ] NFR-03 verified by an automated test; NFR-04 node availability reflected in UI.
- \[ ] RBAC enforced server-side and in the contract; citizen DTOs contain no operator-only fields.
- \[ ] No secrets in repo; `.env.example` complete; keys never sent to the browser (the backend signer lives only in the API).
- \[ ] Strict TS, zero lint errors, tests green, coverage thresholds met, axe clean, CI required on `main`.
- \[ ] Observability endpoints, structured logs, graceful shutdown, DB migrations versioned.
- \[ ] README lets a new developer run the full demo in minutes.

\---

## 14\. Start now

Begin with **Phase 1**. First reply with a short implementation outline for Phase 1 only (files you will create, libraries you will install, any ambiguity in the design you need me to resolve), then proceed to build it. Do not start Phase 2 until I confirm Phase 1.
