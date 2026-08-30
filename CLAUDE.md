# Repo guide

Monorepo (npm workspaces) for **Skylark Signal** — a conversational BI agent over
two Monday.com boards (Deals, Work Orders).

```
backend/    TypeScript · Express API + agent orchestration + ETL. Runs on tsx (dev)
            or compiled dist/ (prod). Vitest for unit tests.
frontend/   TypeScript · React 18 + Vite. Recharts for charts. Vitest + RTL.
docs/       Decision Log.
```

## Commands (run from repo root)

| Command | What |
|---|---|
| `npm install` | installs both workspaces |
| `npm run dev` | backend (:8080) + frontend (:5173) in parallel |
| `npm run check` | format-check → lint → typecheck (both) → backend tests. **Run before pushing.** |
| `npm run build` | `tsc` build of backend, `vite build` of frontend |
| `npm test` | backend vitest |
| `npm run lint` / `npm run format` | eslint / prettier over the repo |
| `npm run import -w backend` | one-time ETL: spreadsheets → two Monday boards |
| `npm run smoke -w backend` | offline check of data layer + analytics vs. live Monday (no LLM) |

## Architecture notes

- **Data flow**: `data/store.ts` pulls every item from both boards on a TTL cache,
  normalises each field (`data/normalize.ts`), and exposes a typed `Snapshot`.
  Nothing is hardcoded from the CSVs.
- **Agent** (`agent/agent.ts`): a Groq tool-calling loop (max 4 steps). The
  field catalog + data-quality caveats are injected into the system prompt
  (`agent/schemaBrief.ts`) so most questions resolve in 2 LLM calls. Tools run
  against the in-memory snapshot via a deterministic query engine
  (`agent/analytics.ts`) — the LLM never does arithmetic; money is pre-formatted.
- **Streaming**: `POST /api/chat/stream` emits SSE `AgentEvent`s (status / tool /
  tool_done / answer / charts / done) consumed by the frontend's live trace panel.
- **Charts** (`agent/charts.ts`): derived from the agent's own aggregation
  results — zero extra LLM cost.
- **Types**: `backend/src/types.ts` is the source of truth; `frontend/src/types.ts`
  mirrors the wire contract.

## Conventions

- ESM everywhere. Backend uses `.js` import specifiers (NodeNext); frontend uses
  `.ts`/`.tsx` specifiers (bundler resolution).
- `strict` TypeScript. Prefer `unknown` + narrowing over `any` at boundaries.
- Commits: authored solely by the repo owner — **no co-author trailer**.
- Secrets live only in `backend/.env` (git-ignored). `.env.example` documents them.
