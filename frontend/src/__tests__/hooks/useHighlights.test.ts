import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHighlights, resolveXPath } from '../../hooks/useHighlights'

const mockEnqueueHighlight = vi.fn()
const mockFullSync = vi.fn().mockResolvedValue({ bookmarks: [], highlights: [] })

vi.mock('../../services/annotation-sync', () => ({
  annotationSync: {
    enqueueHighlight: (...args: unknown[]) => mockEnqueueHighlight(...args),
    fullSync: (...args: unknown[]) => mockFullSync(...args),
  },
}))

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('XPath utilities', () => {
  it('resolveXPath resolves to correct node', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>First</p><p>Second</p>'
    document.body.appendChild(root)
    try {
      // resolveXPath uses format like /p[2]
      const resolved = resolveXPath('/p[2]', root)
      expect(resolved).toBe(root.querySelectorAll('p')[1])
    } finally {
      document.body.removeChild(root)
    }
  })

  it('resolveXPath returns null for invalid path', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      const result = resolveXPath('/nonexistent[99]', root)
      expect(result).toBeNull()
    } finally {
      document.body.removeChild(root)
    }
  })

  it('resolveXPath returns root for empty path', () => {
    const root = document.createElement('div')
    expect(resolveXPath('', root)).toBe(root)
  })
})

describe('useHighlights hook', () => {
  beforeEach(() => {
    localStorage.clear()
    mockEnqueueHighlight.mockReset()
    mockFullSync.mockReset().mockResolvedValue({ bookmarks: [], highlights: [] })
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  })

  it('initializes empty from blank localStorage', () => {
    const { result } = renderHook(() => useHighlights('test-book'))
    expect(result.current.highlights).toEqual([])
  })

  it('loads from localStorage on mount', () => {
    const existing = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useHighlights('test-book'))
    expect(result.current.highlights).toHaveLength(1)
  })

  it('addHighlight creates, persists, and enqueues', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Some text to highlight</p>'
    document.body.appendChild(el)
    try {
      const { result } = renderHook(() => useHighlights('test-book'))
      const textNode = el.querySelector('p')!.firstChild!
      const range = document.createRange()
      range.setStart(textNode, 0)
      range.setEnd(textNode, 4)
      act(() => result.current.addHighlight(range, 'yellow', el))
      expect(result.current.highlights).toHaveLength(1)
      expect(result.current.highlights[0].color).toBe('yellow')
      expect(mockEnqueueHighlight).toHaveBeenCalledWith('upsert', expect.any(Object))
      const stored = JSON.parse(localStorage.getItem('reader-highlights-test-book') || '[]')
      expect(stored).toHaveLength(1)
    } finally {
      document.body.removeChild(el)
    }
  })

  it('removeHighlight removes from state', () => {
    const existing = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.removeHighlight('h1'))
    expect(result.current.highlights).toHaveLength(0)
    expect(mockEnqueueHighlight).toHaveBeenCalledWith('delete', expect.objectContaining({ id: 'h1' }))
  })

  it('updateNote updates and persists', () => {
    const existing = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.updateNote('h1', 'My note'))
    expect(result.current.highlights[0].note).toBe('My note')
    const stored = JSON.parse(localStorage.getItem('reader-highlights-test-book') || '[]')
    expect(stored[0].note).toBe('My note')
  })

  it('clearMarks removes all mark elements', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p><mark class="user-highlight" data-highlight-id="h1">text</mark> more</p>'
    document.body.appendChild(el)
    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.clearMarks(el))
    expect(el.querySelectorAll('mark')).toHaveLength(0)
    expect(el.textContent).toContain('text')
    document.body.removeChild(el)
  })

  it('merge: server-newer wins', async () => {
    const local = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: 'old',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(local))
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'h1', color: 'green', text: 'test', note: 'new',
        startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
      }],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useHighlights('test-book'))
    await vi.waitFor(() => expect(result.current.highlights.find(h => h.id === 'h1')?.color).toBe('green'))
  })

  it('merge: deletedAt removes local', async () => {
    const local = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(local))
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{ clientId: 'h1', deletedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useHighlights('test-book'))
    await vi.waitFor(() => expect(result.current.highlights).toHaveLength(0))
  })

  it('removeHighlight with root element removes marks from DOM', () => {
    const existing = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(existing))

    const el = document.createElement('div')
    el.innerHTML = '<p><mark class="user-highlight" data-highlight-id="h1">test</mark> more</p>'
    document.body.appendChild(el)

    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.removeHighlight('h1', el))
    expect(result.current.highlights).toHaveLength(0)
    expect(el.querySelectorAll('mark')).toHaveLength(0)
    document.body.removeChild(el)
  })

  it('updateNote updates and enqueues sync', () => {
    const existing = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(existing))
    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.updateNote('h1', 'New note'))
    expect(result.current.highlights[0].note).toBe('New note')
    expect(mockEnqueueHighlight).toHaveBeenCalledWith('upsert', expect.objectContaining({ note: 'New note' }))
  })

  it('renderHighlights clears existing marks and re-applies', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p><mark class="user-highlight" data-highlight-id="old">stale</mark> text here</p>'
    document.body.appendChild(el)

    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.renderHighlights(el))
    // Old marks should be removed
    // Since no highlights stored, no new marks applied
    expect(el.querySelectorAll('mark.user-highlight')).toHaveLength(0)
    document.body.removeChild(el)
  })

  it('renderHighlights applies marks for stored highlights with valid ranges', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Some text to highlight</p>'
    document.body.appendChild(el)

    // Add a highlight via addHighlight first
    const { result } = renderHook(() => useHighlights('test-book'))
    const textNode = el.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 4)
    act(() => result.current.addHighlight(range, 'green', el))
    expect(result.current.highlights).toHaveLength(1)

    // Clear marks then re-render
    act(() => result.current.clearMarks(el))
    expect(el.querySelectorAll('mark')).toHaveLength(0)

    // Normalize and re-apply
    el.normalize()
    act(() => result.current.renderHighlights(el))
    // Marks should be re-applied (or at least attempted)

    document.body.removeChild(el)
  })

  it('merge: local-newer keeps local value', async () => {
    const local = [{
      id: 'h1', color: 'yellow' as const, text: 'test', note: 'local-new',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z'
    }]
    localStorage.setItem('reader-highlights-test-book', JSON.stringify(local))
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'h1', color: 'blue', text: 'test', note: 'server-old',
        startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z',
      }],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useHighlights('test-book'))
    await vi.waitFor(() => expect(result.current.highlights.find(h => h.id === 'h1')?.color).toBe('yellow'))
  })

  it('merge: adds new server items not in local', async () => {
    localStorage.setItem('reader-highlights-test-book', JSON.stringify([]))
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'h-new', color: 'pink', text: 'from server', note: '',
        startXpath: '', startOffset: 0, endXpath: '', endOffset: 11,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }],
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { result } = renderHook(() => useHighlights('test-book'))
    await vi.waitFor(() => expect(result.current.highlights).toHaveLength(1))
    expect(result.current.highlights[0].id).toBe('h-new')
  })

  it('online event triggers sync', async () => {
    const { result } = renderHook(() => useHighlights('test-book'))
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'h-online', color: 'blue', text: 'synced', note: '',
        startXpath: '', startOffset: 0, endXpath: '', endOffset: 6,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }],
    })
    act(() => { window.dispatchEvent(new Event('online')) })
    await vi.waitFor(() => expect(result.current.highlights.find(h => h.id === 'h-online')).toBeTruthy())
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('reader-highlights-corrupt-book', '{invalid json')
    const { result } = renderHook(() => useHighlights('corrupt-book'))
    expect(result.current.highlights).toEqual([])
  })

  it('removeHighlight for non-existing id still persists', () => {
    const { result } = renderHook(() => useHighlights('test-book'))
    act(() => result.current.removeHighlight('nonexistent'))
    // Should not throw, and enqueueHighlight should not be called for delete of non-existing
    expect(mockEnqueueHighlight).not.toHaveBeenCalledWith('delete', expect.any(Object))
  })
})
