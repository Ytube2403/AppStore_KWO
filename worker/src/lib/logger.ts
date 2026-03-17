const WORKER_ID = process.env.WORKER_ID || 'worker-1'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

function fmt(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString()
  const base = `[${ts}] [${WORKER_ID}] [${level.toUpperCase()}] ${message}`
  return meta ? `${base} ${JSON.stringify(meta)}` : base
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(fmt('info', msg, meta)),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(fmt('warn', msg, meta)),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(fmt('error', msg, meta)),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') console.log(fmt('debug', msg, meta))
  },
}
