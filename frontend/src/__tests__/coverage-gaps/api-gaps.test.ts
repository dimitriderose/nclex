/**
 * Tests targeting uncovered lines 245-251, 255-257 in api.ts
 * These cover: syncHighlights and getAnnotationChanges API methods.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from '../../test/mocks/server'
import { api } from '../../services/api'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('api — syncHighlights and getAnnotationChanges', () => {
  it('syncHighlights calls POST /api/annotations/highlights/sync', async () => {
    const result = await api.syncHighlights([
      {
        clientId: 'hl-1',
        contentKey: 'book1',
        color: 'yellow',
        text: 'highlighted text',
        note: '',
        startXpath: '/p[1]',
        startOffset: 0,
        endXpath: '/p[1]',
        endOffset: 10,
        action: 'upsert',
      },
    ])
    expect(result).toHaveProperty('highlights')
    expect(result).toHaveProperty('serverTime')
  })

  it('syncHighlights with empty array', async () => {
    const result = await api.syncHighlights([])
    expect(result).toHaveProperty('highlights')
    expect(result).toHaveProperty('serverTime')
  })

  it('getAnnotationChanges calls GET /api/annotations/changes', async () => {
    const result = await api.getAnnotationChanges('2025-01-01T00:00:00Z')
    expect(result).toHaveProperty('bookmarks')
    expect(result).toHaveProperty('highlights')
    expect(result).toHaveProperty('serverTime')
  })

  it('getAnnotationChanges encodes since parameter', async () => {
    const result = await api.getAnnotationChanges('2026-04-01T12:00:00+05:00')
    expect(result).toHaveProperty('bookmarks')
  })

  // Also cover getBookmarks with and without contentKey
  it('getBookmarks without contentKey', async () => {
    const result = await api.getBookmarks()
    expect(Array.isArray(result)).toBe(true)
  })

  it('getBookmarks with contentKey', async () => {
    const result = await api.getBookmarks('test-book')
    expect(Array.isArray(result)).toBe(true)
  })

  it('getHighlights without contentKey', async () => {
    const result = await api.getHighlights()
    expect(Array.isArray(result)).toBe(true)
  })

  it('getHighlights with contentKey', async () => {
    const result = await api.getHighlights('test-book')
    expect(Array.isArray(result)).toBe(true)
  })

  it('syncBookmarks calls POST /api/annotations/bookmarks/sync', async () => {
    const result = await api.syncBookmarks([
      {
        clientId: 'bm-1',
        contentKey: 'book1',
        page: 5,
        label: 'Page 5',
        action: 'upsert',
      },
    ])
    expect(result).toHaveProperty('bookmarks')
    expect(result).toHaveProperty('serverTime')
  })
})
