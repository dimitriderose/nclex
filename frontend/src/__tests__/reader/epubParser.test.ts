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

  it('handles images in chapters — converts to base64', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Image Book</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
        <p>Text</p>
        <img src="../images/fig1.png" alt="Figure 1"/>
      </body></html>`

    // Fake image data
    const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header

    const mockFileObjects: Record<string, { async: ReturnType<typeof vi.fn> }> = {
      'META-INF/container.xml': { async: vi.fn().mockResolvedValue(containerXml) },
      'OEBPS/content.opf': { async: vi.fn().mockResolvedValue(opfXml) },
      'OEBPS/chapter1.xhtml': { async: vi.fn().mockResolvedValue(chapterXhtml) },
      'images/fig1.png': { async: vi.fn().mockResolvedValue(imageData) },
    }

    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        return mockFileObjects[path] || null
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
    expect(result.title).toBe('Image Book')
    expect(result.html).toContain('Text')
    // Image should have been converted to base64 data URI
    expect(result.html).toContain('data:image/png;base64,')
  })

  it('handles missing image files gracefully', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Missing Img</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
        <p>Text</p>
        <img src="missing.png" alt="Missing"/>
      </body></html>`

    const mockFileObjects: Record<string, { async: ReturnType<typeof vi.fn> }> = {
      'META-INF/container.xml': { async: vi.fn().mockResolvedValue(containerXml) },
      'OEBPS/content.opf': { async: vi.fn().mockResolvedValue(opfXml) },
      'OEBPS/chapter1.xhtml': { async: vi.fn().mockResolvedValue(chapterXhtml) },
    }

    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        return mockFileObjects[path] || null
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
    // Should not throw; just skip the missing image
    expect(result.html).toContain('Text')
  })

  it('handles image conversion error gracefully', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Error Img</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
        <p>Text</p>
        <img src="error.png" alt="Error"/>
      </body></html>`

    const mockFileObjects: Record<string, { async: ReturnType<typeof vi.fn> }> = {
      'META-INF/container.xml': { async: vi.fn().mockResolvedValue(containerXml) },
      'OEBPS/content.opf': { async: vi.fn().mockResolvedValue(opfXml) },
      'OEBPS/chapter1.xhtml': { async: vi.fn().mockResolvedValue(chapterXhtml) },
      'OEBPS/error.png': { async: vi.fn().mockRejectedValue(new Error('read error')) },
    }

    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        return mockFileObjects[path] || null
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
    expect(result.html).toContain('Text')
  })

  it('handles OPF path without directory separator', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Flat Book</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body><p>Flat content</p></body></html>`

    const mockFileObjects: Record<string, { async: ReturnType<typeof vi.fn> }> = {
      'META-INF/container.xml': { async: vi.fn().mockResolvedValue(containerXml) },
      'content.opf': { async: vi.fn().mockResolvedValue(opfXml) },
      'chapter1.xhtml': { async: vi.fn().mockResolvedValue(chapterXhtml) },
    }

    const mockZip = {
      file: vi.fn((path: string) => {
        if (path === 'META-INF/rights.xml') return null
        return mockFileObjects[path] || null
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
    expect(result.title).toBe('Flat Book')
    expect(result.html).toContain('Flat content')
  })

  it('skips data: URIs on non-IMG tags via DOMPurify hook', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">DRM Test</dc:title></metadata>
        <manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
        <p>This is safe readable content that should survive sanitization.</p>
        <a href="data:text/html,test">Bad link</a>
        <img src="data:image/png;base64,abc123" alt="Good image"/>
        <p>More safe content here for the parser to pick up.</p>
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
    expect(result.html).toContain('safe readable content')
    // The data: URI on <a> should have been stripped (href removed), but <img> data: URI should survive
    expect(result.html).toContain('data:image/png;base64,abc123')
    expect(result.html).not.toContain('data:text/html')
  })

  it('handles spine items with missing manifest entry', async () => {
    const containerXml = `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
      </container>`
    const opfXml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Sparse</dc:title></metadata>
        <manifest>
          <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="ch1"/>
          <itemref idref="missing-item"/>
        </spine>
      </package>`
    const chapterXhtml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body><p>Content</p></body></html>`

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
    // Should skip missing-item and still produce content
    expect(result.html).toContain('Content')
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
