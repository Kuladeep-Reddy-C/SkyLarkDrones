import Groq from 'groq-sdk';
import { config, hasLLM } from '../config.js';
import { log } from '../logger.js';

export const groq = hasLLM
  ? new Groq({ apiKey: config.groq.apiKey, timeout: 45000, maxRetries: 1 })
  : null;

/**
 * Chat completion with automatic fallback to the secondary model when the
 * primary errors (rate limit / capacity / decommissioned / transient 5xx).
 */
export async function chat(params) {
  if (!groq) throw new Error('LLM is not configured (GROQ_API_KEY missing)');
  // Always keep a known-good, generous-limit model at the end of the chain.
  const models = [config.groq.model, config.groq.fallbackModel, 'openai/gpt-oss-20b']
    .filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr;
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      return await groq.chat.completions.create({ ...params, model });
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const retryable = [408, 409, 429, 500, 502, 503].includes(status);
      log.warn(`Groq ${model} failed (${status || err.message})${retryable && models[i + 1] ? ` -> falling back to ${models[i + 1]}` : ''}`);
      if (!retryable) throw err;
    }
  }
  throw lastErr;
}
