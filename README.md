# Skylark Drones — Monday.com Business Intelligence Agent

A conversational agent that answers founder-level business questions ("How's our
pipeline for the energy sector this quarter?") by reading **live data** from two
Monday.com boards — **Deals** (sales pipeline) and **Work Orders** (project
execution) — normalising the real-world messiness, and returning insight, not
just numbers.

## Live demo

| | URL |
|---|---|
| **App** (Vercel) | https://sky-lark-drones-kulli.vercel.app |
| **API** (Render) | https://skylarkdrones-shbc.onrender.com/api |

> The API runs on Render's free tier — it sleeps after 15 min idle, so the first
> request (or the first question after a pause) can take ~40s to wake. Subsequent
> requests are fast.

> Built for the Skylark Drones full-stack assignment. Stack: **MERN-ish** — React
> (frontend), Express + Node (backend), Monday.com as the system of record, Groq
> for the LLM. MongoDB is intentionally **not** used (see the Decision Log).

---

## Architecture

```
┌────────────┐   HTTPS    ┌──────────────────────── backend (Express) ──────────────────────┐
│  React SPA │ ─────────► │  /api/chat        agent loop (Groq tool-calling)               │
│ (Vercel)   │ ◄───────── │  /api/report/*    leadership update generator                  │
└────────────┘   JSON     │  /api/data/*      health / snapshot / refresh                  │
                          │                                                                │
                          │  ┌── data layer ─────────────────────────────────────────────┐ │
                          │  │ snapshot cache (TTL)  ← normalises dates/numbers/sectors   │ │
                          │  │ analytics engine (filter / aggregate / weighted pipeline)  │ │
                          │  │ data-quality analyser (caveats)                            │ │
                          │  └────────────────────────────▲──────────────────────────────┘ │
                          └───────────────────────────────┼────────────────────────────────┘
                                                          │ GraphQL (read-only)
                                                   ┌──────┴───────┐
                                                   │  Monday.com  │  Deals board + Work Orders board
                                                   └──────────────┘
```

**Request flow for a question**

1. `POST /api/chat` → the agent gets the conversation history + the new message.
2. The agent (Groq `openai/gpt-oss-120b`) is given 5 tools. It first calls
   `get_data_overview` to learn field names, allowed values and data-quality
   caveats, then composes `aggregate_records` / `query_records` /
   `pipeline_analysis` calls.
3. Every tool runs against an **in-memory snapshot** that is refreshed from
   Monday.com on a TTL (default 5 min). The snapshot is built by pulling all
   items from both boards and **normalising every field** — no CSV data is
   hardcoded.
4. The agent answers with the headline number, 2–4 bullets of context, and
   caveats drawn from the data-quality report.

### Key backend modules

| Path | Responsibility |
|---|---|
| `src/monday/client.js` | Monday GraphQL client — retry, and **per-minute complexity-budget pacing** (Monday bills `limit × per-row cost`; naive queries exhaust the 1,000,000/min budget instantly). |
| `src/data/normalize.js` | Field normalisers: messy dates (`"Sat Sep 27 2025 …"`, `"Dec"`, `DD/MM/YYYY`), numbers with units (`"5360 HA"`), null-ish placeholders, sector canonicalisation, `"Dead" → "Lost"`, deal-stage parsing. |
| `src/data/schema.js` | Canonical column definitions used by both the importer and the reader (mapped by column **title**, resilient to id changes). |
| `src/data/store.js` | Snapshot fetch + normalise + cache. |
| `src/data/quality.js` | Fill-rates, per-row issues, cross-board join caveat. |
| `src/agent/analytics.js` | Pure filter/aggregate/weighted-pipeline engine over the normalised rows. |
| `src/agent/tools.js` | The 5 agent tools + the field catalog surfaced to the LLM. |
| `src/agent/agent.js` | The tool-calling loop (max 6 steps, model fallback). |
| `src/reports/leadership.js` | Deterministic leadership metrics + optional LLM narrative. |
| `scripts/importToMonday.js` | One-time ETL: spreadsheets → two Monday boards. |

---

## Prerequisites

- Node.js **20+**
- A Monday.com account + a personal API token (**Profile → Developers → My access tokens**)
- A Groq API key (free at <https://console.groq.com>) — optional; without it the
  agent falls back to a deterministic data summary.

---

## 1. Monday.com setup

You need two boards. The importer creates them for you from the source
spreadsheets in this repo.

```bash
cd backend
cp .env.example .env          # then edit .env — set MONDAY_API_TOKEN and GROQ_API_KEY
npm install
npm run import                # reads ../*.xlsx, creates "Deals" + "Work Orders" boards
```

What the importer does:

- Reads `Deal funnel Data.xlsx` (sheet *Deal tracker*) and
  `Work_Order_Tracker Data.xlsx` (sheet *work order tracker*, header on row 2).
- Skips stray repeated header rows embedded in the data.
- Creates the two boards + their columns (money columns as `numbers`, everything
  else as `text` so nothing is silently coerced/lost).
- Loads the rows **as-is** — Monday stays a faithful mirror of the messy source;
  all cleaning happens at query time.
- Writes `MONDAY_DEALS_BOARD_ID` / `MONDAY_WORK_ORDERS_BOARD_ID` back into `.env`.

> It is **rate-limit aware**: Monday's write budget caps throughput at ~30
> rows/min, so a full import takes ~15–20 minutes and self-paces. It is
> **resumable** — re-run it and it continues from where it stopped. Use
> `npm run import -- --recreate` to wipe and rebuild.

If you already have boards, skip the import and just set the two board-id env
vars (or the `*_BOARD_NAME` vars — the agent resolves by name as a fallback).

## 2. Run the backend

```bash
cd backend
npm run dev        # http://localhost:8080
```

Check it:

```bash
curl localhost:8080/api/data/health
curl localhost:8080/api/data/overview
curl -X POST localhost:8080/api/chat -H 'content-type: application/json' \
  -d '{"message":"What is our total open pipeline value, weighted by probability?"}'
curl localhost:8080/api/report/leadership
```

## 3. Run the frontend

```bash
cd frontend
cp .env.example .env      # leave VITE_API_BASE blank for local (uses the dev proxy)
npm install
npm run dev               # http://localhost:5173
```

---

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/data/health` | Monday + LLM connectivity |
| `GET` | `/api/data/overview[?refresh=1]` | counts, board ids, data-quality report |
| `POST` | `/api/data/refresh` | force a fresh Monday pull |
| `POST` | `/api/chat` | `{ message, conversationId? }` → `{ reply, conversationId, meta }` |
| `GET` | `/api/report/leadership[?narrative=0]` | leadership update (Markdown + metrics) |
| `GET` | `/api/report/leadership/metrics` | just the computed numbers |

---

## Deployment (Vercel + Render)

**Backend → Render**

1. New → Blueprint → point at this repo (`render.yaml` is at the root).
2. Set the secret env vars in the dashboard: `MONDAY_API_TOKEN`, `GROQ_API_KEY`,
   `MONDAY_DEALS_BOARD_ID`, `MONDAY_WORK_ORDERS_BOARD_ID`, and `CORS_ORIGINS`
   (your Vercel URL).

**Frontend → Vercel**

1. New Project → import this repo → set **Root Directory = `frontend`**.
2. Env var `VITE_API_BASE = https://<your-render-service>.onrender.com`.
3. Deploy. `frontend/vercel.json` handles the SPA rewrite.

> Single-service option: run `npm run build` in `frontend/`, and the backend will
> automatically serve `frontend/dist` — deploy just the backend and skip Vercel.

---

## Data-resilience notes

- **Dates** come in as JS date-dumps, ISO, `DD/MM/YYYY`, and bare month names —
  all normalised to `YYYY-MM-DD` (+ `YYYY-MM` month keys); unparseable values are
  flagged, not dropped.
- **Money** is masked but internally consistent; reported as INR with Cr/L
  shorthand.
- **"Energy sector"** has no literal value — it maps to `Renewables` +
  `Power & Transmission`, and the agent says so.
- **Deals ↔ Work Orders** cannot be reliably joined row-to-row (Work Orders carry
  a `SDPLDEAL-NNN` serial with no matching id on the Deals board); cross-board
  analysis is done at the sector / owner level.
- Missing closure probabilities (~75% of deals) use a 0.3 default for weighted
  pipeline; this is disclosed in every relevant answer.

See `docs/DECISION_LOG.md` for assumptions, trade-offs, and the "leadership
update" interpretation.
