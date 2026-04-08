import { describe, it, expect, vi, beforeEach } from 'vitest'

// Note: resolveRelativePath, arrayBufferToBase64, escapeAttr are NOT exported from epubParser.
// Only parseEpub and ParsedEpub are exported. We test parseEpub end-to-end instead.

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── parseEpub tests ──

describe('parseEpub', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('parses valid EPUB and returns title + sanitized html', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test Book</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head><body><p>Hello World</p></body></html>`

    const mockZipFiles: Record<string, string> = {
      'META-INF/container.xml': containerXml,
      'OEBPS/content.opf': opfXml,
      'OEBPS/chapter1.xhtml': chapterXhtml,
    }

    const mockFileObjects: Record<string, { async: ReturnType<typeof vi.fn> }> = {}
    for (const [path, content] of Object.entries(mockZipFiles)) {
      mockFileObjects[path] = {
        async: vi.fn().mockResolvedValue(content),
      }
    }

    const mockZip = {
      file: vi.fn((path: string) => mockFileObjects[path] || null),
    }

    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    const result = await parse(new ArrayBuffer(8))
    expect(result.title).toBe('Test Book')
    expect(result.html).toContain('Hello World')
  })

  it('throws on corrupt ZIP', async () => {
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockRejectedValue(new Error('bad zip')) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('valid EPUB')
  })

  it('throws on Adobe DRM (rights.xml)', async () => {
    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return { async: vi.fn() }
        return null
      }),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('DRM')
  })

  it('throws on missing container.xml', async () => {
    const mockZip = {
      file: vi.fn(() => null),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('container.xml')
  })

  it('throws on missing rootfile', async () => {
    const containerXml = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles></rootfiles></container>`
    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        if (path === 'META-INF/container.xml') return { async: vi.fn().mockResolvedValue(containerXml) }
        return null
      }),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('rootfile')
  })

  it('throws on missing OPF file', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        if (path === 'META-INF/container.xml') return { async: vi.fn().mockResolvedValue(containerXml) }
        return null
      }),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('OPF')
  })

  it('throws on zero chapters in spine', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test</dc:title></metadata>
        <manifest></manifest>
        <spine></spine>
      </package>`
    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        if (path === 'META-INF/container.xml') return { async: vi.fn().mockResolvedValue(containerXml) }
        if (path === 'OEBPS/content.opf') return { async: vi.fn().mockResolvedValue(opfXml) }
        return null
      }),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    await expect(parse(new ArrayBuffer(8))).rejects.toThrow('readable content')
  })

  it('sanitizes script tags from content', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
        <script>alert("xss")</script>
        <a href="http://example.com">Link</a>
        <p>Safe content</p>
      </body></html>`

    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        if (path === 'META-INF/container.xml') return { async: vi.fn().mockResolvedValue(containerXml) }
        if (path === 'OEBPS/content.opf') return { async: vi.fn().mockResolvedValue(opfXml) }
        if (path === 'OEBPS/chapter1.xhtml') return { async: vi.fn().mockResolvedValue(chapterXhtml) }
        return null
      }),
    }
    vi.doMock('jszip', () => ({
      default: { loadAsync: vi.fn().mockResolvedValue(mockZip) },
    }))

    vi.doMock('../../reader/readerLogger', () => ({
      readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    const { parseEpub: parse } = await import('../../reader/epubParser')
    const result = await parse(new ArrayBuffer(8))
    expect(result.html).not.toContain('<script')
    expect(result.html).toContain('Safe content')
  })
})
