/**
 * Tests targeting uncovered lines 26-36, 41-99 in FlipbookContainer.tsx
 * These cover: navigateToElement callback and handleContentClick for internal links
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FlipbookContainer } from '../../components/reader/FlipbookContainer'

vi.mock('../../styles/ReaderFlipbook.css', () => ({}))

function createMockProps(overrides: Record<string, unknown> = {}) {
  const flipbook = {
    currentPage: 0,
    totalPages: 10,
    chapterInfo: null,
    isFlipping: false,
    flipNext: vi.fn(),
    flipPrev: vi.fn(),
    flipTo: vi.fn(),
    paginate: vi.fn(),
    atStart: false,
    atEnd: false,
    progressPercent: 0,
    ...overrides,
  }
  const prefs = {
    fontSize: 18,
    isSerif: true,
    lineHeightPreset: 'default' as const,
    marginPreset: 'default' as const,
    theme: '' as const,
    increaseFontSize: vi.fn(),
    decreaseFontSize: vi.fn(),
    toggleFont: vi.fn(),
    cycleLineHeight: vi.fn(),
    cycleMargin: vi.fn(),
    setTheme: vi.fn(),
    lineHeight: 1.72,
    margins: { desktop: 56, mobile: 20 },
    fontFamily: 'var(--font-reading)',
  }

  // Create real DOM elements for refs
  const contentDiv = document.createElement('div')
  contentDiv.className = 'flipbook-content'
  document.body.appendChild(contentDiv)

  const viewportDiv = document.createElement('div')
  Object.defineProperty(viewportDiv, 'offsetWidth', { value: 1000, configurable: true })
  document.body.appendChild(viewportDiv)

  const viewportRef = { current: viewportDiv }
  const contentRef = { current: contentDiv }

  return { flipbook, prefs, viewportRef, contentRef, contentDiv, viewportDiv }
}

describe('FlipbookContainer — navigateToElement and handleContentClick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    // Mock window.innerWidth to trigger desktop margins
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  })

  it('handles external http links by setting target="_blank"', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="https://example.com">External</a>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const link = screen.getByText('External')
    fireEvent.click(link)

    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // flipTo should NOT be called for external links
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('handles external https links', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="https://example.com">Link</a>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const link = screen.getByText('Link')
    fireEvent.click(link)
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('handles mailto links without preventing default', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="mailto:test@example.com">Email</a>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const link = screen.getByText('Email')
    fireEvent.click(link)
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('handles internal link with fragment ID', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="#section1">Go to section</a><div id="section1">Target</div>'
    const { container } = render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    // Mock offsetWidth on viewport so navigateToElement doesn't bail out
    const viewport = container.querySelector('.flipbook-viewport') as HTMLElement
    Object.defineProperty(viewport, 'offsetWidth', { value: 1000, configurable: true })
    // React sets viewportRef.current to the rendered element
    viewportRef.current = viewport

    const link = screen.getByText('Go to section')
    fireEvent.click(link)
    expect(flipbook.flipTo).toHaveBeenCalled()
  })

  it('handles internal link with file part and fragment', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="chapter2.xhtml#sec1">Go</a><div class="epub-chapter" data-epub-src="chapter2.xhtml"><span id="sec1">Here</span></div>'
    const { container } = render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const viewport = container.querySelector('.flipbook-viewport') as HTMLElement
    Object.defineProperty(viewport, 'offsetWidth', { value: 1000, configurable: true })
    viewportRef.current = viewport

    const link = screen.getByText('Go')
    fireEvent.click(link)
    expect(flipbook.flipTo).toHaveBeenCalled()
  })

  it('handles internal link with data-epub-src match by filename', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="path/to/chapter3.xhtml">Ch3</a><div class="epub-chapter" data-epub-src="OEBPS/chapter3.xhtml">Content</div>'
    const { container } = render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const viewport = container.querySelector('.flipbook-viewport') as HTMLElement
    Object.defineProperty(viewport, 'offsetWidth', { value: 1000, configurable: true })
    viewportRef.current = viewport

    const link = screen.getByText('Ch3')
    fireEvent.click(link)
    expect(flipbook.flipTo).toHaveBeenCalled()
  })

  it('does nothing when clicking a non-link element', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<p>Just text</p>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    fireEvent.click(screen.getByText('Just text'))
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('does nothing for anchor without href', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a>No href</a>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    fireEvent.click(screen.getByText('No href'))
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('does nothing when internal link target not found', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const html = '<a href="nonexistent.xhtml">Missing</a>'
    render(
      <FlipbookContainer
        html={html}
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    fireEvent.click(screen.getByText('Missing'))
    expect(flipbook.flipTo).not.toHaveBeenCalled()
  })

  it('handles keydown Enter on flip zones', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    render(
      <FlipbookContainer
        html="<p>Content</p>"
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    fireEvent.keyDown(screen.getByLabelText('Next page'), { key: 'Enter' })
    expect(flipbook.flipNext).toHaveBeenCalled()

    fireEvent.keyDown(screen.getByLabelText('Previous page'), { key: 'Enter' })
    expect(flipbook.flipPrev).toHaveBeenCalled()
  })

  it('handles keydown Space on flip zones', () => {
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    render(
      <FlipbookContainer
        html="<p>Content</p>"
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    fireEvent.keyDown(screen.getByLabelText('Next page'), { key: ' ' })
    expect(flipbook.flipNext).toHaveBeenCalled()

    fireEvent.keyDown(screen.getByLabelText('Previous page'), { key: ' ' })
    expect(flipbook.flipPrev).toHaveBeenCalled()
  })

  it('uses mobile margins when window.innerWidth <= 640', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    const { flipbook, prefs, viewportRef, contentRef } = createMockProps()

    const { container } = render(
      <FlipbookContainer
        html="<p>Mobile</p>"
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    // The rendered component creates its own .flipbook-content div with inline styles
    const content = container.querySelector('.flipbook-content') as HTMLElement
    expect(content.style.paddingLeft).toBe('20px')
    expect(content.style.paddingRight).toBe('20px')
  })

  it('shows flipping class on page-shadow when isFlipping', () => {
    const { prefs, viewportRef, contentRef } = createMockProps()
    const flipbook = {
      currentPage: 1,
      totalPages: 10,
      chapterInfo: null,
      isFlipping: true,
      flipNext: vi.fn(),
      flipPrev: vi.fn(),
      flipTo: vi.fn(),
      paginate: vi.fn(),
      atStart: false,
      atEnd: false,
      progressPercent: 10,
    }

    const { container } = render(
      <FlipbookContainer
        html="<p>Content</p>"
        prefs={prefs as any}
        flipbook={flipbook as any}
        viewportRef={viewportRef as any}
        contentRef={contentRef as any}
      />
    )

    const shadow = container.querySelector('.page-shadow')
    expect(shadow?.className).toContain('flipping')
  })
})
