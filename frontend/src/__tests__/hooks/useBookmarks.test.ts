import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBookmarks } from '../../hooks/useBookmarks'

const mockEnqueueBookmark = vi.fn()
const mockFullSync = vi.fn().mockResolvedValue({ bookmarks: [], highlights: [] })

vi.mock('../../services/annotation-sync', () => ({
  annotationSync: {
    enqueueBookmark: (...args: unknown[]) => mockEnqueueBookmark(...args),
    fullSync: (...args: unknown[]) => mockFullSync(...args),
  },
}))

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('useBookmarks', () => {
  beforeEach(() => {
    localStorage.clear()
    mockEnqueueBookmark.mockReset()
    mockFullSync.mockReset().mockResolvedValue({ bookmarks: [], highlights: [] })
  })

  it('initializes empty when no localStorage', () => {
    const { result } = renderHook(() => useBookmarks('test-book'))
    expect(result.current.bookmarks).toEqual([])
  })

  it('loads from localStorage on mount', () => {
    const existing = [{ clientId: 'b1', page: 3, label: 'Page 3', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }]
    localStorage.setItem('reader-bookmarks-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useBookmarks('test-book'))
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].page).toBe(3)
  })

  it('toggleBookmark adds bookmark and persists', () => {
    const { result } = renderHook(() => useBookmarks('test-book'))
    act(() => result.current.toggleBookmark(5, 'Ch5'))
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].page).toBe(5)
    const stored = JSON.parse(localStorage.getItem('reader-bookmarks-test-book') || '[]')
    expect(stored).toHaveLength(1)
  })

  it('toggleBookmark removes existing bookmark', () => {
    const existing = [{ clientId: 'b1', page: 5, label: 'Page 5', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }]
    localStorage.setItem('reader-bookmarks-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useBookmarks('test-book'))
    act(() => result.current.toggleBookmark(5))
    expect(result.current.bookmarks).toHaveLength(0)
  })

  it('isBookmarked returns true/false correctly', () => {
    const { result } = renderHook(() => useBookmarks('test-book'))
    expect(result.current.isBookmarked(5)).toBe(false)
    act(() => result.current.toggleBookmark(5))
    expect(result.current.isBookmarked(5)).toBe(true)
  })

  it('removeBookmark removes by page', () => {
    const { result } = renderHook(() => useBookmarks('test-book'))
    act(() => result.current.toggleBookmark(5))
    act(() => result.current.toggleBookmark(10))
    expect(result.current.bookmarks).toHaveLength(2)
    act(() => result.current.removeBookmark(5))
    expect(result.current.bookmarks).toHaveLength(1)
    expect(result.current.bookmarks[0].page).toBe(10)
  })

  it('enqueues upsert to annotationSync on add', () => {
    const { result } = renderHook(() => useBookmarks('test-book'))
    act(() => result.current.toggleBookmark(7, 'My Bookmark'))
    expect(mockEnqueueBookmark).toHaveBeenCalledWith(
      'upsert',
      expect.objectContaining({ contentKey: 'test-book', page: 7 })
    )
  })

  it('enqueues delete to annotationSync on remove', () => {
    const existing = [{ clientId: 'b1', page: 5, label: 'Page 5', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }]
    localStorage.setItem('reader-bookmarks-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useBookmarks('test-book'))
    act(() => result.current.toggleBookmark(5))
    expect(mockEnqueueBookmark).toHaveBeenCalledWith(
      'delete',
      expect.objectContaining({ clientId: 'b1', page: 5 })
    )
  })

  it('triggers fullSync on mount when online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    renderHook(() => useBookmarks('test-book'))
    // Wait for effect to fire
    await vi.waitFor(() => expect(mockFullSync).toHaveBeenCalled())
  })

  it('does not trigger fullSync when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    renderHook(() => useBookmarks('test-book'))
    expect(mockFullSync).not.toHaveBeenCalled()
  })

  it('merge: server-newer overwrites local', async () => {
    const localBookmark = { clientId: 'b1', page: 5, label: 'old', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }
    localStorage.setItem('reader-bookmarks-test-book', JSON.stringify([localBookmark]))
    mockFullSync.mockResolvedValue({
      bookmarks: [{ clientId: 'b1', contentKey: 'test-book', page: 5, label: 'new', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
      highlights: [],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useBookmarks('test-book'))
    await vi.waitFor(() => expect(result.current.bookmarks.find(b => b.clientId === 'b1')?.label).toBe('new'))
  })

  it('merge: server deletedAt removes local item', async () => {
    const localBookmark = { clientId: 'b1', page: 5, label: 'Page 5', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }
    localStorage.setItem('reader-bookmarks-test-book', JSON.stringify([localBookmark]))
    mockFullSync.mockResolvedValue({
      bookmarks: [{ clientId: 'b1', deletedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
      highlights: [],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useBookmarks('test-book'))
    await vi.waitFor(() => expect(result.current.bookmarks).toHaveLength(0))
  })
})
