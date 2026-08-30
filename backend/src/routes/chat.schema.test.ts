import { describe, it, expect } from 'vitest';
import { ChatBody } from './chat.js';

describe('ChatBody schema', () => {
  it('accepts a null conversationId (client sends null before a conversation exists)', () => {
    const r = ChatBody.safeParse({ message: 'hlo', conversationId: null });
    expect(r.success).toBe(true);
  });
  it('accepts an omitted conversationId', () => {
    expect(ChatBody.safeParse({ message: 'hlo' }).success).toBe(true);
  });
  it('accepts a real conversationId', () => {
    expect(ChatBody.safeParse({ message: 'hlo', conversationId: 'abc123' }).success).toBe(true);
  });
  it('rejects a blank / missing message', () => {
    expect(ChatBody.safeParse({ message: '  ', conversationId: null }).success).toBe(false);
    expect(ChatBody.safeParse({ conversationId: null }).success).toBe(false);
  });
  it('trims the message', () => {
    const r = ChatBody.safeParse({ message: '  hi  ' });
    expect(r.success && r.data.message).toBe('hi');
  });
});
