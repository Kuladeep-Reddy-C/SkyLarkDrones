import { config } from '../config.js';
import { log } from '../logger.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface GraphQLBody<T> {
  data?: T;
  errors?: { message: string }[];
}

// ---- global client-side spacing -------------------------------------------
// Monday enforces a short-window burst limit that returns 429 with a long
// cooldown. We serialise requests with a minimum gap to stay well under it.
const MIN_GAP_MS = Number(process.env.MONDAY_MIN_GAP_MS ?? 350);
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
    if (wait) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const next = chain.then(run, run) as Promise<T>;
  chain = next.catch(() => {});
  return next;
}

interface RateLimitEntry {
  remaining: number;
  reset: number | null;
}

// Monday returns e.g.  "minuteRate";r=1334, "concurrency";r=79, "complexityMinute";r=999980;t=60
function parseRateLimit(header: string | null): Record<string, RateLimitEntry> | null {
  if (!header) return null;
  const out: Record<string, RateLimitEntry> = {};
  for (const part of header.split(',')) {
    const m = part.match(/"([^"]+)";\s*r=(\d+)(?:;\s*t=(\d+))?/);
    if (m) out[m[1]] = { remaining: Number(m[2]), reset: m[3] ? Number(m[3]) : null };
  }
  return out;
}

// Proactively pause when the per-minute complexity budget is nearly spent so we
// never trip a 429 (which carries a much longer penalty).
const COMPLEXITY_FLOOR = Number(process.env.MONDAY_COMPLEXITY_FLOOR ?? 220000);
let budgetPause = 0; // epoch ms until which we should wait

async function rawRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  retries: number,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const pauseFor = budgetPause - Date.now();
    if (pauseFor > 0) {
      log.warn(
        `Monday complexity budget low, pausing ${Math.ceil(pauseFor / 1000)}s for window reset`,
      );
      await sleep(pauseFor);
    }

    let res: Response;
    try {
      res = await fetch(config.monday.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: config.monday.token,
          'API-Version': config.monday.apiVersion,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt > retries) throw new Error(`Monday API network error: ${message}`);
      const w = Math.min(2 ** attempt * 500, 8000);
      log.warn(`Monday network error (attempt ${attempt}), retry in ${w}ms: ${message}`);
      await sleep(w);
      continue;
    }

    if (res.status === 429) {
      if (attempt > retries) throw new Error(`Monday API 429 after ${attempt} attempts`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      const rl = parseRateLimit(res.headers.get('ratelimit'));
      const resetIn = rl?.complexityMinute?.reset;
      const w = retryAfter
        ? retryAfter * 1000 + 500
        : resetIn
          ? resetIn * 1000 + 2000
          : Math.min(20000 + attempt * 10000, 70000);
      log.warn(
        `Monday 429 (attempt ${attempt}) [${res.headers.get('ratelimit') || 'no-rl-header'}], cooling down ${Math.round(w / 1000)}s`,
      );
      await sleep(w);
      continue;
    }
    if (res.status >= 500) {
      if (attempt > retries)
        throw new Error(`Monday API HTTP ${res.status} after ${attempt} attempts`);
      await sleep(Math.min(2 ** attempt * 750, 15000));
      continue;
    }

    const body = (await res.json().catch(() => null)) as GraphQLBody<T> | null;
    if (!res.ok || !body) {
      throw new Error(`Monday API HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 500)}`);
    }
    if (body.errors && body.errors.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      if (/complexity budget|rate limit|per minute|Retry in/i.test(msg) && attempt <= retries) {
        const m = msg.match(/(\d+)\s*seconds?/i);
        const w = (m ? Number(m[1]) : 30) * 1000 + 1000;
        log.warn(
          `Monday complexity/rate limit (attempt ${attempt}), waiting ${Math.round(w / 1000)}s`,
        );
        await sleep(w);
        continue;
      }
      throw new Error(`Monday GraphQL error: ${msg}`);
    }

    const rl = parseRateLimit(res.headers.get('ratelimit'));
    const cm = rl?.complexityMinute;
    if (cm && cm.remaining < COMPLEXITY_FLOOR) {
      budgetPause = Date.now() + ((cm.reset ?? 60) + 2) * 1000;
    }
    return body.data as T;
  }
}

export function mondayRequest<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  { retries = 10 }: { retries?: number } = {},
): Promise<T> {
  return schedule(() => rawRequest<T>(query, variables, retries));
}

export interface MondayAccountInfo {
  me: { id: string; name: string; email: string };
  account: { id: string; name: string; tier: string };
}

export function getAccountInfo(): Promise<MondayAccountInfo> {
  return mondayRequest<MondayAccountInfo>(
    `query { me { id name email } account { id name tier } }`,
  );
}

export interface MondayBoardRef {
  id: string;
  name: string;
}

/**
 * List boards. NOTE: Monday bills query complexity as `limit * per-board-cost`,
 * so a big `limit` + heavy fields (items_count) can exhaust the whole per-minute
 * budget in one call. Keep this lean and paginate if ever needed.
 */
export async function listBoards({ limit = 50 }: { limit?: number } = {}): Promise<
  MondayBoardRef[]
> {
  const data = await mondayRequest<{ boards: MondayBoardRef[] | null }>(
    `query ($limit: Int!) { boards(limit: $limit, state: active) { id name } }`,
    { limit },
  );
  return data.boards ?? [];
}
