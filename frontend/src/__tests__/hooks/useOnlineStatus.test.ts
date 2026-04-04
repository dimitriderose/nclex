import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

// Mock sync-queue
const mockFlush = vi.fn().mockResolvedValue({ success: 0, failed: 0 })
const mockGetQueueLength = vi.fn().mockReturnValue(0)

vi.mock('../../services/sync-queue', () => ({
  syncQueue: {
    flush: (...args: unknown[]) => mockFlush(...args),
    getQueueLength: () => mockGetQueueLength(),
  },
}))

// Mock offline-bank
const mockGetBankSize = vi.fn().mockReturnValue(50)

vi.mock('../../services/offline-bank', () => ({
  offlineBank: {
    getBankSize: () => mockGetBankSize(),
  },
}))

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFlush.mockReset().mockResolvedValue({ success: 0, failed: 0 })
    mockGetQueueLength.mockReset().mockReturnValue(0)
    mockGetBankSize.mockReset().mockReturnValue(50)

    // Default: online
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns true when navigator.onLine is true', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(true)
  })

  it('returns false when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(false)
  })

  it('updates to offline when offline event fires', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.isOnline).toBe(false)
  })

  it('updates to online when online event fires', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.isOnline).toBe(true)
  })

  it('flushes sync queue on online event', async () => {
    mockFlush.mockResolvedValue({ success: 2, failed: 0 })

    renderHook(() => useOnlineStatus())

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockFlush).toHaveBeenCalled()
  })

  it('returns queue length', () => {
    mockGetQueueLength.mockReturnValue(3)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.queueLength).toBe(3)
  })

  it('returns offline bank size', () => {
    mockGetBankSize.mockReturnValue(100)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.offlineBankSize).toBe(100)
  })

  it('updates queue length on periodic interval', () => {
    mockGetQueueLength.mockReturnValue(0)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.queueLength).toBe(0)

    mockGetQueueLength.mockReturnValue(5)

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.queueLength).toBe(5)
  })

  it('triggerSync flushes queue and updates state', async () => {
    mockFlush.mockResolvedValue({ success: 3, failed: 0 })
    mockGetQueueLength.mockReturnValue(0)

    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await result.current.triggerSync()
    })

    expect(mockFlush).toHaveBeenCalledOnce()
  })

  it('sets lastSyncAt when flush has successful items', async () => {
    mockFlush.mockResolvedValue({ success: 1, failed: 0 })

    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.lastSyncAt).toBeNull()

    await act(async () => {
      await result.current.triggerSync()
    })

    expect(result.current.lastSyncAt).not.toBeNull()
  })

  it('does not set lastSyncAt when flush has no successful items', async () => {
    mockFlush.mockResolvedValue({ success: 0, failed: 2 })

    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await result.current.triggerSync()
    })

    expect(result.current.lastSyncAt).toBeNull()
  })

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useOnlineStatus())

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function))
  })

  it('cleans up periodic interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useOnlineStatus())
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
