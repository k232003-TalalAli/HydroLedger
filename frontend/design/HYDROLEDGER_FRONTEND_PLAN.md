# HydroLedger Frontend-First Plan (Option C)

> Paste into Cursor (Agent mode) at the repo root.  
> **Source of truth for UI:** [`design/mock.html`](./mock.html) — Operator/Admin canvas + Citizen canvas.  
> If this plan and the mock disagree on visuals/layout, **the mock wins**.  
> Full-stack backend/contracts are **out of scope for this owner**; see **Appendix A** for teammates.

---

## 0. How to work

1. Build phases **F1 → F6** in order. Finish acceptance for each before the next.
2. Keep it simple. No Fastify/Postgres/Hardhat in this track. Mock sensors live in `apps/web/src/mocks/`.
3. TypeScript strict. No `any`. Shared types in `packages/shared`.
4. Shape DTOs and Query hooks so a real API can replace the mock later without UI rewrites.
5. Never hardcode secrets. Use `.env` + committed `.env.example` (web-only vars for now).
6. Ask before adding a dependency not listed here or changing the public mock DTO shapes teammates will implement against.

---

## 1. Product summary (frontend slice)

**HydroLedger** dashboard for a benchtop water network (Reservoir → N1 → N2 → Valve → N3 → Sectors):

- Live flow KPIs, topology map, ΔQ leak/blockage alerts, sector quotas, Merkle batch integrity UI, valve controls (UI), three roles: **Citizen**, **Operator**, **Admin**.
- Data is **simulated in-browser** until teammates ship API/chain.
- Auditability UX (verify batch) is on the front page; verification recomputes Merkle client-side against a **mock** on-chain root (labeled simulated).

---

## 2. Scope

### In scope

- Pixel-faithful shell and pages matching `mock.html` (both canvases).
- Design tokens, StatusGlyph language (no red/green), motion + `prefers-reduced-motion`.
- Role-aware nav (hide unauthorized items) + dev role switcher.
- In-browser mock engine (1 Hz), scenarios, TanStack Query hooks.
- All routes: Overview, Flow, Alerts, Quotas, Ledger (+ verify modal), Valves, Reports, Admin, Citizen `/public`.
- `API_CONTRACT.md` handoff for teammates.

### Out of scope (teammates / Appendix A)

- Fastify API, Postgres/Drizzle, real JWT cookies, WebSocket server.
- Hardhat contracts, real Ethers wallet/SIWE, anchoring worker.
- Hardware ingest; production Docker full stack.

---

## 3. Tech stack

| Layer | Choice |
| ----- | ------ |
| Monorepo | pnpm workspaces |
| Web | React 18 + Vite + TypeScript, React Router, Tailwind, TanStack Query, Zustand |
| Charts | uPlot + small custom SVG sparklines/quota bars |
| Fonts | Space Grotesk + JetBrains Mono via `@fontsource` |
| Shared | `packages/shared` — types, roles, Merkle helpers |
| Testing | Vitest + Testing Library |
| Quality | ESLint, Prettier, `tsc --noEmit`, Husky + lint-staged, GitHub Actions (web/shared) |

Stubs may remain at `apps/api`, `apps/simulator`, `packages/contracts` until teammates need them — **do not implement** them on this track.

### Repo layout

```
hydroledger/
  apps/web/                 # React dashboard + mocks/
  packages/shared/          # types, roles, merkle
  design/mock.html          # visual SoT
  design/HYDROLEDGER_FRONTEND_PLAN.md
  design/HYDROLEDGER_CURSOR_PLAN.md   # archived full-stack (reference)
  API_CONTRACT.md
  .env.example
  README.md
```

---

## 4. Design system

Industrial control-room: black canvas, white data, yellow only for “look here / interact”. **No red or green.**

```
--bg: #0A0A0A;   --surface: #161616;  --border: #2A2A2A;
--text: #FFFFFF; --text-2: #A0A0A0;   --accent: #FFC400;
--accent-ink: #0A0A0A;
--hazard: repeating-linear-gradient(45deg, #FFC400 0 8px, #0A0A0A 8px 16px);
```

StatusGlyph: ○ normal · ▲ warning · ◆ critical · × offline/stale — always with text.

---

## 5. Pages (match mock)

Global shell: Top bar 56px + collapsible sidebar + content.

**Operator/Admin Overview:** KPIs, topology (animated flow), alerts, live chart, integrity panel, quotas, on-chain events, valve strip, critical banner.

**Citizen `/public`:** second mock canvas; reduced DTO; mobile-first stacking.

Role matrix: valves/admin hidden from citizen; citizen alert details summary-only.

---

## 6. Mock data architecture

```
MockEngine (1 Hz) → snapshot store → TanStack Query cache → UI
Role (Zustand) → nav + citizen DTO filter
Future teammate API  -.->  same Query hooks
```

- Seed aligned with mock demo: inflow ~42.6 L/min, ΔQ ~4.5 on N1→N2 leak scenario, Sector C ~93%.
- Scenarios: `healthy | leak | blockage | node-drop | quota-surge` (dev panel / `?scenario=`).
- Citizen DTOs strip operator-only fields in the mock layer (same rule a real API must enforce).

---

## 7. Phases

**F1 — Foundation.** Shell, tokens, fonts, UI kit, routing, role switcher, `/__design`.  
**F2 — Mock engine.** Shared types, mock store, scenarios, Query hooks.  
**F3 — Operator Overview.** All overview panels wired to mock.  
**F4 — Citizen view.** Public route matching second canvas.  
**F5 — Remaining pages.** Flow, Alerts, Quotas, Ledger (verify), Valves, Reports, Admin.  
**F6 — Polish + handoff.** a11y/motion, README demo, `API_CONTRACT.md`.

---

## 8. Acceptance (this owner)

- [ ] Both mock canvases reflected; no red/green; glyph + text everywhere.
- [ ] Role switch changes nav and actions.
- [ ] Scenario switch shows leak/blockage/quota within ~3 s in UI.
- [ ] Verify-batch UI vs mock Merkle root (labeled simulated).
- [ ] README: frontend-only demo + what teammates still own.

---

## Appendix A — Teammate contract (Not started / External)

Original full-stack phases live in [`HYDROLEDGER_CURSOR_PLAN.md`](./HYDROLEDGER_CURSOR_PLAN.md). Condensed expectations:

| Area | Expectation |
| ---- | ----------- |
| Ingest | `POST /ingest/readings` with API key; 1 Hz per node |
| Detection | Leak/blockage/quota engine; WS push alerts ≤ 3 s (NFR-03) |
| Auth | JWT httpOnly for operator/admin; citizen public; SIWE for on-chain actions |
| Chain | `HydroLedger.sol` Merkle roots; `getRoot(batchId)`; valve/threshold events |
| Anchoring | Batches `pending → submitted → anchored` with tx hashes |
| RBAC | Server-side DTO reduction for citizen (never UI-only) |

See also root [`API_CONTRACT.md`](../API_CONTRACT.md) for endpoint/event shapes the frontend mocks against.
