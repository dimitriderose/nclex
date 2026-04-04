import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { contentApi } from '../../services/content-api'

function mockOkResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function mockErrorResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error('not json')),
  }
}

describe('content-api', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  // ---- authedFetch error handling ----
  describe('authedFetch error handling', () => {
    it('throws error with message from response body', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, { message: 'Bad key' }))
      await expect(contentApi.getCachedContent('k')).rejects.toThrow('Bad key')
    })

    it('throws fallback with status when JSON parse fails', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500))
      await expect(contentApi.getCachedContent('k')).rejects.toThrow('Request failed')
    })

    it('throws fallback with status when body has no message', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(422, {}))
      await expect(contentApi.getCachedContent('k')).rejects.toThrow('Request failed: 422')
    })
  })

  // ---- getCachedContent ----
  describe('getCachedContent', () => {
    it('fetches content by encoded key', async () => {
      const data = { id: '1', contentKey: 'drug/aspirin', source: 'fda' }
      mockFetch.mockResolvedValue(mockOkResponse(data))
      const result = await contentApi.getCachedContent('drug/aspirin')
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/content/drug%2Faspirin',
        expect.objectContaining({ credentials: 'include' })
      )
    })

    it('throws on error response', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, { message: 'Not found' }))
      await expect(contentApi.getCachedContent('missing')).rejects.toThrow('Not found')
    })
  })

  // ---- setCachedContent ----
  describe('setCachedContent', () => {
    it('sends PUT with content data', async () => {
      const input = { contentKey: 'drug/x', source: 'fda', data: { name: 'X' }, ttlDays: 30 }
      const response = { id: '1', ...input }
      mockFetch.mockResolvedValue(mockOkResponse(response))
      const result = await contentApi.setCachedContent(input)
      expect(result).toEqual(response)
      expect(mockFetch).toHaveBeenCalledWith('/api/content', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(input),
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, { message: 'DB error' }))
      await expect(contentApi.setCachedContent({ contentKey: 'k', source: 's', data: {} })).rejects.toThrow('DB error')
    })
  })

  // ---- searchContent ----
  describe('searchContent', () => {
    it('searches with encoded query', async () => {
      const results = [{ id: '1', contentKey: 'drug/aspirin' }]
      mockFetch.mockResolvedValue(mockOkResponse(results))
      const result = await contentApi.searchContent('aspirin & ibuprofen')
      expect(result).toEqual(results)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/content/search?q=aspirin%20%26%20ibuprofen',
        expect.objectContaining({ credentials: 'include' })
      )
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, { message: 'Bad query' }))
      await expect(contentApi.searchContent('')).rejects.toThrow('Bad query')
    })
  })

  // ---- bulkGetContent ----
  describe('bulkGetContent', () => {
    it('sends POST with keys array', async () => {
      const results = [{ id: '1' }, { id: '2' }]
      mockFetch.mockResolvedValue(mockOkResponse(results))
      const result = await contentApi.bulkGetContent(['k1', 'k2'])
      expect(result).toEqual(results)
      expect(mockFetch).toHaveBeenCalledWith('/api/content/bulk', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ keys: ['k1', 'k2'] }),
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500))
      await expect(contentApi.bulkGetContent(['k1'])).rejects.toThrow('Request failed')
    })
  })

  // ---- deleteExpiredContent ----
  describe('deleteExpiredContent', () => {
    it('sends DELETE and returns count', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ deleted: 5 }))
      const result = await contentApi.deleteExpiredContent()
      expect(result).toEqual({ deleted: 5 })
      expect(mockFetch).toHaveBeenCalledWith('/api/content/expired', expect.objectContaining({
        method: 'DELETE',
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(403, { message: 'Forbidden' }))
      await expect(contentApi.deleteExpiredContent()).rejects.toThrow('Forbidden')
    })
  })
})
