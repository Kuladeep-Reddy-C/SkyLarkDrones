# Decision Log — Monday.com BI Agent

## Key assumptions

1. **The two spreadsheets are the source of truth; Monday is a staging layer.**
   The account I was given already had a messy 524-row "New Board" (both datasets
   stacked). I ignored it and imported the two provided `.xlsx` files as clean
   **Deals** (344 rows) and **Work Orders** (176 rows) boards.
2. **Data is loaded into Monday as-is; normalisation happens at query time.**
   This keeps Monday a faithful mirror of the messy source and makes the
   "agent normalises data" requirement real (not a one-off ETL clean).
3. **Money is masked but internally consistent** — ratios, sums and comparisons
   are meaningful even if absolute values are not real. Reported as INR with
   crore/lakh shorthand.
4. **"Energy sector"** is not a literal value. It maps to `Renewables` +
   `Power & Transmission` (from source `Powerline`). The agent states this mapping
   whenever it uses it.
5. **"This quarter/year"**: if the user doesn't specify, the agent asks or states
   the window it assumed (calendar quarter of the latest `Created Date`).
6. **Deal status `Dead` = `Lost`**; `Open` deals are the live pipeline.
7. **Closure probability** is blank for ~75% of deals. Weighted pipeline uses
   `High=0.8 / Medium=0.5 / Low=0.2` and a **0.3 default** for blanks — disclosed
   in every affected answer.
8. **Deals and Work Orders cannot be joined row-to-row.** Work Orders carry a
   `SDPLDEAL-NNN` serial with no matching id on the Deals board. Cross-board
   questions are answered at the **sector / owner** level, and the agent says so.

## Trade-offs chosen and why

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| **Data access pattern** | Pull *all* rows from both boards into an in-memory snapshot (TTL 5 min), run tools locally. | Have the LLM write Monday GraphQL per question. | 520 rows is tiny. Local execution is deterministic, fast, testable, and avoids the LLM hallucinating query syntax or blowing Monday's complexity budget. Still "dynamic" — every refresh re-queries Monday, nothing is hardcoded. |
| **Analytics** | A small deterministic filter/aggregate engine; the LLM only *chooses* tool calls and phrases the answer. | Let the LLM compute numbers. | LLMs are unreliable at arithmetic over dozens of rows. This guarantees the numbers are right; the LLM adds interpretation. |
| **Column types on import** | `numbers` for money, `text` for everything else. | Use Monday `date` / `status` columns. | `date` columns reject `"Dec"` / unparseable values (data loss); `status` columns would silently bucket messy labels. Text preserves the source exactly; the normaliser handles the rest. |
| **LLM provider** | Groq (`openai/gpt-oss-120b`), OpenAI-compatible, with `gpt-oss-20b` fallback. | OpenAI / Anthropic. | Free tier, fast, supports tool calling. The client is provider-agnostic (OpenAI SDK shape) so swapping is a one-line change. |
| **Database** | **None.** Monday is the system of record; conversation history is in-memory. | MongoDB for cache/history (the literal "M" in MERN). | A DB here would be decoration. Monday is read-only and authoritative; chat history is disposable. Documented rather than bolted on. The store layer is a clean seam if durable caching is ever needed. |
| **Monday rate limits** | Client-side complexity-budget pacing + lean queries (small `limit`, no `items_count` in list calls). | Just retry on 429. | Monday bills complexity as `limit × per-row cost`; `boards(limit:200){ items_count }` alone exhausts the entire 1,000,000/min budget. Pacing on the `ratelimit` header is the only reliable fix. |
| **Hosting** | Vercel (frontend) + Render (backend), free tiers. | Single service. | Matches the requested split; blueprint + `vercel.json` included. Backend can also serve the built frontend for a one-service deploy. |
| **Error handling** | Every layer degrades: Monday 429 → paced retry; LLM down → deterministic data summary from `/api/chat`; unparseable field → flagged in the quality report, row kept. | Fail the request. | The brief explicitly rewards graceful handling of API failures and bad data. |

## How I interpreted "help prepare data for leadership updates"

A **one-click, board-ready snapshot** a founder could paste into an investor
update or leadership review — `GET /api/report/leadership` and the "Leadership
Update" button in the UI.

- **Numbers are computed deterministically** from the live snapshot
  (`computeLeadershipMetrics`): open pipeline (raw + probability-weighted), by
  stage and sector; won vs lost count/value; work-order value; billed vs
  collected vs outstanding receivable; AR-priority accounts; execution-status
  mix.
- **An optional LLM pass** turns those metrics into prose sections (Executive
  Summary / Pipeline Health / Revenue & Collections / Sector Performance /
  Operational Delivery / Data Quality Caveats). It is explicitly told *not* to
  change the numbers.
- If the LLM is unavailable, a **templated Markdown report** with the same
  numbers is returned — the update is never blocked on the model.
- **Caveats are attached to the report**, so a leadership number is never shown
  without its "…but 75% of open deals have no probability" context.

## Engineering / code quality

- **Full TypeScript** across both workspaces (`strict`), npm-workspaces monorepo,
  ESLint (flat, typescript-eslint) + Prettier, **Vitest** unit tests (41: field
  normalisation, the query engine's null-handling regressions, chart unit
  scaling, SSE frame parsing), and **GitHub Actions CI** running
  format → lint → typecheck → test → build on every push.
- The backend runs on `tsx` in dev and a `tsc` `dist/` build in prod.
- `backend/src/types.ts` is the single source of truth for the domain + wire
  types; the frontend mirrors the wire contract.

## What I'd do differently / next with more time

- **Persist a rolling snapshot** (SQLite/Redis) so trends ("pipeline vs last
  month") are possible — the current data is a single point in time.
- **Token-level answer streaming** — the trace + answer stream now, but the final
  text still arrives in one SSE frame.
- **Eval set** — 20–30 founder questions with expected numbers, run in CI against
  a recorded fixture snapshot (the current tests use synthetic rows).
- **Tighter cross-board matching** — investigate whether deal row order maps to
  `SDPLDEAL-NNN` serials; if so, enable true deal-to-work-order lineage.
- **Auth** on the hosted prototype and per-user Monday tokens instead of one
  service token.
- **Write-back** (currently read-only): e.g. the agent flags stale deals back to
  Monday as an update.
- **Richer clarification** — a short slot-filling flow for genuinely vague asks.
