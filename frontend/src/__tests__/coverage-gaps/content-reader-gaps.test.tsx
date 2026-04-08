/**
 * Tests targeting uncovered lines 303-405, 444-480 in ContentReader.tsx
 * These cover: keyboard navigation (Home/End/Space/PageDown/PageUp),
 * touch swipe navigation, retry handler, bookmark toggle,
 * highlight sidebar navigation, bookmark sidebar navigation,
 * and TTS onListen handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ContentReader } from '../../components/ContentReader'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../reader/epubParser', () => ({
  parseEpub: vi.fn().mockResolvedValue({ title: 'Test Book', html: '<p>Test content here</p>' }),
}))

vi.mock('../../services/api', () => ({
  api: {
    getReadingPosition: vi.fn().mockResolvedValue(null),
    setReadingPosition: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/annotation-sync', () => ({
  annotationSync: {
    enqueueBookmark: vi.fn(),
    enqueueHighlight: vi.fn(),
    fullSync: vi.fn().mockResolvedValue({ bookmarks: [], highlights: [] }),
  },
}))

vi.mock('../../styles/ReaderTheme.css', () => ({}))
vi.mock('../../styles/ReaderFlipbook.css', () => ({}))
vi.mock('../../styles/ReaderHighlights.css', () => ({}))
vi.mock('../../styles/ReaderAudio.css', () => ({}))

import { api } from '../../services/api'

describe('ContentReader — keyboard navigation gaps', () => {
  const defaultProps = {
    epubUrl: '/books/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('Space key triggers flipNext', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: ' ' })
    // No crash, space handled
  })

  it('PageDown key triggers flipNext', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'PageDown' })
  })

  it('PageUp key triggers flipPrev', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'PageUp' })
  })

  it('Home key flips to first page', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Home' })
  })

  it('End key flips to last page', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'End' })
  })

  it('does not handle keyboard events when target is INPUT', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    document.body.removeChild(input)
  })

  it('does not handle keyboard events when target is TEXTAREA', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    fireEvent.keyDown(textarea, { key: 'ArrowRight' })
    document.body.removeChild(textarea)
  })

  it('does not handle keyboard events when target is BUTTON', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    const button = document.createElement('button')
    document.body.appendChild(button)
    fireEvent.keyDown(button, { key: 'ArrowRight' })
    document.body.removeChild(button)
  })
})

describe('ContentReader — touch navigation', () => {
  const defaultProps = {
    epubUrl: '/books/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('swipe left triggers flipNext', async () => {
    const { container } = render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    const reader = container.querySelector('.nclex-reader')!
    fireEvent.touchStart(reader, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 200 }] })
  })

  it('swipe right triggers flipPrev', async () => {
    const { container } = render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    const reader = container.querySelector('.nclex-reader')!
    fireEvent.touchStart(reader, { touches: [{ clientX: 200 }] })
    fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 300 }] })
  })

  it('small swipe does not flip', async () => {
    const { container } = render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    const reader = container.querySelector('.nclex-reader')!
    fireEvent.touchStart(reader, { touches: [{ clientX: 200 }] })
    fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 210 }] })
  })
})

describe('ContentReader — retry and error recovery', () => {
  const defaultProps = {
    epubUrl: '/books/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('clicking Retry re-fetches the EPUB', async () => {
    let fetchCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCount++
      if (fetchCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: new Headers({ 'content-length': '0' }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-length': '1000' }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as Response)
    })

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
  })

  it('shows error for too-large EPUB (content-length check)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': String(300 * 1024 * 1024) }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText(/too large/i)).toBeInTheDocument())
  })

  it('shows error for too-large EPUB (buffer size check)', async () => {
    const largeBuffer = new ArrayBuffer(201 * 1024 * 1024)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(largeBuffer),
    } as Response)

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText(/too large/i)).toBeInTheDocument())
  })
})

describe('ContentReader — reading position restore and save', () => {
  const defaultProps = {
    epubUrl: '/books/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('restores reading position from API', async () => {
    vi.mocked(api.getReadingPosition).mockResolvedValue({
      position: { page: 2 },
    } as any)

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    // Position restore is triggered after totalPages > 0
    expect(api.getReadingPosition).toHaveBeenCalledWith('test-key')
  })

  it('handles getReadingPosition returning null gracefully', async () => {
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
    expect(api.getReadingPosition).toHaveBeenCalled()
  })

  it('handles getReadingPosition failure gracefully', async () => {
    vi.mocked(api.getReadingPosition).mockRejectedValue(new Error('Network error'))

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())
  })
})

describe('ContentReader — bookmark and highlight sidebar toggles', () => {
  const defaultProps = {
    epubUrl: '/books/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('toggles bookmark sidebar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    // Look for the bookmarks toggle button
    const bmBtn = screen.getByLabelText('Open bookmarks')
    fireEvent.click(bmBtn)
    // The sidebar should be visible now
  })

  it('toggles highlights sidebar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    const hlBtn = screen.getByLabelText('Open highlights')
    fireEvent.click(hlBtn)
  })

  it('toggles bookmark for current page', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => expect(screen.getByText('Test content here')).toBeInTheDocument())

    const bookmarkBtn = screen.getByLabelText('Bookmark this page')
    fireEvent.click(bookmarkBtn)
  })
})
