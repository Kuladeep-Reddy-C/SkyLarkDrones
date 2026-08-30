import { nanoid } from 'nanoid';

/**
 * In-memory conversation store. Deliberately not persisted — Monday.com is the
 * system of record and chat history is disposable context. Swap this for Redis
 * / a DB if durable history is needed.
 */
const MAX_TURNS = 20;
const conversations = new Map();

export function createConversation() {
  const id = nanoid(12);
  conversations.set(id, { id, createdAt: Date.now(), messages: [] });
  return id;
}

export function getConversation(id) {
  return conversations.get(id) || null;
}

export function ensureConversation(id) {
  if (id && conversations.has(id)) return conversations.get(id);
  const newId = createConversation();
  return conversations.get(newId);
}

export function appendTurn(id, role, content) {
  const conv = conversations.get(id);
  if (!conv) return;
  conv.messages.push({ role, content, at: Date.now() });
  if (conv.messages.length > MAX_TURNS * 2) {
    conv.messages.splice(0, conv.messages.length - MAX_TURNS * 2);
  }
}

export function historyFor(id) {
  const conv = conversations.get(id);
  if (!conv) return [];
  return conv.messages.map(({ role, content }) => ({ role, content }));
}
