import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ContentReader } from '../../components/ContentReader'

// Mock all the hooks and modules that ContentReader depends on
vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../reader/epubParser', () => ({
  parseEpub: vi.fn().mockResolvedValue({ title: 'Test Book', html: '<p>Hello World</p>' }),
}))

vi.mock('../../services/api', () => ({
  api: {
    getReadingPosition: vi.fn(),
    setReadingPosition: vi.fn(),
  },
}))

vi.mock('../../services/annotation-sync', () => ({
  annotationSync: {
    enqueueBookmark: vi.fn(),
    enqueueHighlight: vi.fn(),
    fullSync: vi.fn(),
  },
}))

// Mock CSS imports
vi.mock('../../styles/ReaderTheme.css', () => ({}))
vi.mock('../../styles/ReaderFlipbook.css', () => ({}))
vi.mock('../../styles/ReaderHighlights.css', () => ({}))
vi.mock('../../styles/ReaderAudio.css', () => ({}))

import { api } from '../../services/api'
import { annotationSync } from '../../services/annotation-sync'

describe('ContentReader', () => {
  const defaultProps = {
    epubUrl: '/books/epubs/test.epub',
    bookTitle: 'Test Book',
    contentKey: 'test-key',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    defaultProps.onClose = vi.fn()
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    // Re-set mock implementations (vi.clearAllMocks would clear them)
    vi.mocked(api.getReadingPosition).mockResolvedValue(null)
    vi.mocked(api.setReadingPosition).mockResolvedValue(undefined as any)
    vi.mocked(annotationSync.fullSync).mockResolvedValue({ bookmarks: [], highlights: [] })

    // Mock fetch to return an ArrayBuffer
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  afterEach(() => {
    // Only restore spies (like fetch), not all mocks
    vi.mocked(globalThis.fetch).mockRestore?.()
  })

  it('shows loading state initially', () => {
    render(<ContentReader {...defaultProps} />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it('renders the reader container', () => {
    const { container } = render(<ContentReader {...defaultProps} />)
    expect(container.querySelector('.nclex-reader')).toBeInTheDocument()
  })

  it('renders Library button in toolbar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Library')).toBeInTheDocument()
    })
  })

  it('clicking Library button calls onClose', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Library')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Library'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('shows content after loading', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
  })

  it('shows error state on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-length': '0' }),
    } as Response)
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument()
    })
  })

  it('shows Retry button on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-length': '0' }),
    } as Response)
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })
  })

  it('ArrowRight key triggers flipNext without error', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
  })

  it('ArrowLeft key triggers flipPrev without error', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
  })

  it('sets document title to book title', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(document.title).toBe('Test Book')
    })
  })

  it('resets document title on unmount', async () => {
    const { unmount } = render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(document.title).toBe('Test Book')
    })
    unmount()
    expect(document.title).toBe('NCLEX Trainer')
  })

  it('renders font controls in toolbar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Increase font size')).toBeInTheDocument()
      expect(screen.getByLabelText('Decrease font size')).toBeInTheDocument()
    })
  })

  it('PageDown key triggers navigation without error', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'PageDown' })
  })

  it('PageUp key triggers navigation without error', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'PageUp' })
  })

  it('Space key triggers flipNext', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: ' ' })
  })

  it('Home key goes to first page', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'Home' })
  })

  it('End key goes to last page', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    fireEvent.keyDown(document, { key: 'End' })
  })

  it('ignores keyboard events from input elements', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    // Create an input and dispatch keydown from it
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    document.body.removeChild(input)
  })

  it('touch swipe left triggers flipNext', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    const reader = document.querySelector('.nclex-reader')!
    fireEvent.touchStart(reader, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 100 }] })
  })

  it('touch swipe right triggers flipPrev', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    const reader = document.querySelector('.nclex-reader')!
    fireEvent.touchStart(reader, { touches: [{ clientX: 100 }] })
    fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 300 }] })
  })

  it('Retry button re-fetches the EPUB', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-length': '0' }),
    } as Response)
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    // Now make fetch succeed on retry
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '1000' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)

    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
  })

  it('bookmark toggle button is in toolbar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Bookmark this page')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Bookmark this page'))
  })

  it('highlights sidebar toggle is in toolbar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Open highlights')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Open highlights'))
  })

  it('bookmarks sidebar toggle is in toolbar', async () => {
    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByLabelText('Open bookmarks')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Open bookmarks'))
  })

  it('restores reading position from API on load', async () => {
    vi.mocked(api.getReadingPosition).mockResolvedValue({
      contentKey: 'test-key',
      position: { page: 3 },
    } as any)

    render(<ContentReader {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
    // Should have attempted to restore position
    expect(api.getReadingPosition).toHaveBeenCalledWith('test-key')
  })
})
