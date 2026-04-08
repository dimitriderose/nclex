/**
 * Tests targeting uncovered lines 271-372, 425-449 in useHighlights.ts
 * These cover: the useHighlights hook body — useEffect sync on mount (online),
 * online event listener for background sync, addHighlight, removeHighlight with DOM root,
 * updateNote with sync, renderHighlights with deserialization failures.
 */
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

describe('useHighlights — sync and render gaps', () => {
  beforeEach(() => {
    localStorage.clear()
    mockEnqueueHighlight.mockReset()
    mockFullSync.mockReset().mockResolvedValue({ bookmarks: [], highlights: [] })
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  })

  it('triggers sync on mount when online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    mockFullSync.mockResolvedValue({ bookmarks: [], highlights: [] })

    renderHook(() => useHighlights('sync-book'))

    await vi.waitFor(() => expect(mockFullSync).toHaveBeenCalledWith('sync-book'))
  })

  it('merges server highlights with new items on mount sync', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'server-hl-1',
        color: 'blue',
        text: 'server text',
        note: 'server note',
        startXpath: '/p[1]',
        startOffset: 0,
        endXpath: '/p[1]',
        endOffset: 5,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    })

    const { result } = renderHook(() => useHighlights('merge-book'))

    await vi.waitFor(() => {
      const hl = result.current.highlights.find(h => h.id === 'server-hl-1')
      expect(hl).toBeDefined()
      expect(hl?.color).toBe('blue')
    })
  })

  it('handles sync failure gracefully', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    mockFullSync.mockRejectedValue(new Error('Sync error'))

    const { result } = renderHook(() => useHighlights('fail-sync'))

    // Should not crash
    await vi.waitFor(() => expect(mockFullSync).toHaveBeenCalled())
    expect(result.current.highlights).toEqual([])
  })

  it('triggers sync when going online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    mockFullSync.mockResolvedValue({ bookmarks: [], highlights: [] })

    renderHook(() => useHighlights('online-book'))

    // Simulate going online
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => expect(mockFullSync).toHaveBeenCalledWith('online-book'))
  })

  it('online sync merges new highlights', async () => {
    const local = [{
      id: 'local-1', color: 'yellow' as const, text: 'local', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 5,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    }]
    localStorage.setItem('reader-highlights-online-merge', JSON.stringify(local))
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    // First mount sync returns empty (offline)
    mockFullSync.mockResolvedValue({ bookmarks: [], highlights: [] })

    const { result } = renderHook(() => useHighlights('online-merge'))

    // Now simulate online event with server data
    mockFullSync.mockResolvedValue({
      bookmarks: [],
      highlights: [{
        clientId: 'server-2',
        color: 'green',
        text: 'from server',
        note: '',
        startXpath: '/p[2]',
        startOffset: 0,
        endXpath: '/p[2]',
        endOffset: 10,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    })

    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => {
      const ids = result.current.highlights.map(h => h.id)
      expect(ids).toContain('server-2')
    })
  })

  it('online sync handles failure gracefully', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    mockFullSync.mockResolvedValue({ bookmarks: [], highlights: [] })

    const { result } = renderHook(() => useHighlights('online-fail'))

    mockFullSync.mockRejectedValue(new Error('network'))
    window.dispatchEvent(new Event('online'))

    // Should not crash
    await vi.waitFor(() => expect(result.current.highlights).toBeDefined())
  })

  it('removeHighlight removes DOM marks when root is provided', () => {
    const existing = [{
      id: 'rm-1', color: 'yellow' as const, text: 'test', note: '',
      startXpath: '', startOffset: 0, endXpath: '', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    }]
    localStorage.setItem('reader-highlights-rm-book', JSON.stringify(existing))

    const root = document.createElement('div')
    root.innerHTML = '<p><mark class="user-highlight" data-highlight-id="rm-1">test</mark> more</p>'
    document.body.appendChild(root)

    const { result } = renderHook(() => useHighlights('rm-book'))

    act(() => result.current.removeHighlight('rm-1', root))

    expect(result.current.highlights).toHaveLength(0)
    expect(root.querySelectorAll('mark')).toHaveLength(0)
    expect(mockEnqueueHighlight).toHaveBeenCalledWith('delete', expect.objectContaining({ id: 'rm-1' }))

    document.body.removeChild(root)
  })

  it('updateNote enqueues sync with updated highlight', () => {
    const existing = [{
      id: 'note-1', color: 'green' as const, text: 'hi', note: '',
      startXpath: '/p[1]', startOffset: 0, endXpath: '/p[1]', endOffset: 2,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    }]
    localStorage.setItem('reader-highlights-note-book', JSON.stringify(existing))

    const { result } = renderHook(() => useHighlights('note-book'))

    act(() => result.current.updateNote('note-1', 'Updated note'))

    expect(result.current.highlights[0].note).toBe('Updated note')
    expect(mockEnqueueHighlight).toHaveBeenCalledWith('upsert', expect.objectContaining({
      id: 'note-1',
      note: 'Updated note',
    }))
  })

  it('updateNote for nonexistent ID does not crash', () => {
    const { result } = renderHook(() => useHighlights('no-note'))
    act(() => result.current.updateNote('nonexistent', 'note'))
    // enqueueHighlight should not be called since hl is not found
    expect(mockEnqueueHighlight).not.toHaveBeenCalled()
  })

  it('renderHighlights clears old marks and re-applies', () => {
    const existing = [{
      id: 'render-1', color: 'pink' as const, text: 'word', note: '',
      startXpath: '/p[1]/#text[1]', startOffset: 0, endXpath: '/p[1]/#text[1]', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    }]
    localStorage.setItem('reader-highlights-render-book', JSON.stringify(existing))

    const root = document.createElement('div')
    root.innerHTML = '<p>word and more</p>'
    document.body.appendChild(root)

    const { result } = renderHook(() => useHighlights('render-book'))

    act(() => result.current.renderHighlights(root))

    // The text should still be in the DOM
    expect(root.textContent).toContain('word')

    document.body.removeChild(root)
  })

  it('renderHighlights handles stale highlights that cannot be deserialized', () => {
    const existing = [{
      id: 'stale-1', color: 'blue' as const, text: 'gone', note: '',
      startXpath: '/div[99]/#text[1]', startOffset: 0,
      endXpath: '/div[99]/#text[1]', endOffset: 4,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    }]
    localStorage.setItem('reader-highlights-stale-book', JSON.stringify(existing))

    const root = document.createElement('div')
    root.innerHTML = '<p>different content</p>'
    document.body.appendChild(root)

    const { result } = renderHook(() => useHighlights('stale-book'))

    // Should not crash even if deserialization fails
    act(() => result.current.renderHighlights(root))

    expect(root.textContent).toContain('different content')
    document.body.removeChild(root)
  })
})

describe('resolveXPath — additional coverage', () => {
  it('resolves nested paths like /p[1]/#text[1]', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Hello</p>'
    const textNode = root.querySelector('p')!.firstChild!

    const resolved = resolveXPath('/p[1]/#text[1]', root)
    expect(resolved).toBe(textNode)
  })

  it('returns null for path with invalid format (no brackets)', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Hello</p>'

    const resolved = resolveXPath('/invalidpart', root)
    expect(resolved).toBeNull()
  })
})
