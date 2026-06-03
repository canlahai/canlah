export function info(...args){ console.info('[canlah]', ...args); }
export function warn(...args){ console.warn('[canlah]', ...args); }
export function error(...args){ console.error('[canlah]', ...args); }
export function debug(...args){ if (process.env.DEBUG) console.debug('[canlah]', ...args); }
