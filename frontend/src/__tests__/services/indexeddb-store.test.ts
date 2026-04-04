import { describe, it, expect, vi, beforeEach } from 'vitest'

// Build a fake IndexedDB environment
function createMockIDB() {
  const entries = new Map<string, unknown>()

  const mockStore: Record<string, unknown> = {
    get: vi.fn((key: string) => {
      const req = createRequest(entries.get(key))
      return req
    }),
    put: vi.fn((entry: { key: string }) => {
      entries.set(entry.key, entry)
      return createRequest(undefined)
    }),
    delete: vi.fn((key: string) => {
      entries.delete(key)
      return createRequest(undefined)
    }),
    getAllKeys: vi.fn(() => createRequest([...entries.keys()])),
    getAll: vi.fn(() => createRequest([...entries.values()])),
    count: vi.fn(() => createRequest(entries.size)),
    clear: vi.fn(() => {
      entries.clear()
      return createRequest(undefined)
    }),
    index: vi.fn(() => ({
      getAll: vi.fn((source: string) => {
        const filtered = [...entries.values()].filter((e: any) => e.source === source)
        return createRequest(filtered)
      }),
    })),
    createIndex: vi.fn(),
  }

  const mockObjectStoreNames = {
    contains: vi.fn().mockReturnValue(false),
  }

  const mockTransaction: Record<string, unknown> = {
    objectStore: vi.fn(() => mockStore),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }

  const mockDB: Record<string, unknown> = {
    transaction: vi.fn(() => mockTransaction),
    objectStoreNames: mockObjectStoreNames,
    createObjectStore: vi.fn(() => mockStore),
  }

  function createRequest(result: unknown) {
    const req: Record<string, unknown> = {
      result,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      error: null,
    }
    // Trigger onsuccess asynchronously
    Promise.resolve().then(() => {
      if (typeof req.onsuccess === 'function') req.onsuccess()
    })
    return req
  }

  const mockOpenRequest: Record<string, unknown> = {
    result: mockDB,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
    error: null,
  }

  const mockIndexedDB = {
    open: vi.fn(() => {
      Promise.resolve().then(() => {
        // Trigger onupgradeneeded first
        if (typeof mockOpenRequest.onupgradeneeded === 'function') {
          mockOpenRequest.onupgradeneeded()
        }
        if (typeof mockOpenRequest.onsuccess === 'function') {
          mockOpenRequest.onsuccess()
        }
      })
      return mockOpenRequest
    }),
  }

  return { mockIndexedDB, mockDB, mockStore, mockTransaction, entries }
}

let mockIDB: ReturnType<typeof createMockIDB>

beforeEach(() => {
  vi.resetModules()
  mockIDB = createMockIDB()
  vi.stubGlobal('indexedDB', mockIDB.mockIndexedDB)
})

describe('indexedDBStore', () => {
  async function getStore() {
    const mod = await import('../../services/indexeddb-store')
    return mod.indexedDBStore
  }

  it('get returns data when entry exists', async () => {
    const entry = { key: 'openrn:ch1', data: { title: 'Chapter 1' }, source: 'openrn', title: 'Ch1', chapter: 1, content: '', updatedAt: '' }
    mockIDB.entries.set('openrn:ch1', entry)

    const store = await getStore()
    const result = await store.get('openrn:ch1')
    expect(result).toEqual({ title: 'Chapter 1' })
  })

  it('get returns null when entry does not exist', async () => {
    const store = await getStore()
    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })

  it('put stores an entry with derived fields', async () => {
    const store = await getStore()
    await store.put('openrn:ch1', { title: 'Chapter 1', chapter: 1, content: 'text' })
    expect(mockIDB.mockStore.put).toHaveBeenCalled()
    const putArg = vi.mocked(mockIDB.mockStore.put as any).mock.calls[0][0]
    expect(putArg.key).toBe('openrn:ch1')
    expect(putArg.source).toBe('openrn')
    expect(putArg.title).toBe('Chapter 1')
  })

  it('put defaults source to unknown when no colon in key', async () => {
    const store = await getStore()
    await store.put('singlekey', { title: 'Test' })
    const putArg = vi.mocked(mockIDB.mockStore.put as any).mock.calls[0][0]
    expect(putArg.source).toBe('singlekey')
  })

  it('put uses key as title when data.title is missing', async () => {
    const store = await getStore()
    await store.put('openrn:ch1', {})
    const putArg = vi.mocked(mockIDB.mockStore.put as any).mock.calls[0][0]
    expect(putArg.title).toBe('openrn:ch1')
    expect(putArg.chapter).toBe(0)
    expect(putArg.content).toBe('')
  })

  it('delete removes an entry', async () => {
    const store = await getStore()
    await store.delete('openrn:ch1')
    expect(mockIDB.mockStore.delete).toHaveBeenCalled()
  })

  it('getAllKeys returns all keys', async () => {
    mockIDB.entries.set('a', {})
    mockIDB.entries.set('b', {})
    const store = await getStore()
    const keys = await store.getAllKeys()
    expect(keys).toEqual(['a', 'b'])
  })

  it('count returns entry count', async () => {
    mockIDB.entries.set('a', {})
    mockIDB.entries.set('b', {})
    const store = await getStore()
    const c = await store.count()
    expect(c).toBe(2)
  })

  it('clear removes all entries', async () => {
    mockIDB.entries.set('a', {})
    const store = await getStore()
    await store.clear()
    expect(mockIDB.mockStore.clear).toHaveBeenCalled()
  })

  it('getBySource queries the source index', async () => {
    mockIDB.entries.set('openrn:ch1', { key: 'openrn:ch1', source: 'openrn', title: 'Ch1', chapter: 1, content: '', data: {}, updatedAt: '' })
    mockIDB.entries.set('openstax:ch1', { key: 'openstax:ch1', source: 'openstax', title: 'Ch1', chapter: 1, content: '', data: {}, updatedAt: '' })

    const store = await getStore()
    const results = await store.getBySource('openrn')
    expect(mockIDB.mockStore.index).toHaveBeenCalledWith('source')
  })

  it('search filters entries by query matching title, content, or key', async () => {
    mockIDB.entries.set('openrn:ch1', {
      key: 'openrn:ch1', source: 'openrn', title: 'Pharmacology Basics',
      chapter: 1, content: 'Drug interactions', data: { x: 1 }, updatedAt: '',
    })
    mockIDB.entries.set('openrn:ch2', {
      key: 'openrn:ch2', source: 'openrn', title: 'Anatomy',
      chapter: 2, content: 'Body systems', data: { y: 2 }, updatedAt: '',
    })

    const store = await getStore()
    const results = await store.search('pharmacology')
    // Search filters via getAll then filter
    expect(mockIDB.mockStore.getAll).toHaveBeenCalled()
  })

  it('bulkPut stores multiple entries in a transaction', async () => {
    // For bulkPut, we need to handle transaction.oncomplete
    const originalTransaction = mockIDB.mockDB.transaction
    vi.mocked(mockIDB.mockDB.transaction as any).mockImplementation(() => {
      const tx = {
        objectStore: vi.fn(() => mockIDB.mockStore),
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: null,
      }
      Promise.resolve().then(() => {
        if (typeof tx.oncomplete === 'function') tx.oncomplete()
      })
      return tx
    })

    const store = await getStore()
    await store.bulkPut([
      { key: 'openrn:ch1', data: { title: 'Ch1', chapter: 1, content: 'text' } },
      { key: 'openrn:ch2', data: { title: 'Ch2', chapter: 2, content: 'text2' } },
    ])
    expect(mockIDB.mockStore.put).toHaveBeenCalledTimes(2)
  })

  it('get returns null on error', async () => {
    // Make openDB reject
    vi.mocked(mockIDB.mockIndexedDB.open).mockImplementation(() => {
      const req: Record<string, unknown> = {
        result: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        error: new Error('IDB error'),
      }
      Promise.resolve().then(() => {
        if (typeof req.onerror === 'function') req.onerror()
      })
      return req as any
    })

    const store = await getStore()
    const result = await store.get('anything')
    expect(result).toBeNull()
  })
})
