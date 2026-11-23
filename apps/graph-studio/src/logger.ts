// Browser logging transport; application callers use structured events here.
export const logger = {
  warn(event: string, error: unknown): void { console.warn({ event, error }); },
  error(event: string, error: unknown): void { console.error({ event, error }); },
};
