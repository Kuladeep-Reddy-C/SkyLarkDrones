/**
 * Safe defaults for required env vars so tests that transitively import
 * `src/config.ts` don't hit its fail-fast (CI runs without secrets).
 * `??=` means a real .env / real CI secret always wins.
 */
process.env.MONDAY_API_TOKEN ??= 'test-monday-token';
process.env.GROQ_API_KEY ??= '';
process.env.MONDAY_DEALS_BOARD_ID ??= '0';
process.env.MONDAY_WORK_ORDERS_BOARD_ID ??= '0';
