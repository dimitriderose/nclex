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
})
