const ts = (): string => new Date().toISOString();

export const log = {
  info: (...a: unknown[]): void => console.log(`[${ts()}] INFO `, ...a),
  warn: (...a: unknown[]): void => console.warn(`[${ts()}] WARN `, ...a),
  error: (...a: unknown[]): void => console.error(`[${ts()}] ERROR`, ...a),
  debug: (...a: unknown[]): void => {
    if (process.env.DEBUG) console.log(`[${ts()}] DEBUG`, ...a);
  },
};
