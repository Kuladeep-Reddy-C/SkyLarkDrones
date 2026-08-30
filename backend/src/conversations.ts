import { nanoid } from 'nanoid';
import type { HistoryTurn } from './agent/agent.js';

/**
 * In-memory conversation store. Deliberately not persisted — Monday.com is the
 * system of record and chat history is disposable context. Swap for Redis / a DB
 * if durable history is ever needed.
 */
const MAX_TURNS = 20;

interface StoredTurn extends HistoryTurn {
  at: number;
}
interface Conversation {
  id: string;
  createdAt: number;
  messages: StoredTurn[];
}

const conversations = new Map<string, Conversation>();

export function createConversation(): string {
  const id = nanoid(12);
  conversations.set(id, { id, createdAt: Date.now(), messages: [] });
  return id;
}

export function getConversation(id: string): Conversation | null {
  return conversations.get(id) ?? null;
}

export function ensureConversation(id?: string | null): Conversation {
  if (id && conversations.has(id)) return conversations.get(id)!;
  return conversations.get(createConversation())!;
}

export function appendTurn(id: string, role: HistoryTurn['role'], content: string): void {
  const conv = conversations.get(id);
  if (!conv) return;
  conv.messages.push({ role, content, at: Date.now() });
  if (conv.messages.length > MAX_TURNS * 2) {
    conv.messages.splice(0, conv.messages.length - MAX_TURNS * 2);
  }
}

export function historyFor(id: string): HistoryTurn[] {
  const conv = conversations.get(id);
  if (!conv) return [];
  return conv.messages.map(({ role, content }) => ({ role, content }));
}
