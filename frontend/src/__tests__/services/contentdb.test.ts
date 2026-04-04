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
    search: vi.fn(),
    getAllKeys: vi.fn(),
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

    it('routes formulas to localStorage', () => {
      expect(contentDB.getLayer('formulas')).toBe('localStorage')
    })

    it('routes strategies to localStorage', () => {
      expect(contentDB.getLayer('strategies')).toBe('localStorage')
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

    it('routes medlineplus to api', () => {
      expect(contentDB.getLayer('medlineplus')).toBe('api')
    })

    it('routes prefix match (drugs:metformin) to localStorage', () => {
      expect(contentDB.getLayer('drugs:metformin')).toBe('localStorage')
    })

    it('routes unknown keys to api by default', () => {
      expect(contentDB.getLayer('unknown_key')).toBe('api')
    })
  })

  describe('get', () => {
    it('gets from localStorage for static modules', async () => {
      vi.mocked(localStorageManager.get).mockReturnValue({ name: 'test' })
      const result = await contentDB.get('drugs')
      expect(result).toEqual({
        source: 'localStorage',
        key: 'drugs',
        data: { name: 'test' },
        cached: true,
      })
    })

    it('returns null when localStorage has no data', async () => {
      vi.mocked(localStorageManager.get).mockReturnValue(null)
      const result = await contentDB.get('drugs')
      expect(result).toBeNull()
    })

    it('gets from indexedDB for textbook content', async () => {
      vi.mocked(indexedDBStore.get).mockResolvedValue({ chapter: 1 })
      const result = await contentDB.get('openrn')
      expect(result).toEqual({
        source: 'indexedDB',
        key: 'openrn',
        data: { chapter: 1 },
        cached: true,
      })
    })

    it('returns null when indexedDB has no data', async () => {
      vi.mocked(indexedDBStore.get).mockResolvedValue(null)
      const result = await contentDB.get('textbook')
      expect(result).toBeNull()
    })

    it('gets from API for fda content', async () => {
      vi.mocked(contentApi.getCachedContent).mockResolvedValue({ label: 'test' } as any)
      const result = await contentDB.get('fda')
      expect(result).toEqual({
        source: 'api',
        key: 'fda',
        data: { label: 'test' },
        cached: true,
      })
    })

    it('returns null when API call fails', async () => {
      vi.mocked(contentApi.getCachedContent).mockRejectedValue(new Error('Network error'))
      const result = await contentDB.get('fda')
      expect(result).toBeNull()
    })
  })

  describe('set', () => {
    it('sets to localStorage for static modules', async () => {
      await contentDB.set('drugs', { name: 'metformin' })
      expect(localStorageManager.set).toHaveBeenCalledWith('drugs', { name: 'metformin' })
    })

    it('sets to indexedDB for textbook content', async () => {
      vi.mocked(indexedDBStore.put).mockResolvedValue()
      await contentDB.set('openrn', { chapter: 1 })
      expect(indexedDBStore.put).toHaveBeenCalledWith('openrn', { chapter: 1 })
    })

    it('sets to API for fda content', async () => {
      vi.mocked(contentApi.setCachedContent).mockResolvedValue(undefined as any)
      await contentDB.set('fda', { label: 'aspirin' }, 'fda_source')
      expect(contentApi.setCachedContent).toHaveBeenCalledWith({
        contentKey: 'fda',
        source: 'fda_source',
        data: { label: 'aspirin' },
        ttlDays: 30,
      })
    })

    it('uses "manual" as default source for API sets', async () => {
      vi.mocked(contentApi.setCachedContent).mockResolvedValue(undefined as any)
      await contentDB.set('fda', { label: 'test' })
      expect(contentApi.setCachedContent).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'manual' })
      )
    })
  })

  describe('search', () => {
    it('searches all layers by default', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([
        { key: 'drugs', data: { name: 'aspirin' } },
      ])
      vi.mocked(indexedDBStore.search).mockResolvedValue([
        { key: 'openrn:ch1', data: { title: 'Chapter 1' } },
      ])
      vi.mocked(contentApi.searchContent).mockResolvedValue([
        { contentKey: 'fda:aspirin', data: { label: 'Aspirin' } } as any,
      ])

      const results = await contentDB.search('aspirin')
      expect(results).toHaveLength(3)
      expect(results[0].source).toBe('localStorage')
      expect(results[1].source).toBe('indexedDB')
      expect(results[2].source).toBe('api')
    })

    it('searches only specified layers', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([])
      const results = await contentDB.search('test', ['localStorage'])
      expect(localStorageManager.search).toHaveBeenCalled()
      expect(indexedDBStore.search).not.toHaveBeenCalled()
      expect(contentApi.searchContent).not.toHaveBeenCalled()
      expect(results).toEqual([])
    })

    it('searches only indexedDB layer when specified', async () => {
      vi.mocked(indexedDBStore.search).mockResolvedValue([])
      const results = await contentDB.search('test', ['indexedDB'])
      expect(indexedDBStore.search).toHaveBeenCalledWith('test')
      expect(localStorageManager.search).not.toHaveBeenCalled()
      expect(results).toEqual([])
    })

    it('handles API search failure gracefully', async () => {
      vi.mocked(localStorageManager.search).mockReturnValue([])
      vi.mocked(indexedDBStore.search).mockResolvedValue([])
      vi.mocked(contentApi.searchContent).mockRejectedValue(new Error('offline'))

      const results = await contentDB.search('test')
      expect(results).toEqual([])
    })
  })

  describe('getKeys', () => {
    it('gets keys from localStorage', async () => {
      vi.mocked(localStorageManager.getAllKeys).mockReturnValue(['drugs', 'labs'])
      const keys = await contentDB.getKeys('localStorage')
      expect(keys).toEqual(['drugs', 'labs'])
    })

    it('gets keys from indexedDB', async () => {
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
