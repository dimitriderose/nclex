import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('readerLogger', () => {
  let readerLog: typeof import('../../reader/readerLogger').readerLog

  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    vi.restoreAllMocks()
    const mod = await import('../../reader/readerLogger')
    readerLog = mod.readerLog
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('info calls console.log with JSON containing level, action, timestamp, sessionId', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    readerLog.info('test-action')
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('info')
    expect(parsed.action).toBe('test-action')
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.sessionId).toBeDefined()
  })

  it('info includes extra data fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    readerLog.info('test-action', { foo: 'bar', count: 42 })
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.foo).toBe('bar')
    expect(parsed.count).toBe(42)
  })

  it('warn calls console.warn with level "warn"', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    readerLog.warn('warning-action')
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('warn')
  })

  it('error extracts Error.message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readerLog.error('error-action', new Error('something broke'))
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('error')
    expect(parsed.error).toBe('something broke')
  })

  it('error handles string errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readerLog.error('error-action', 'string error')
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.error).toBe('string error')
  })

  it('error includes context fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readerLog.error('error-action', new Error('fail'), { page: 5 })
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.page).toBe(5)
  })

  it('debug does NOT log when reader-debug is unset', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    readerLog.debug('debug-action')
    expect(spy).not.toHaveBeenCalled()
  })

  it('debug logs when reader-debug=true', () => {
    localStorage.setItem('reader-debug', 'true')
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    readerLog.debug('debug-action')
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('debug')
  })

  it('all entries share same sessionId', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    readerLog.info('action1')
    readerLog.warn('action2')
    const parsed1 = JSON.parse(logSpy.mock.calls[0][0])
    const parsed2 = JSON.parse(warnSpy.mock.calls[0][0])
    expect(parsed1.sessionId).toBe(parsed2.sessionId)
    expect(parsed1.sessionId).toBeTruthy()
  })

  it('entries include ISO timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    readerLog.info('ts-test')
    const parsed = JSON.parse(spy.mock.calls[0][0])
    // Valid ISO string
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp)
  })
})
