import type Groq from 'groq-sdk';
import { chat } from './groqClient.js';
import { toolDefinitions, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { buildSchemaBrief } from './schemaBrief.js';
import { chartsFromTrace } from './charts.js';
import { getSnapshot } from '../data/store.js';
import { log } from '../logger.js';
import type { AgentEvent, AgentMeta, AgentResult, ChartSpec, ToolCallTrace } from '../types.js';

const MAX_STEPS = 4;

export type HistoryTurn = { role: 'user' | 'assistant'; content: string };
export type OnEvent = (event: AgentEvent) => void;

interface RunOpts {
  onEvent?: OnEvent;
  systemPrompt?: string;
}

// ---- friendly progress labels ----------------------------------------------
function toolLabel(tool: string, args: Record<string, unknown> = {}): string {
  const board = args.board === 'work_orders' ? 'work orders' : 'deals';
  const filters = Array.isArray(args.filters) ? args.filters : [];
  switch (tool) {
    case 'get_data_overview':
      return 'Reading the data catalogue';
    case 'query_records':
      return `Scanning ${board}${filters.length ? ` (${filters.length} filter${filters.length > 1 ? 's' : ''})` : ''}`;
    case 'aggregate_records':
      return `Aggregating ${board}${args.group_by ? ` by ${String(args.group_by)}` : ''}${
        args.op && args.op !== 'count' ? ` — ${String(args.op)} ${String(args.metric ?? '')}` : ''
      }`;
    case 'pipeline_analysis':
      return 'Computing probability-weighted pipeline';
    case 'refresh_data':
      return 'Pulling a fresh snapshot from Monday.com';
    default:
      return tool;
  }
}

function resultSummary(tool: string, r: any): string {
  if (!r || r.error) return r?.error ? `error: ${r.error}` : 'done';
  if (tool === 'aggregate_records') return `${r.matched} rows → ${r.groups?.length ?? 0} group(s)`;
  if (tool === 'query_records') return `${r.totalMatches} match(es)`;
  if (tool === 'pipeline_analysis') {
    const w = r.openPipeline?.weighted ?? r.overall?.weighted ?? 0;
    return `${r.matched} deals · weighted ${Math.round(w / 1e5) / 10}L`;
  }
  if (tool === 'get_data_overview')
    return `${r.counts?.deals} deals, ${r.counts?.workOrders} work orders`;
  return 'done';
}

// ---- tiny answer cache (context-free first-turn questions only) ------------
interface CacheEntry {
  reply: string;
  charts: ChartSpec[];
  meta: AgentMeta;
}
const answerCache = new Map<string, CacheEntry>();
const norm = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '');

async function cacheKey(userMessage: string): Promise<string> {
  const snap = await getSnapshot();
  return `${snap.fetchedAt}::${norm(userMessage)}`;
}

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

/** Run one agent turn. */
export async function runAgent(
  history: HistoryTurn[],
  userMessage: string,
  opts: RunOpts = {},
): Promise<AgentResult> {
  const onEvent: OnEvent = opts.onEvent ?? (() => {});
  const systemPrompt = opts.systemPrompt ?? SYSTEM_PROMPT;
  const cacheable = history.length === 0 && !opts.systemPrompt;

  if (cacheable) {
    const hit = answerCache.get(await cacheKey(userMessage));
    if (hit) {
      onEvent({ type: 'status', label: 'Recalling a recent answer' });
      onEvent({ type: 'answer', text: hit.reply });
      if (hit.charts.length) onEvent({ type: 'charts', charts: hit.charts });
      onEvent({ type: 'done', meta: { ...hit.meta, cached: true } });
      return {
        reply: hit.reply,
        toolTrace: [],
        steps: 0,
        model: hit.meta.model,
        charts: hit.charts,
        meta: hit.meta,
        cached: true,
      };
    }
  }

  const brief = await buildSchemaBrief();
  const messages: ChatMessage[] = [
    { role: 'system', content: `${systemPrompt}\n\n${brief}` },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: userMessage },
  ];

  onEvent({ type: 'status', label: 'Understanding your question' });

  const toolTrace: ToolCallTrace[] = [];
  let modelUsed = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const t0 = Date.now();
    const res = await chat({
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1200,
    });
    log.debug(`agent step ${step + 1}: LLM ${Date.now() - t0}ms`);
    modelUsed = res.model || modelUsed;
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from LLM');
    messages.push(msg as ChatMessage);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const reply = msg.content?.trim() || '(no answer)';
      const charts = chartsFromTrace(toolTrace);
      const meta: AgentMeta = {
        model: modelUsed,
        steps: step + 1,
        tools: toolTrace.map((t) => ({ tool: t.tool, args: t.args, ok: t.ok })),
      };
      onEvent({ type: 'answer', text: reply });
      if (charts.length) onEvent({ type: 'charts', charts });
      onEvent({ type: 'done', meta });
      if (cacheable) {
        answerCache.set(await cacheKey(userMessage), { reply, charts, meta });
        if (answerCache.size > 60) {
          const first = answerCache.keys().next().value;
          if (first) answerCache.delete(first);
        }
      }
      return { reply, toolTrace, steps: step + 1, model: modelUsed, charts, meta };
    }

    // Execute this step's tool calls in parallel
    await Promise.all(
      calls.map(async (call) => {
        const fnName = call.function?.name ?? 'unknown';
        let fnArgs: Record<string, unknown> = {};
        try {
          fnArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          fnArgs = {};
        }

        const evId = `${step}-${call.id}`;
        onEvent({ type: 'tool', id: evId, tool: fnName, label: toolLabel(fnName, fnArgs) });

        let result: unknown;
        try {
          result = await executeTool(fnName, fnArgs);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        const ok = !(result && typeof result === 'object' && 'error' in result);
        toolTrace.push({ tool: fnName, args: fnArgs, ok, result });
        onEvent({
          type: 'tool_done',
          id: evId,
          tool: fnName,
          label: toolLabel(fnName, fnArgs),
          summary: resultSummary(fnName, result),
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }),
    );
  }

  // Out of steps — force a final answer
  onEvent({ type: 'status', label: 'Wrapping up' });
  const finalRes = await chat({
    messages: [
      ...messages,
      { role: 'user', content: 'Answer now with the data gathered. Note any limits.' },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });
  const reply = finalRes.choices?.[0]?.message?.content?.trim() || '(no answer)';
  const charts = chartsFromTrace(toolTrace);
  const meta: AgentMeta = {
    model: finalRes.model || modelUsed,
    steps: MAX_STEPS,
    tools: toolTrace.map((t) => ({ tool: t.tool, args: t.args, ok: t.ok })),
  };
  onEvent({ type: 'answer', text: reply });
  if (charts.length) onEvent({ type: 'charts', charts });
  onEvent({ type: 'done', meta });
  return { reply, toolTrace, steps: MAX_STEPS, model: meta.model, charts, meta };
}
