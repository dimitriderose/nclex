import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock dependencies before importing hook
vi.mock('../../services/sync-queue', () => ({
  syncQueue: {
    getQueueLength: vi.fn(() => 0),
    flush: vi.fn(() => Promise.resolve({ success: 0, failed: 0 })),
  },
}))

vi.mock('../../services/offline-bank', () => ({
  offlineBank: {
    getBankSize: vi.fn(() => 100),
  },
}))

import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { syncQueue } from '../../services/sync-queue'

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns online status from navigator', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(true)
  })

  it('returns offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(false)
  })

  it('updates when offline event fires', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(true)

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.isOnline).toBe(false)
  })

  it('updates when online event fires and flushes queue', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(false)

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.isOnline).toBe(true)
    expect(syncQueue.flush).toHaveBeenCalled()
  })

  it('returns queue length', () => {
    vi.mocked(syncQueue.getQueueLength).mockReturnValue(3)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.queueLength).toBe(3)
  })

  it('returns offline bank size', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.offlineBankSize).toBe(100)
  })

  it('triggerSync flushes queue and updates state', async () => {
    vi.mocked(syncQueue.flush).mockResolvedValue({ success: 2, failed: 0 })
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await result.current.triggerSync()
    })

    expect(syncQueue.flush).toHaveBeenCalled()
    expect(result.current.lastSyncAt).not.toBeNull()
  })

  it('does not update lastSyncAt when no successful syncs', async () => {
    vi.mocked(syncQueue.flush).mockResolvedValue({ success: 0, failed: 1 })
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await result.current.triggerSync()
    })

    expect(result.current.lastSyncAt).toBeNull()
  })
})
