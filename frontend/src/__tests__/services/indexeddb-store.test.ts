import { describe, it, expect, vi, beforeEach } from 'vitest'

// Build a fake IndexedDB that works with the store's Promise-based wrappers
let storeData: Map<string, any>

function createFakeRequest(result: any) {
  const req: any = { result, error: null, onsuccess: null, onerror: null }
  queueMicrotask(() => { if (req.onsuccess) req.onsuccess() })
  return req
}

function createFakeStore() {
  return {
    get: vi.fn((key: string) => createFakeRequest(storeData.get(key))),
    put: vi.fn((entry: any) => { storeData.set(entry.key ?? entry, entry); return createFakeRequest(undefined) }),
    delete: vi.fn((key: string) => { storeData.delete(key); return createFakeRequest(undefined) }),
    getAllKeys: vi.fn(() => createFakeRequest([...storeData.keys()])),
    getAll: vi.fn(() => createFakeRequest([...storeData.values()])),
    count: vi.fn(() => createFakeRequest(storeData.size)),
    clear: vi.fn(() => { storeData.clear(); return createFakeRequest(undefined) }),
    createIndex: vi.fn(),
    index: vi.fn(() => ({
      getAll: vi.fn((source: string) =>
        createFakeRequest([...storeData.values()].filter((e) => e.source === source))
      ),
    })),
  }
}

let fakeStore: ReturnType<typeof createFakeStore>

const fakeObjectStoreNames = { contains: vi.fn().mockReturnValue(false) }

function makeFakeDB() {
  return {
    transaction: vi.fn(() => {
      const tx: any = {
        objectStore: vi.fn(() => fakeStore),
        oncomplete: null,
        onerror: null,
        error: null,
      }
      queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete() })
      return tx
    }),
    objectStoreNames: fakeObjectStoreNames,
    createObjectStore: vi.fn(() => fakeStore),
  }
}

let fakeDB: ReturnType<typeof makeFakeDB>

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    const req: any = { result: fakeDB, error: null, onupgradeneeded: null, onsuccess: null, onerror: null }
    queueMicrotask(() => {
      if (req.onupgradeneeded) req.onupgradeneeded()
      if (req.onsuccess) req.onsuccess()
    })
    return req
  }),
})

import { indexedDBStore } from '../../services/indexeddb-store'

describe('indexedDBStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeData = new Map()
    fakeStore = createFakeStore()
    fakeDB = makeFakeDB()
    fakeObjectStoreNames.contains.mockReturnValue(false)
  })

  describe('get', () => {
    it('returns data for existing key', async () => {
      storeData.set('openrn:ch1', { key: 'openrn:ch1', data: { title: 'Chapter 1' } })
      const result = await indexedDBStore.get('openrn:ch1')
      expect(result).toEqual({ title: 'Chapter 1' })
    })

    it('returns null for missing key', async () => {
      const result = await indexedDBStore.get('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      const origOpen = (globalThis as any).indexedDB.open
      ;(globalThis as any).indexedDB.open = vi.fn(() => {
        const req: any = { result: null, error: new Error('DB error'), onsuccess: null, onerror: null }
        queueMicrotask(() => { if (req.onerror) req.onerror() })
        return req
      })

      const result = await indexedDBStore.get('test')
      expect(result).toBeNull()
      ;(globalThis as any).indexedDB.open = origOpen
    })
  })

  describe('put', () => {
    it('stores data with correct entry structure', async () => {
      await indexedDBStore.put('openrn:ch1', {
        title: 'Chapter 1',
        chapter: 3,
        section: 'A',
        content: 'Some text',
      })
      expect(fakeStore.put).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'openrn:ch1',
          source: 'openrn',
          title: 'Chapter 1',
          chapter: 3,
          section: 'A',
          content: 'Some text',
        })
      )
    })

    it('uses defaults when data fields are missing', async () => {
      await indexedDBStore.put('openrn:ch2', {})
      expect(fakeStore.put).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'openrn:ch2',
          chapter: 0,
          content: '',
        })
      )
    })
  })

  describe('delete', () => {
    it('calls store.delete with key', async () => {
      await indexedDBStore.delete('test-key')
      expect(fakeStore.delete).toHaveBeenCalledWith('test-key')
    })
  })

  describe('getAllKeys', () => {
    it('returns all stored keys', async () => {
      storeData.set('key1', { key: 'key1' })
      storeData.set('key2', { key: 'key2' })
      const keys = await indexedDBStore.getAllKeys()
      expect(keys).toEqual(['key1', 'key2'])
    })
  })

  describe('getBySource', () => {
    it('queries the source index', async () => {
      storeData.set('openrn:ch1', { key: 'openrn:ch1', source: 'openrn' })
      const result = await indexedDBStore.getBySource('openrn')
      expect(fakeStore.index).toHaveBeenCalledWith('source')
      expect(result).toEqual([expect.objectContaining({ source: 'openrn' })])
    })
  })

  describe('search', () => {
    it('matches on title', async () => {
      storeData.set('ch1', {
        key: 'ch1', title: 'Cardiovascular', content: '', data: { t: 1 },
      })
      storeData.set('ch2', {
        key: 'ch2', title: 'Neurological', content: '', data: { t: 2 },
      })
      const results = await indexedDBStore.search('cardio')
      expect(results).toHaveLength(1)
      expect(results[0].key).toBe('ch1')
    })

    it('matches on content', async () => {
      storeData.set('ch1', {
        key: 'ch1', title: 'Title', content: 'pharmacology basics', data: {},
      })
      const results = await indexedDBStore.search('pharmacology')
      expect(results).toHaveLength(1)
    })

    it('matches on key', async () => {
      storeData.set('openrn:pharm', {
        key: 'openrn:pharm', title: 'T', content: 'C', data: {},
      })
      const results = await indexedDBStore.search('openrn:pharm')
      expect(results).toHaveLength(1)
    })

    it('returns empty array when no matches', async () => {
      storeData.set('ch1', { key: 'ch1', title: 'T', content: 'C', data: {} })
      const results = await indexedDBStore.search('zzzznotfound')
      expect(results).toEqual([])
    })
  })

  describe('count', () => {
    it('returns the number of entries', async () => {
      storeData.set('a', {})
      storeData.set('b', {})
      const count = await indexedDBStore.count()
      expect(count).toBe(2)
    })
  })

  describe('clear', () => {
    it('clears all entries', async () => {
      storeData.set('a', {})
      await indexedDBStore.clear()
      expect(fakeStore.clear).toHaveBeenCalled()
    })
  })

  describe('bulkPut', () => {
    it('stores multiple entries via transaction', async () => {
      const entries = [
        { key: 'openrn:ch1', data: { title: 'Ch 1', chapter: 1, content: 'text1' } },
        { key: 'openrn:ch2', data: { title: 'Ch 2', chapter: 2, content: 'text2' } },
      ]
      await indexedDBStore.bulkPut(entries)
      expect(fakeStore.put).toHaveBeenCalledTimes(2)
    })
  })
})
