import { chat } from './groqClient.js';
import { toolDefinitions, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { log } from '../logger.js';

const MAX_STEPS = 6;

/**
 * Run one agent turn.
 * @param {Array<{role:string, content:string}>} history  prior conversation turns
 * @param {string} userMessage                            the new user message
 * @param {string} [systemPrompt]
 * @returns {Promise<{reply:string, toolTrace:Array, steps:number, model:string}>}
 */
export async function runAgent(history, userMessage, systemPrompt = SYSTEM_PROMPT) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolTrace = [];
  let modelUsed = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const res = await chat({
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1500,
    });
    modelUsed = res.model || modelUsed;
    const choice = res.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Empty response from LLM');

    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { reply: msg.content?.trim() || '(no answer)', toolTrace, steps: step + 1, model: modelUsed };
    }

    for (const call of calls) {
      const fnName = call.function?.name;
      let fnArgs = {};
      try {
        fnArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        fnArgs = {};
      }
      let result;
      try {
        result = await executeTool(fnName, fnArgs);
      } catch (err) {
        result = { error: err.message };
      }
      toolTrace.push({ tool: fnName, args: fnArgs, ok: !result?.error });
      log.debug(`tool ${fnName}`, fnArgs, '->', result?.error ? `ERR ${result.error}` : 'ok');
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  // Ran out of steps — ask the model to answer with what it has
  const finalRes = await chat({
    messages: [...messages, { role: 'user', content: 'Give your best answer now using the data gathered so far. Note any limits.' }],
    temperature: 0.2,
    max_tokens: 1200,
  });
  return {
    reply: finalRes.choices?.[0]?.message?.content?.trim() || '(no answer)',
    toolTrace,
    steps: MAX_STEPS,
    model: finalRes.model || modelUsed,
  };
}
