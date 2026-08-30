import Groq from 'groq-sdk';
import { config, hasLLM } from '../config.js';

export const groq = hasLLM ? new Groq({ apiKey: config.groq.apiKey }) : null;

/**
 * Chat completion with automatic fallback to the smaller model if the primary
 * model errors (rate limit, capacity, decommissioned, etc).
 */
export async function chat(params) {
  if (!groq) throw new Error('LLM is not configured (GROQ_API_KEY missing)');
  const models = [config.groq.model, config.groq.fallbackModel].filter(
    (m, i, a) => m && a.indexOf(m) === i,
  );
  let lastErr;
  for (const model of models) {
    try {
      return await groq.chat.completions.create({ ...params, model });
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      // Retry on the fallback model only for transient / model-specific errors
      if (![400, 404, 429, 500, 503].includes(status)) throw err;
    }
  }
  throw lastErr;
}
