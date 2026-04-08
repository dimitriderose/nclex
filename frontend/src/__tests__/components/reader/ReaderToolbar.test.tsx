import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReaderToolbar } from '../../../components/reader/ReaderToolbar'

function createPrefs(overrides = {}) {
  return {
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
    ...overrides,
  }
}

function renderToolbar(overrides = {}) {
  const prefs = createPrefs(overrides)
  const defaultProps = {
    prefs,
    onClose: vi.fn(),
    readingTimeText: '~5 min read',
    isBookmarked: false,
    bookmarkCount: 0,
    highlightCount: 0,
    onToggleBookmark: vi.fn(),
    onToggleBookmarks: vi.fn(),
    onToggleHighlights: vi.fn(),
    isTTSAvailable: true,
    isListening: false,
    onListen: vi.fn(),
    ...overrides,
  }
  render(<ReaderToolbar {...defaultProps} />)
  return { prefs, ...defaultProps }
}

describe('ReaderToolbar', () => {
  it('renders Library button', () => {
    renderToolbar()
    expect(screen.getByLabelText('Library')).toBeInTheDocument()
  })

  it('font increase button calls handler', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByLabelText('Increase font size'))
    expect(prefs.increaseFontSize).toHaveBeenCalledOnce()
  })

  it('font decrease button calls handler', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByLabelText('Decrease font size'))
    expect(prefs.decreaseFontSize).toHaveBeenCalledOnce()
  })

  it('shows Serif label when isSerif is true', () => {
    renderToolbar({ isSerif: true })
    expect(screen.getByText('Serif')).toBeInTheDocument()
  })

  it('shows Sans label when isSerif is false', () => {
    renderToolbar({ isSerif: false })
    expect(screen.getByText('Sans')).toBeInTheDocument()
  })

  it('clicking theme dot calls setTheme', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByLabelText('Theme: Dark'))
    expect(prefs.setTheme).toHaveBeenCalledWith('dark')
  })

  it('renders theme dots with active class on current theme', () => {
    renderToolbar({ theme: 'sepia' })
    const sepiaBtn = screen.getByLabelText('Theme: Sepia')
    expect(sepiaBtn.className).toContain('active')
    const lightBtn = screen.getByLabelText('Theme: Light')
    expect(lightBtn.className).not.toContain('active')
  })

  it('TTS button visible when isTTSAvailable', () => {
    renderToolbar({ isTTSAvailable: true })
    expect(screen.getByLabelText('Listen')).toBeInTheDocument()
  })

  it('TTS button not visible when not available', () => {
    renderToolbar({ isTTSAvailable: false })
    expect(screen.queryByLabelText('Listen')).toBeNull()
  })

  it('bookmark icon toggles on click', () => {
    const props = renderToolbar({ isBookmarked: false })
    fireEvent.click(screen.getByLabelText('Bookmark this page'))
    expect(props.onToggleBookmark).toHaveBeenCalled()
  })

  it('shows badge counts for highlights and bookmarks', () => {
    renderToolbar({ highlightCount: 3, bookmarkCount: 7 })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
