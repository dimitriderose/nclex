/**
 * readerLogger.ts — Thin structured logging wrapper for the EPUB reader.
 *
 * Each method emits a JSON object to the console with a consistent shape:
 *   { level, timestamp, action, ...data }
 */

const sessionId = crypto.randomUUID()

function formatEntry(
  level: string,
  action: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    level,
    timestamp: new Date().toISOString(),
    sessionId,
    action,
    ...extra,
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

export const readerLog = {
  info(action: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify(formatEntry('info', action, data)))
  },

  warn(action: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify(formatEntry('warn', action, data)))
  },

  error(action: string, error: unknown, context?: Record<string, unknown>): void {
    console.error(
      JSON.stringify(
        formatEntry('error', action, {
          error: extractErrorMessage(error),
          ...context,
        }),
      ),
    )
  },

  debug(action: string, data?: Record<string, unknown>): void {
    if (localStorage.getItem('reader-debug') === 'true') {
      console.debug(JSON.stringify(formatEntry('debug', action, data)))
    }
  },
}
