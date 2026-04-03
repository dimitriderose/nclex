import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../services/logger'

describe('logger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('info', () => {
    it('calls console.info with JSON including level, timestamp, message', () => {
      logger.info('test message')
      expect(infoSpy).toHaveBeenCalledOnce()
      const arg = JSON.parse(infoSpy.mock.calls[0][0])
      expect(arg.level).toBe('INFO')
      expect(arg.message).toBe('test message')
      expect(arg.timestamp).toBeDefined()
    })

    it('includes context when provided', () => {
      logger.info('with context', { userId: '123' })
      const arg = JSON.parse(infoSpy.mock.calls[0][0])
      expect(arg.context).toEqual({ userId: '123' })
    })

    it('does not include context key when context is omitted', () => {
      logger.info('no context')
      const arg = JSON.parse(infoSpy.mock.calls[0][0])
      expect(arg).not.toHaveProperty('context')
    })
  })

  describe('warn', () => {
    it('calls console.warn with JSON including level WARN', () => {
      logger.warn('warning message')
      expect(warnSpy).toHaveBeenCalledOnce()
      const arg = JSON.parse(warnSpy.mock.calls[0][0])
      expect(arg.level).toBe('WARN')
      expect(arg.message).toBe('warning message')
    })

    it('includes context when provided', () => {
      logger.warn('context warn', { detail: 'stuff' })
      const arg = JSON.parse(warnSpy.mock.calls[0][0])
      expect(arg.context).toEqual({ detail: 'stuff' })
    })
  })

  describe('error', () => {
    it('calls console.error with JSON including level ERROR', () => {
      logger.error('error message')
      expect(errorSpy).toHaveBeenCalledOnce()
      const arg = JSON.parse(errorSpy.mock.calls[0][0])
      expect(arg.level).toBe('ERROR')
      expect(arg.message).toBe('error message')
    })

    it('calls fetch to /api/errors/report', async () => {
      logger.error('report this')
      // Wait for the fire-and-forget fetch
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce()
      })
      const [url, options] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/errors/report')
      expect(options.method).toBe('POST')
      const body = JSON.parse(options.body as string)
      expect(body.message).toBe('report this')
    })

    it('includes componentStack from context', async () => {
      logger.error('stack error', { componentStack: '<App>' })
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce()
      })
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      expect(body.componentStack).toBe('<App>')
    })

    it('uses empty string for componentStack when not provided', async () => {
      logger.error('no stack')
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce()
      })
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      expect(body.componentStack).toBe('')
    })

    it('silently catches fetch failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network down'))
      // Should not throw
      expect(() => logger.error('failing report')).not.toThrow()
      // Wait a tick for the promise to settle
      await new Promise((r) => setTimeout(r, 10))
    })

    it('includes context in console output', () => {
      logger.error('with ctx', { extra: 'data' })
      const arg = JSON.parse(errorSpy.mock.calls[0][0])
      expect(arg.context).toEqual({ extra: 'data' })
    })
  })
})
