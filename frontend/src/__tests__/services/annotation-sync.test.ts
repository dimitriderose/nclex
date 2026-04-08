import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSyncBookmarks = vi.fn().mockResolvedValue({ bookmarks: [], serverTime: new Date().toISOString() })
const mockSyncHighlights = vi.fn().mockResolvedValue({ highlights: [], serverTime: new Date().toISOString() })
const mockGetBookmarks = vi.fn().mockResolvedValue([])
const mockGetHighlights = vi.fn().mockResolvedValue([])
const mockGetAnnotationChanges = vi.fn().mockResolvedValue({ bookmarks: [], highlights: [], serverTime: new Date().toISOString() })

vi.mock('../../services/api', () => ({
  api: {
    syncBookmarks: (...args: unknown[]) => mockSyncBookmarks(...args),
    syncHighlights: (...args: unknown[]) => mockSyncHighlights(...args),
    getBookmarks: (...args: unknown[]) => mockGetBookmarks(...args),
    getHighlights: (...args: unknown[]) => mockGetHighlights(...args),
    getAnnotationChanges: (...args: unknown[]) => mockGetAnnotationChanges(...args),
  },
}))

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { annotationSync } from '../../services/annotation-sync'

describe('annotationSync', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('enqueueBookmark', () => {
    it('writes to localStorage queue', () => {
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 5 })
      const queue = JSON.parse(localStorage.getItem('nclex:bookmark_queue') || '[]')
      expect(queue).toHaveLength(1)
      expect(queue[0].clientId).toBe('b1')
      expect(queue[0].action).toBe('upsert')
    })

    it('coalesces duplicate clientId', () => {
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 5 })
      annotationSync.enqueueBookmark('delete', { clientId: 'b1', contentKey: 'book1', page: 5 })
      const queue = JSON.parse(localStorage.getItem('nclex:bookmark_queue') || '[]')
      expect(queue).toHaveLength(1)
      expect(queue[0].action).toBe('delete')
    })
  })

  describe('enqueueHighlight', () => {
    it('writes to queue', () => {
      annotationSync.enqueueHighlight('upsert', { id: 'h1', contentKey: 'book1', color: '#ffeb3b' })
      const queue = JSON.parse(localStorage.getItem('nclex:highlight_queue') || '[]')
      expect(queue).toHaveLength(1)
      expect(queue[0].clientId).toBe('h1')
    })

    it('coalesces duplicate', () => {
      annotationSync.enqueueHighlight('upsert', { id: 'h1', contentKey: 'book1', color: '#ffeb3b' })
      annotationSync.enqueueHighlight('upsert', { id: 'h1', contentKey: 'book1', color: '#4caf50' })
      const queue = JSON.parse(localStorage.getItem('nclex:highlight_queue') || '[]')
      expect(queue).toHaveLength(1)
      expect(queue[0].data.color).toBe('#4caf50')
    })
  })

  describe('pushChanges', () => {
    it('calls api.syncBookmarks', async () => {
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 1 })
      await annotationSync.pushChanges()
      expect(mockSyncBookmarks).toHaveBeenCalled()
    })

    it('clears queue on success', async () => {
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 1 })
      await annotationSync.pushChanges()
      const queue = JSON.parse(localStorage.getItem('nclex:bookmark_queue') || '[]')
      expect(queue).toHaveLength(0)
    })

    it('calls api.syncHighlights', async () => {
      annotationSync.enqueueHighlight('upsert', { id: 'h1', contentKey: 'book1', color: '#ffeb3b' })
      await annotationSync.pushChanges()
      expect(mockSyncHighlights).toHaveBeenCalled()
    })

    it('increments retries on failure', async () => {
      mockSyncBookmarks.mockRejectedValueOnce(new Error('network'))
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 1 })
      await annotationSync.pushChanges()
      const queue = JSON.parse(localStorage.getItem('nclex:bookmark_queue') || '[]')
      expect(queue[0].retries).toBe(1)
    })

    it('drops entries after 5 retries', async () => {
      // Manually set up a queue entry with 5 retries
      const entry = { clientId: 'b1', action: 'upsert', contentKey: 'book1', data: { page: 1 }, retries: 5, timestamp: new Date().toISOString() }
      localStorage.setItem('nclex:bookmark_queue', JSON.stringify([entry]))
      mockSyncBookmarks.mockRejectedValueOnce(new Error('network'))
      await annotationSync.pushChanges()
      const queue = JSON.parse(localStorage.getItem('nclex:bookmark_queue') || '[]')
      expect(queue).toHaveLength(0)
    })

    it('chunks >500 items into batches', async () => {
      const entries = Array.from({ length: 502 }, (_, i) => ({
        clientId: `b${i}`,
        action: 'upsert',
        contentKey: 'book1',
        data: { page: i },
        retries: 0,
        timestamp: new Date().toISOString(),
      }))
      localStorage.setItem('nclex:bookmark_queue', JSON.stringify(entries))
      await annotationSync.pushChanges()
      expect(mockSyncBookmarks).toHaveBeenCalledTimes(2)
    })

    it('no-op when queues empty', async () => {
      await annotationSync.pushChanges()
      expect(mockSyncBookmarks).not.toHaveBeenCalled()
      expect(mockSyncHighlights).not.toHaveBeenCalled()
    })
  })

  describe('pullChanges', () => {
    it('calls getAnnotationChanges when lastSync exists', async () => {
      localStorage.setItem('nclex:last_annotation_sync', '2025-01-01T00:00:00Z')
      await annotationSync.pullChanges()
      expect(mockGetAnnotationChanges).toHaveBeenCalledWith('2025-01-01T00:00:00Z')
    })

    it('calls getBookmarks + getHighlights on first sync', async () => {
      await annotationSync.pullChanges()
      expect(mockGetBookmarks).toHaveBeenCalled()
      expect(mockGetHighlights).toHaveBeenCalled()
    })

    it('updates lastSync on success', async () => {
      await annotationSync.pullChanges()
      expect(localStorage.getItem('nclex:last_annotation_sync')).toBeTruthy()
    })
  })

  describe('fullSync', () => {
    it('pushes then pulls', async () => {
      annotationSync.enqueueBookmark('upsert', { clientId: 'b1', contentKey: 'book1', page: 1 })
      const result = await annotationSync.fullSync()
      expect(mockSyncBookmarks).toHaveBeenCalled()
      expect(result).toHaveProperty('bookmarks')
      expect(result).toHaveProperty('highlights')
    })

    it('deduplicates concurrent calls (second call returns same result)', async () => {
      // Make pushChanges slow to ensure both calls overlap
      mockSyncBookmarks.mockImplementation(() => new Promise((r) => setTimeout(() => r({ serverTime: new Date().toISOString() }), 50)))
      annotationSync.enqueueBookmark('upsert', { clientId: 'b2', contentKey: 'book1', page: 2 })
      const p1 = annotationSync.fullSync()
      const p2 = annotationSync.fullSync()
      // Both should resolve to the same result
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual(r2)
    })
  })
})
