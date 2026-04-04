interface LogContext {
  [key: string]: unknown
}

function formatEntry(level: string, message: string, context?: LogContext) {
  return {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
  }
}

export const logger = {
  info(message: string, context?: LogContext) {
    console.info(JSON.stringify(formatEntry('INFO', message, context)))
  },

  warn(message: string, context?: LogContext) {
    console.warn(JSON.stringify(formatEntry('WARN', message, context)))
  },

  error(message: string, context?: LogContext) {
    const entry = formatEntry('ERROR', message, context)
    console.error(JSON.stringify(entry))

    // Fire-and-forget POST to backend for critical errors
    fetch('/api/errors/report', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        componentStack: context?.componentStack ?? '',
        url: window.location.href,
      }),
    }).catch(() => {
      // silently ignore reporting failures
    })
  },
}
