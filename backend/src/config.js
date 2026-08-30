import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback = '') {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const config = {
  monday: {
    token: required('MONDAY_API_TOKEN'),
    apiVersion: optional('MONDAY_API_VERSION', '2024-10'),
    endpoint: 'https://api.monday.com/v2',
    dealsBoardId: optional('MONDAY_DEALS_BOARD_ID'),
    workOrdersBoardId: optional('MONDAY_WORK_ORDERS_BOARD_ID'),
    dealsBoardName: optional('MONDAY_DEALS_BOARD_NAME', 'Deals'),
    workOrdersBoardName: optional('MONDAY_WORK_ORDERS_BOARD_NAME', 'Work Orders'),
    workspaceId: optional('MONDAY_WORKSPACE_ID', '3380356'),
  },
  groq: {
    apiKey: optional('GROQ_API_KEY'),
    model: optional('GROQ_MODEL', 'openai/gpt-oss-120b'),
    fallbackModel: optional('GROQ_FALLBACK_MODEL', 'openai/gpt-oss-20b'),
  },
  server: {
    port: Number(optional('PORT', '8080')),
    corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  cache: {
    ttlSeconds: Number(optional('DATA_CACHE_TTL_SECONDS', '300')),
  },
};

export const hasLLM = Boolean(config.groq.apiKey);
