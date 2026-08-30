import { z } from 'zod';

/** Request-body schemas for the HTTP routes. Kept side-effect-free so they can
 *  be unit-tested without loading the app (and its env-config fail-fast). */

export const ChatBody = z.object({
  message: z.string().trim().min(1, 'message is required').max(2000),
  // the client sends `null` before a conversation exists
  conversationId: z.string().nullish(),
});

export type ChatBodyInput = z.infer<typeof ChatBody>;
