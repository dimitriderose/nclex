import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/indexeddb-store', () => ({
  indexedDBStore: {
    get: vi.fn(),
    put: vi.fn(),
    getAllKeys: vi.fn(),
    search: vi.fn(),
  },
}))

vi.mock('../../services/localstorage-manager', () => ({
  localStorageManager: {
    get: vi.fn(),
    set: vi.fn(),
    getAllKeys: vi.fn(),
    search: vi.fn(),
  },
}))

vi.mock('../../services/content-api', () => ({
  contentApi: {
    getCachedContent: vi.fn(),
    setCachedContent: vi.fn(),
    searchContent: vi.fn(),
  },
}))

import { contentDB } from '../../services/contentdb'
import { indexedDBStore } from '../../services/indexeddb-store'
import { localStorageManager } from '../../services/localstorage-manager'
import { contentApi } from '../../services/content-api'

describe('contentDB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getLayer', () => {
    it('routes drugs to localStorage', () => {
      expect(contentDB.getLayer('drugs')).toBe('localStorage')
    })

    it('routes labs to localStorage', () => {
      expect(contentDB.getLayer('labs')).toBe('localStorage')
    })

    it('routes openrn to indexedDB', () => {
      expect(contentDB.getLayer('openrn')).toBe('indexedDB')
    })

    it('routes textbook to indexedDB', () => {
      expect(contentDB.getLayer('textbook')).toBe('indexedDB')
    })

    it('routes fda to api', () => {
      expect(contentDB.getLayer('fda')).toBe('api')
    })

    it('routes prefixed keys by prefix (drugs:metformin -> localStorage)', () => {
      expect(contentDB.getLayer('drugs:metformin')).toBe('localStorage')
    })

    it('routes unknown keys to api', () => {
      expect(contentDB.getLayer('unknown_key')).toBe('api')
    })
  })

  describe('get', () => {
    it('gets from localStorage for static module keys', async () => {
      const data = { name: 'test' }
      vi.mocked(localStorageManager.get).mockReturnValue(data)

      const result = await contentDB.get('drugs')
      expect(result).toEqual({ source: 'localStorage', key: 'drugs', data, cached: true })
      expect(localStorageManager.get).toHaveBeenCalledWith('drugs')
    })

    it('returns null from localStorage when not found', async () => {
      vi.mocked(localStorageManager.get).mockReturnValue(null)
      const result = await contentDB.get('drugs')
      expect(result).toBeNull()
    })

    it('gets from indexedDB for textbook keys', async () => {
      const data = { chapter: 1 }
      vi.mocked(indexedDBStore.get).mockResolvedValue(data)

      const result = await contentDB.get('openrn')
      expect(result).toEqual({ source: 'indexedDB', key: 'openrn', data, cached: true })
    })

    it('returns null from indexedDB when not found', async () => {
      vi.mocked(indexedDBStore.get).mockResolvedValue(null)
      const result = await contentDB.get('textbook')
      expect(result).toBeNull()
    })

    it('gets from API for api-layer keys', async () => {
      const data = { label: 'Metformin HCl' }
      vi.mocked(contentApi.getCachedContent).mockResolvedValue(data as any)

      const result = await contentDB.get('fda')
      expect(result).toEqual({ source: 'api', key: 'fda', data, cached: true })
    })

    it('returns null when API throws', async () => {
      vi.mocked(contentApi.getCachedContent).mockRejectedValue(new Error('offline'))
      const result = await contentDB.get('fda')
      expect(result).toBeNull()
    })
  })

  describe('set', () => {
    it('sets to localStorage for static module keys', async () => {
      const data = { name: 'test' }
      await contentDB.set('drugs', data)
      expect(localStorageManager.set).toHaveBeenCalledWith('drugs', data)
    })

    it('sets to indexedDB for textbook keys', async () => {
      const data = { chapter: 1 }
      vi.mocked(indexedDBStore.put).mockResolvedValue()
      await contentDB.set('openrn', data)
      expect(indexedDBStore.put).toHaveBeenCalledWith('openrn', data)
    })

    it('sets to API for api-layer keys', async () => {
      const data = { label: 'test' }
      vi.mocked(contentApi.setCachedContent).mockResolvedValue({} as any)
      await contentDB.set('fda', data)
      expect(contentApi.setCachedContent).toHaveBeenCalledWith({
        contentKey: 'fda',
        source: 'manual',
        data,
        ttlDays: 30,
      })
    })

    it('uses provided source for API layer', async () => {
      vi.mocked(contentApi.setCachedContent).mockResolvedValue({} as any)
      await contentDB.set('fda', {}, 'fda_api')
      expect(contentApi.setCachedContent).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'fda_api' })
      )
    })
  })

  describe('search', () => {
    it('searches across all layers by default', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([{ key: 'drugs', data: { x: 1 } }])
      vi.mocked(indexedDBStore.search).mockResolvedValue([{ key: 'openrn:ch1', data: { y: 2 } }])
      vi.mocked(contentApi.searchContent).mockResolvedValue([
        { contentKey: 'fda:med', data: { z: 3 } } as any,
      ])

      const results = await contentDB.search('test')
      expect(results).toHaveLength(3)
      expect(results[0].source).toBe('localStorage')
      expect(results[1].source).toBe('indexedDB')
      expect(results[2].source).toBe('api')
    })

    it('searches only specified layers', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([{ key: 'drugs', data: {} }])

      const results = await contentDB.search('test', ['localStorage'])
      expect(results).toHaveLength(1)
      expect(indexedDBStore.search).not.toHaveBeenCalled()
      expect(contentApi.searchContent).not.toHaveBeenCalled()
    })

    it('gracefully handles API search failure', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([])
      vi.mocked(indexedDBStore.search).mockResolvedValue([])
      vi.mocked(contentApi.searchContent).mockRejectedValue(new Error('offline'))

      const results = await contentDB.search('test')
      expect(results).toEqual([])
    })
  })

  describe('getKeys', () => {
    it('returns localStorage keys', async () => {
      vi.mocked(localStorageManager.getAllKeys).mockReturnValue(['drugs', 'labs'])
      const keys = await contentDB.getKeys('localStorage')
      expect(keys).toEqual(['drugs', 'labs'])
    })

    it('returns indexedDB keys', async () => {
      vi.mocked(indexedDBStore.getAllKeys).mockResolvedValue(['openrn:ch1'])
      const keys = await contentDB.getKeys('indexedDB')
      expect(keys).toEqual(['openrn:ch1'])
    })

    it('returns empty array for api layer', async () => {
      const keys = await contentDB.getKeys('api')
      expect(keys).toEqual([])
    })

    it('returns empty array for unknown layer', async () => {
      const keys = await contentDB.getKeys('unknown' as any)
      expect(keys).toEqual([])
    })
  })
})
