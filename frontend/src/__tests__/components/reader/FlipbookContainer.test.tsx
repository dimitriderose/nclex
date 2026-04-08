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
})
