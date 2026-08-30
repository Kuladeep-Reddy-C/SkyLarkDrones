import 'dotenv/config';
import { z } from 'zod';

const csv = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const EnvSchema = z.object({
  MONDAY_API_TOKEN: z.string().min(1, 'MONDAY_API_TOKEN is required'),
  MONDAY_API_VERSION: z.string().default('2024-10'),
  MONDAY_DEALS_BOARD_ID: z.string().optional().default(''),
  MONDAY_WORK_ORDERS_BOARD_ID: z.string().optional().default(''),
  MONDAY_DEALS_BOARD_NAME: z.string().default('Deals'),
  MONDAY_WORK_ORDERS_BOARD_NAME: z.string().default('Work Orders'),
  MONDAY_WORKSPACE_ID: z.string().default('3380356'),

  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
  GROQ_FALLBACK_MODEL: z.string().default('openai/gpt-oss-120b'),

  PORT: z.coerce.number().default(8080),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATA_CACHE_TTL_SECONDS: z.coerce.number().default(300),
  KEEP_WARM_URL: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}
const env = parsed.data;

export const config = {
  monday: {
    token: env.MONDAY_API_TOKEN,
    apiVersion: env.MONDAY_API_VERSION,
    endpoint: 'https://api.monday.com/v2',
    dealsBoardId: env.MONDAY_DEALS_BOARD_ID,
    workOrdersBoardId: env.MONDAY_WORK_ORDERS_BOARD_ID,
    dealsBoardName: env.MONDAY_DEALS_BOARD_NAME,
    workOrdersBoardName: env.MONDAY_WORK_ORDERS_BOARD_NAME,
    workspaceId: env.MONDAY_WORKSPACE_ID,
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
    fallbackModel: env.GROQ_FALLBACK_MODEL,
  },
  server: {
    port: env.PORT,
    corsOrigins: csv(env.CORS_ORIGINS),
    keepWarmUrl: env.KEEP_WARM_URL,
  },
  cache: {
    ttlSeconds: env.DATA_CACHE_TTL_SECONDS,
  },
} as const;

export const hasLLM = Boolean(config.groq.apiKey);
