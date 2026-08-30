import { config } from '../config.js';
import { log } from '../logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- global client-side spacing -------------------------------------------
// Monday enforces a short-window burst limit that returns 429 with a long
// cooldown. We serialise requests with a minimum gap to stay well under it.
const MIN_GAP_MS = Number(process.env.MONDAY_MIN_GAP_MS || 350);
let chain = Promise.resolve();
let lastAt = 0;

function schedule(fn) {
  const run = async () => {
    const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
    if (wait) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

// Monday returns e.g.  "minuteRate";r=1334, "concurrency";r=79, "complexityMinute";r=999980;t=60
function parseRateLimit(header) {
  if (!header) return null;
  const out = {};
  for (const part of header.split(',')) {
    const m = part.match(/"([^"]+)";\s*r=(\d+)(?:;\s*t=(\d+))?/);
    if (m) out[m[1]] = { remaining: Number(m[2]), reset: m[3] ? Number(m[3]) : null };
  }
  return out;
}

// Proactively pause when the per-minute complexity budget is nearly spent so we
// never trip a 429 (which carries a much longer penalty).
const COMPLEXITY_FLOOR = Number(process.env.MONDAY_COMPLEXITY_FLOOR || 220000);
let budgetPause = 0; // epoch ms until which we should wait

async function rawRequest(query, variables, retries) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const pauseFor = budgetPause - Date.now();
    if (pauseFor > 0) {
      log.warn(`Monday complexity budget low, pausing ${Math.ceil(pauseFor / 1000)}s for window reset`);
      await sleep(pauseFor);
    }
    let res;
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
      if (attempt > retries) throw new Error(`Monday API network error: ${err.message}`);
      const w = Math.min(2 ** attempt * 500, 8000);
      log.warn(`Monday network error (attempt ${attempt}), retry in ${w}ms: ${err.message}`);
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
        : (resetIn ? resetIn * 1000 + 2000 : Math.min(20000 + attempt * 10000, 70000));
      log.warn(`Monday 429 (attempt ${attempt}) [${res.headers.get('ratelimit') || 'no-rl-header'}], cooling down ${Math.round(w / 1000)}s`);
      await sleep(w);
      continue;
    }
    if (res.status >= 500) {
      if (attempt > retries) throw new Error(`Monday API HTTP ${res.status} after ${attempt} attempts`);
      await sleep(Math.min(2 ** attempt * 750, 15000));
      continue;
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      throw new Error(`Monday API HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 500)}`);
    }
    if (body.errors && body.errors.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      if (/complexity budget|rate limit|per minute|Retry in/i.test(msg) && attempt <= retries) {
        const m = msg.match(/(\d+)\s*seconds?/i);
        const w = (m ? Number(m[1]) : 30) * 1000 + 1000;
        log.warn(`Monday complexity/rate limit (attempt ${attempt}), waiting ${Math.round(w / 1000)}s`);
        await sleep(w);
        continue;
      }
      throw new Error(`Monday GraphQL error: ${msg}`);
    }

    const rl = parseRateLimit(res.headers.get('ratelimit'));
    const cm = rl?.complexityMinute;
    if (cm && cm.remaining < COMPLEXITY_FLOOR) {
      budgetPause = Date.now() + ((cm.reset || 60) + 2) * 1000;
    }
    return body.data;
  }
}

export function mondayRequest(query, variables = {}, { retries = 10 } = {}) {
  return schedule(() => rawRequest(query, variables, retries));
}

export async function getAccountInfo() {
  return mondayRequest(`query { me { id name email } account { id name tier } }`);
}

/**
 * List boards. NOTE: Monday bills query complexity as `limit * per-board-cost`,
 * so a big `limit` + heavy fields (items_count) can exhaust the whole per-minute
 * budget in one call. Keep this lean and paginate if ever needed.
 */
export async function listBoards({ limit = 50 } = {}) {
  const data = await mondayRequest(
    `query ($limit: Int!) { boards(limit: $limit, state: active) { id name } }`,
    { limit },
  );
  return data.boards || [];
}
