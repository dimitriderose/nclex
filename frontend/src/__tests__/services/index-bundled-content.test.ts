import { describe, it, expect, vi, beforeEach } from 'vitest'

// All tests use dynamic import because BUNDLED_CONTENT_SHA256 is captured at module load time

const mockBulkPut = vi.fn().mockResolvedValue(undefined)

describe('indexBundledContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Clear the SHA env var so integrity check is skipped
    import.meta.env.VITE_BUNDLED_CONTENT_SHA256 = ''

    vi.doMock('../../services/indexeddb-store', () => ({
      indexedDBStore: { bulkPut: mockBulkPut },
    }))
    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))
  })

  async function loadModule() {
    const mod = await import('../../services/index-bundled-content')
    return mod.indexBundledContent
  }

  it('fetches bundled-content.json and writes chapters to IndexedDB', async () => {
    const bundled = {
      openrn: {
        pharmacology: {
          title: 'Pharmacology',
          source: 'OpenRN',
          source_url: 'https://example.com',
          ncbi_url: 'https://ncbi.example.com',
          chapters: [
            { title: 'Chapter 1', text: 'Hello world' },
            { title: 'Chapter 2', text: 'Goodbye world' },
          ],
          chapter_count: 2,
          total_chars: 100,
        },
      },
      openstax: {
        ngn: {
          anatomy: {
            title: 'Anatomy',
            source: 'OpenStax',
            source_url: 'https://openstax.org',
            ncbi_url: '',
            chapters: [{ title: 'Intro', text: 'Body systems' }],
            chapter_count: 1,
            total_chars: 50,
          },
        },
      },
    }

    const buffer = new TextEncoder().encode(JSON.stringify(bundled)).buffer
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response)

    const indexBundledContent = await loadModule()
    const onProgress = vi.fn()
    await indexBundledContent(onProgress)

    expect(onProgress).toHaveBeenCalledWith('Downloading textbook content...')
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Writing'))
    expect(onProgress).toHaveBeenCalledWith('Textbooks ready.')
    expect(mockBulkPut).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: 'openrn:pharmacology:ch0' }),
        expect.objectContaining({ key: 'openrn:pharmacology:ch1' }),
        expect.objectContaining({ key: 'openstax:anatomy:ch0' }),
      ])
    )
  })

  it('throws on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response)

    const indexBundledContent = await loadModule()
    const onProgress = vi.fn()
    await expect(indexBundledContent(onProgress)).rejects.toThrow('Failed to fetch')
  })

  it('handles empty openrn and openstax sections', async () => {
    const bundled = { openrn: {}, openstax: { ngn: {} } }
    const buffer = new TextEncoder().encode(JSON.stringify(bundled)).buffer

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response)

    const indexBundledContent = await loadModule()
    const onProgress = vi.fn()
    await indexBundledContent(onProgress)

    expect(mockBulkPut).toHaveBeenCalledWith([])
    expect(onProgress).toHaveBeenCalledWith('Writing 0 chapters to your library...')
  })

  it('stores correct data fields in IndexedDB entries', async () => {
    const bundled = {
      openrn: {
        pharmacology: {
          title: 'Pharm Book',
          source: 'OpenRN',
          source_url: 'https://example.com/pharm',
          ncbi_url: 'https://ncbi.example.com/pharm',
          chapters: [{ title: 'Ch 1', text: 'Drug info' }],
          chapter_count: 1,
          total_chars: 9,
        },
      },
      openstax: { ngn: {} },
    }

    const buffer = new TextEncoder().encode(JSON.stringify(bundled)).buffer
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response)

    const indexBundledContent = await loadModule()
    const onProgress = vi.fn()
    await indexBundledContent(onProgress)

    const entries = mockBulkPut.mock.calls[0][0] as any[]
    expect(entries[0].key).toBe('openrn:pharmacology:ch0')
    expect(entries[0].data.title).toBe('Ch 1')
    expect(entries[0].data.content).toBe('Drug info')
    expect(entries[0].data.chapter).toBe(0)
    expect(entries[0].data.bookTitle).toBe('Pharm Book')
    expect(entries[0].data.source).toBe('OpenRN')
    expect(entries[0].data.indexedAt).toBeTruthy()
  })

  it('throws on SHA-256 mismatch when hash is configured', async () => {
    import.meta.env.VITE_BUNDLED_CONTENT_SHA256 = 'expectedhashvalue'

    const bundled = { openrn: {}, openstax: { ngn: {} } }
    const buffer = new TextEncoder().encode(JSON.stringify(bundled)).buffer

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response)

    const indexBundledContent = await loadModule()
    const onProgress = vi.fn()
    await expect(indexBundledContent(onProgress)).rejects.toThrow('integrity check failed')
  })
})
