# Skylark Signal — Monday.com Business Intelligence Agent

[![CI](https://github.com/Kuladeep-Reddy-C/SkyLarkDrones/actions/workflows/ci.yml/badge.svg)](https://github.com/Kuladeep-Reddy-C/SkyLarkDrones/actions/workflows/ci.yml)

A conversational agent that answers founder-level business questions ("How's our
pipeline for the energy sector this quarter?") by reading **live data** from two
Monday.com boards — **Deals** (sales pipeline) and **Work Orders** (project
execution) — normalising the real-world messiness, and returning insight with
charts, not just numbers.

> Full-stack TypeScript. React + Vite frontend, Express backend, Monday.com as
> the system of record, Groq for the LLM. npm-workspaces monorepo with ESLint +
> Prettier + Vitest + GitHub Actions CI.

## Live demo

| | URL |
|---|---|
| **App** (Vercel) | https://sky-lark-drones-kulli.vercel.app |
| **API** (Render) | https://skylarkdrones-shbc.onrender.com/api |

> The API runs on Render's free tier — it sleeps after 15 min idle, so the first
> request (or first question after a pause) can take ~40s to wake.

---

## Architecture

```
┌────────────┐   HTTPS/SSE   ┌───────────────── backend (Express · TS) ─────────────────┐
│  React SPA │ ────────────► │  POST /api/chat/stream   agent loop (Groq tool-calling)  │
│ (Vercel)   │ ◄──────────── │  GET  /api/report/*      leadership briefing             │
└────────────┘  events/json  │  GET  /api/data/*        health / snapshot / refresh     │
                             │                                                          │
                             │  ┌── data layer ──────────────────────────────────────┐  │
                             │  │ snapshot cache (TTL)  ← normalises every field      │  │
                             │  │ analytics engine (filter / aggregate / weighted)    │  │
                             │  │ data-quality analyser (caveats)                     │  │
                             │  └───────────────────────────▲───────────────────────┘  │
                             └──────────────────────────────┼──────────────────────────┘
                                                            │ GraphQL (read-only)
                                                     ┌──────┴───────┐
                                                     │  Monday.com  │  Deals + Work Orders
                                                     └──────────────┘
```

**A question's journey**

1. `POST /api/chat/stream` → the agent gets conversation history + the new message.
2. The system prompt already carries the field catalog + current data-quality
   caveats (`agent/schemaBrief.ts`), so the agent (Groq `gpt-oss-20b`) usually
   plans its tool calls in one hop.
3. Tools run against an **in-memory snapshot** refreshed from Monday.com on a TTL.
   The snapshot is built by pulling all items from both boards and **normalising
   every field** — no CSV data is hardcoded.
4. A deterministic query engine (`agent/analytics.ts`) does all arithmetic and
   **pre-formats money** (`₹9.04 Cr`) so the LLM never miscalculates.
5. Progress streams back as SSE events (`status`, `tool`, `tool_done`, `answer`,
   `charts`, `done`); the UI shows a live trace and renders charts from the
   agent's own aggregations.

### Backend modules (`backend/src`)

| Path | Responsibility |
|---|---|
| `config.ts` | env parsing + validation (zod) |
| `monday/client.ts` | Monday GraphQL client — retry + **per-minute complexity-budget pacing** |
| `data/normalize.ts` | messy dates / units / null placeholders / sector + status canonicalisation |
| `data/schema.ts` | canonical column definitions (used by importer *and* reader) |
| `data/store.ts` | snapshot fetch + normalise + cache → typed `Snapshot` |
| `data/quality.ts` | fill-rates, per-row issues, cross-board caveat |
| `agent/analytics.ts` | pure filter / aggregate / weighted-pipeline / `fmtINR` |
| `agent/tools.ts` | the 5 agent tools + field catalog |
| `agent/agent.ts` | tool-calling loop, SSE events, answer cache |
| `agent/charts.ts` | tool results → Recharts specs |
| `reports/leadership.ts` | deterministic metrics + optional LLM narrative |
| `scripts/importToMonday.ts` | one-time ETL: spreadsheets → two Monday boards |

---

## Prerequisites

- Node.js **20+** (22 recommended — see `.nvmrc`)
- A Monday.com account + personal API token (**Profile → Developers → My access tokens**)
- A Groq API key (free at <https://console.groq.com>) — optional; without it the
  agent returns a deterministic data summary.

## Setup

```bash
git clone https://github.com/Kuladeep-Reddy-C/SkyLarkDrones
cd SkyLarkDrones
npm install                       # installs both workspaces

cp backend/.env.example backend/.env
#  → set MONDAY_API_TOKEN and GROQ_API_KEY

npm run import -w backend         # reads ./*.xlsx, builds "Deals" + "Work Orders" boards
```

**What the importer does**: reads `Deal funnel Data.xlsx` and
`Work_Order_Tracker Data.xlsx`, skips stray repeated header rows, creates the two
boards + typed columns, loads rows **as-is** (Monday stays a faithful mirror of
the messy source — cleaning happens at query time), and writes the board ids back
into `backend/.env`. It is rate-limit aware (~30 rows/min) and **resumable**; use
`npm run import -w backend -- --recreate` to wipe and rebuild.

If you already have boards, skip the import and set `MONDAY_DEALS_BOARD_ID` /
`MONDAY_WORK_ORDERS_BOARD_ID` (or the `*_BOARD_NAME` vars — resolved by name).

## Run

```bash
npm run dev            # backend :8080 + frontend :5173

# checks
npm run check          # format + lint + typecheck (both) + backend tests
npm run smoke -w backend   # data layer + analytics vs. live Monday, no LLM
```

```bash
curl localhost:8080/api/data/health
curl -X POST localhost:8080/api/chat -H 'content-type: application/json' \
  -d '{"message":"What is our open pipeline, weighted by probability?"}'
curl localhost:8080/api/report/leadership
```

---

## API

| Method | Path | Description |
|---|---|---|
| `GET`  | `/api/data/health` | Monday + LLM connectivity |
| `GET`  | `/api/data/overview[?refresh=1]` | counts + data-quality report |
| `POST` | `/api/data/refresh` | force a fresh Monday pull |
| `POST` | `/api/chat` | `{ message, conversationId? }` → `{ reply, charts, meta }` |
| `POST` | `/api/chat/stream` | same input, Server-Sent-Events stream |
| `GET`  | `/api/report/leadership[?narrative=0]` | leadership briefing (Markdown + metrics) |
| `GET`  | `/api/report/leadership/metrics` | just the computed numbers |

---

## Deployment (Vercel + Render)

**Backend → Render** — `render.yaml` is a root blueprint. Manual setup:
Root Directory *(blank)*, Build `npm install --include=dev && npm run build --workspace backend`,
Start `node backend/dist/server.js`, health check `/healthz`. Set the secret env
vars (`MONDAY_API_TOKEN`, `GROQ_API_KEY`, board ids, `CORS_ORIGINS`).

**Frontend → Vercel** — Root Directory `frontend`, framework auto-detected (Vite),
env `VITE_API_BASE = https://<render-service>.onrender.com`. `frontend/vercel.json`
handles the SPA rewrite.

---

## Data-resilience notes

- **Dates**: JS date-dumps, ISO, `DD/MM/YYYY`, Excel serials and bare month names
  all normalise to `YYYY-MM-DD` (+ month keys); unparseable values are flagged.
- **Money** is masked but internally consistent; reported as INR with Cr/L shorthand.
- **"Energy sector"** has no literal value — maps to `Renewables` +
  `Power & Transmission`; the agent says so.
- **Deals ↔ Work Orders** can't be joined row-to-row; cross-board analysis is done
  at the sector / owner level.
- ~52% of deals have no value and ~75% no probability — disclosed in every
  affected answer (0.3 default for weighted pipeline).

See `docs/DECISION_LOG.md` for assumptions, trade-offs, and the "leadership
update" interpretation.
