import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FlipbookContainer } from '../../../components/reader/FlipbookContainer'

vi.mock('../../../styles/ReaderFlipbook.css', () => ({}))

function renderFlipbook(overrides = {}) {
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
    fontSize: 20,
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
    fontFamily: "var(--font-reading)",
  }
  const viewportRef = { current: document.createElement('div') }
  const contentRef = { current: document.createElement('div') }
  const props = {
    html: '<p>Hello <b>World</b></p>',
    prefs,
    flipbook,
    viewportRef: viewportRef as any,
    contentRef: contentRef as any,
    ...overrides,
  }
  render(<FlipbookContainer {...props} />)
  return { flipbook, prefs }
}

describe('FlipbookContainer', () => {
  it('renders HTML content via dangerouslySetInnerHTML', () => {
    renderFlipbook()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('renders flip zone buttons', () => {
    renderFlipbook()
    expect(screen.getByLabelText('Previous page')).toBeInTheDocument()
    expect(screen.getByLabelText('Next page')).toBeInTheDocument()
  })

  it('click on next zone calls flipNext', () => {
    const { flipbook } = renderFlipbook()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(flipbook.flipNext).toHaveBeenCalled()
  })

  it('click on prev zone calls flipPrev', () => {
    const { flipbook } = renderFlipbook()
    fireEvent.click(screen.getByLabelText('Previous page'))
    expect(flipbook.flipPrev).toHaveBeenCalled()
  })

  it('adds at-boundary class to prev zone when atStart', () => {
    renderFlipbook({ atStart: true })
    const prevZone = screen.getByLabelText('Previous page')
    expect(prevZone.className).toContain('at-boundary')
  })

  it('adds at-boundary class to next zone when atEnd', () => {
    renderFlipbook({ atEnd: true })
    const nextZone = screen.getByLabelText('Next page')
    expect(nextZone.className).toContain('at-boundary')
  })

  it('no boundary classes when in middle', () => {
    renderFlipbook({ atStart: false, atEnd: false })
    const prevZone = screen.getByLabelText('Previous page')
    const nextZone = screen.getByLabelText('Next page')
    expect(prevZone.className).not.toContain('at-boundary')
    expect(nextZone.className).not.toContain('at-boundary')
  })

  it('applies font size from prefs', () => {
    renderFlipbook()
    const content = document.querySelector('.flipbook-content') as HTMLElement
    expect(content.style.fontSize).toBe('20px')
  })

  it('Enter key on next zone calls flipNext', () => {
    const { flipbook } = renderFlipbook()
    fireEvent.keyDown(screen.getByLabelText('Next page'), { key: 'Enter' })
    expect(flipbook.flipNext).toHaveBeenCalled()
  })

  it('Space key on prev zone calls flipPrev', () => {
    const { flipbook } = renderFlipbook()
    fireEvent.keyDown(screen.getByLabelText('Previous page'), { key: ' ' })
    expect(flipbook.flipPrev).toHaveBeenCalled()
  })

  it('shows flipping class on page-shadow when isFlipping', () => {
    renderFlipbook({ isFlipping: true })
    const shadow = document.querySelector('.page-shadow')
    expect(shadow?.className).toContain('flipping')
  })

  it('external link sets target _blank and rel', () => {
    const contentRef = { current: document.createElement('div') }
    contentRef.current.innerHTML = '<a href="https://example.com">Link</a>'

    const viewportRef = { current: document.createElement('div') }
    Object.defineProperty(viewportRef.current, 'offsetWidth', { value: 1000, configurable: true })

    const flipbook = {
      currentPage: 0, totalPages: 10, chapterInfo: null, isFlipping: false,
      flipNext: vi.fn(), flipPrev: vi.fn(), flipTo: vi.fn(), paginate: vi.fn(),
      atStart: false, atEnd: false, progressPercent: 0,
    }
    const prefs = {
      fontSize: 20, isSerif: true, lineHeightPreset: 'default' as const,
      marginPreset: 'default' as const, theme: '' as const,
      increaseFontSize: vi.fn(), decreaseFontSize: vi.fn(), toggleFont: vi.fn(),
      cycleLineHeight: vi.fn(), cycleMargin: vi.fn(), setTheme: vi.fn(),
      lineHeight: 1.72, margins: { desktop: 56, mobile: 20 },
      fontFamily: "var(--font-reading)",
    }

    render(<FlipbookContainer
      html='<a href="https://example.com">Link</a>'
      prefs={prefs}
      flipbook={flipbook}
      viewportRef={viewportRef as any}
      contentRef={contentRef as any}
    />)

    const content = document.querySelector('.flipbook-content') as HTMLElement
    const anchor = content.querySelector('a') as HTMLAnchorElement
    fireEvent.click(anchor)
    // External links set target to _blank
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('internal link click calls preventDefault and tries navigation', () => {
    const contentDiv = document.createElement('div')
    contentDiv.innerHTML = '<div class="epub-chapter" data-epub-src="chapter2.xhtml"><h2>Chapter 2</h2></div>'
    Object.defineProperty(contentDiv, 'offsetWidth', { value: 1000, configurable: true })

    const viewportDiv = document.createElement('div')
    Object.defineProperty(viewportDiv, 'offsetWidth', { value: 1000, configurable: true })

    const flipTo = vi.fn()
    const flipbook = {
      currentPage: 0, totalPages: 10, chapterInfo: null, isFlipping: false,
      flipNext: vi.fn(), flipPrev: vi.fn(), flipTo, paginate: vi.fn(),
      atStart: false, atEnd: false, progressPercent: 0,
    }
    const prefs = {
      fontSize: 20, isSerif: true, lineHeightPreset: 'default' as const,
      marginPreset: 'default' as const, theme: '' as const,
      increaseFontSize: vi.fn(), decreaseFontSize: vi.fn(), toggleFont: vi.fn(),
      cycleLineHeight: vi.fn(), cycleMargin: vi.fn(), setTheme: vi.fn(),
      lineHeight: 1.72, margins: { desktop: 56, mobile: 20 },
      fontFamily: "var(--font-reading)",
    }

    render(<FlipbookContainer
      html='<a href="chapter2.xhtml">Go to chapter 2</a>'
      prefs={prefs}
      flipbook={flipbook}
      viewportRef={{ current: viewportDiv } as any}
      contentRef={{ current: contentDiv } as any}
    />)

    const content = document.querySelector('.flipbook-content') as HTMLElement
    const anchor = content.querySelector('a') as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    anchor.dispatchEvent(event)
    expect(preventSpy).toHaveBeenCalled()
  })

  it('click on non-anchor element in content does nothing', () => {
    renderFlipbook()
    const content = document.querySelector('.flipbook-content') as HTMLElement
    const p = content.querySelector('p')!
    fireEvent.click(p)
    // Should not throw or crash
  })

  it('internal link with fragment navigates to element by id', () => {
    const flipTo = vi.fn()
    const flipbook = {
      currentPage: 0, totalPages: 10, chapterInfo: null, isFlipping: false,
      flipNext: vi.fn(), flipPrev: vi.fn(), flipTo, paginate: vi.fn(),
      atStart: false, atEnd: false, progressPercent: 0,
    }
    const prefs = {
      fontSize: 20, isSerif: true, lineHeightPreset: 'default' as const,
      marginPreset: 'default' as const, theme: '' as const,
      increaseFontSize: vi.fn(), decreaseFontSize: vi.fn(), toggleFont: vi.fn(),
      cycleLineHeight: vi.fn(), cycleMargin: vi.fn(), setTheme: vi.fn(),
      lineHeight: 1.72, margins: { desktop: 56, mobile: 20 },
      fontFamily: "var(--font-reading)",
    }

    // Include the target element in the HTML so it ends up inside the rendered contentRef div
    const viewportRef = { current: null as HTMLDivElement | null }
    const contentRef = { current: null as HTMLDivElement | null }

    const { container } = render(<FlipbookContainer
      html='<a href="#section-1">Jump</a><div id="section-1">Target</div>'
      prefs={prefs}
      flipbook={flipbook}
      viewportRef={viewportRef as any}
      contentRef={contentRef as any}
    />)

    // Mock offsetWidth on the rendered viewport so navigateToElement doesn't bail
    const viewport = container.querySelector('.flipbook-viewport') as HTMLElement
    Object.defineProperty(viewport, 'offsetWidth', { value: 1000, configurable: true })
    viewportRef.current = viewport

    const content = container.querySelector('.flipbook-content') as HTMLElement
    const anchor = content.querySelector('a') as HTMLAnchorElement
    fireEvent.click(anchor)

    expect(flipTo).toHaveBeenCalled()
  })

  it('anchor with no href does nothing', () => {
    renderFlipbook({ html: '<a>No href</a>' })
    const content = document.querySelector('.flipbook-content') as HTMLElement
    const anchor = content.querySelector('a')!
    fireEvent.click(anchor)
    // Should not throw
  })

  it('mailto link is treated as external', () => {
    renderFlipbook({ html: '<a href="mailto:test@example.com">Email</a>' })
    const content = document.querySelector('.flipbook-content') as HTMLElement
    const anchor = content.querySelector('a')!
    fireEvent.click(anchor)
    expect(anchor.getAttribute('target')).toBe('_blank')
  })
})
