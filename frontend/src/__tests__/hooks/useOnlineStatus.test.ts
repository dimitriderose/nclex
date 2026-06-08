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
const mockMaybeRegenerateBank = vi.fn().mockResolvedValue(false)

vi.mock('../../services/offline-bank', () => ({
  offlineBank: {
    getBankSize: () => mockGetBankSize(),
    maybeRegenerateBank: (...args: unknown[]) => mockMaybeRegenerateBank(...args),
  },
}))

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFlush.mockReset().mockResolvedValue({ success: 0, failed: 0 })
    mockGetQueueLength.mockReset().mockReturnValue(0)
    mockGetBankSize.mockReset().mockReturnValue(50)
    mockMaybeRegenerateBank.mockReset().mockResolvedValue(false)

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

  describe('session-end offline-bank regeneration trigger', () => {
    function setVisibilityState(state: DocumentVisibilityState) {
      Object.defineProperty(document, 'visibilityState', {
        value: state,
        writable: true,
        configurable: true,
      })
    }

    afterEach(() => {
      // Restore the jsdom default so subsequent tests in this file aren't affected.
      setVisibilityState('visible')
    })

    it('calls offlineBank.maybeRegenerateBank on visibilitychange-to-hidden while online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      renderHook(() => useOnlineStatus())

      setVisibilityState('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(mockMaybeRegenerateBank).toHaveBeenCalled()
    })

    it('does NOT call offlineBank.maybeRegenerateBank on visibilitychange-to-hidden while offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      renderHook(() => useOnlineStatus())

      setVisibilityState('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(mockMaybeRegenerateBank).not.toHaveBeenCalled()
    })

    it('does not trigger when visibility changes to visible (not hidden)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      renderHook(() => useOnlineStatus())

      setVisibilityState('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(mockMaybeRegenerateBank).not.toHaveBeenCalled()
    })

    it('calls offlineBank.maybeRegenerateBank on pagehide while online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      renderHook(() => useOnlineStatus())

      await act(async () => {
        window.dispatchEvent(new Event('pagehide'))
      })

      expect(mockMaybeRegenerateBank).toHaveBeenCalled()
    })

    it('does NOT call offlineBank.maybeRegenerateBank on pagehide while offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      renderHook(() => useOnlineStatus())

      await act(async () => {
        window.dispatchEvent(new Event('pagehide'))
      })

      expect(mockMaybeRegenerateBank).not.toHaveBeenCalled()
    })

    it('updates offlineBankSize when regeneration succeeds', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      mockMaybeRegenerateBank.mockResolvedValue(true)
      mockGetBankSize.mockReturnValue(50)

      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current.offlineBankSize).toBe(50)

      mockGetBankSize.mockReturnValue(100)
      setVisibilityState('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(result.current.offlineBankSize).toBe(100)
    })

    it('does not update offlineBankSize when regeneration is a no-op (bank fresh)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      mockMaybeRegenerateBank.mockResolvedValue(false)
      mockGetBankSize.mockReturnValue(50)

      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current.offlineBankSize).toBe(50)

      mockGetBankSize.mockReturnValue(999)
      setVisibilityState('hidden')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(result.current.offlineBankSize).toBe(50)
    })

    it('swallows a rejected maybeRegenerateBank without throwing', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      mockMaybeRegenerateBank.mockRejectedValue(new Error('regenerate failed'))

      renderHook(() => useOnlineStatus())

      setVisibilityState('hidden')
      await expect(act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })).resolves.not.toThrow()

      expect(mockMaybeRegenerateBank).toHaveBeenCalled()
    })

    it('cleans up visibilitychange and pagehide listeners on unmount', () => {
      const docAddSpy = vi.spyOn(document, 'addEventListener')
      const docRemoveSpy = vi.spyOn(document, 'removeEventListener')
      const winAddSpy = vi.spyOn(window, 'addEventListener')
      const winRemoveSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useOnlineStatus())

      expect(docAddSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      expect(winAddSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))

      unmount()

      expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      expect(winRemoveSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
    })
  })
})
