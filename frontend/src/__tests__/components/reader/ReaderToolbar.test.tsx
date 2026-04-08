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

  it('fullscreen button toggles fullscreen when enabled', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
    const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: mockRequestFullscreen, configurable: true })

    renderToolbar()
    const fsBtn = screen.getByLabelText('Toggle fullscreen')
    fireEvent.click(fsBtn)
    expect(mockRequestFullscreen).toHaveBeenCalled()
  })

  it('fullscreen button exits fullscreen when already fullscreen', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true, writable: true })
    const mockExitFullscreen = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = mockExitFullscreen

    renderToolbar()
    const fsBtn = screen.getByLabelText('Toggle fullscreen')
    fireEvent.click(fsBtn)
    expect(mockExitFullscreen).toHaveBeenCalled()
  })

  it('no fullscreen button when not supported', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true })
    renderToolbar()
    expect(screen.queryByLabelText('Toggle fullscreen')).toBeNull()
  })

  it('displays reading time text', () => {
    renderToolbar({ readingTimeText: '~10 min read' })
    expect(screen.getByText('~10 min read')).toBeInTheDocument()
  })

  it('shows Stop button when isListening is true', () => {
    renderToolbar({ isListening: true })
    expect(screen.getByLabelText('Stop listening')).toBeInTheDocument()
  })

  it('clicking Listen calls onListen', () => {
    const props = renderToolbar({ isListening: false })
    fireEvent.click(screen.getByLabelText('Listen'))
    expect(props.onListen).toHaveBeenCalled()
  })

  it('clicking spacing button calls cycleLineHeight', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByText('Spacing'))
    expect(prefs.cycleLineHeight).toHaveBeenCalled()
  })

  it('clicking margins button calls cycleMargin', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByText('Margins'))
    expect(prefs.cycleMargin).toHaveBeenCalled()
  })

  it('displays correct spacing label for compact preset', () => {
    renderToolbar({ lineHeightPreset: 'compact' })
    expect(screen.getByText('Tight')).toBeInTheDocument()
  })

  it('displays correct spacing label for relaxed preset', () => {
    renderToolbar({ lineHeightPreset: 'relaxed' })
    expect(screen.getByText('Loose')).toBeInTheDocument()
  })

  it('displays correct margin label for narrow preset', () => {
    renderToolbar({ marginPreset: 'narrow' })
    expect(screen.getByText('Narrow')).toBeInTheDocument()
  })

  it('displays correct margin label for wide preset', () => {
    renderToolbar({ marginPreset: 'wide' })
    expect(screen.getByText('Wide')).toBeInTheDocument()
  })

  it('toggleFont button calls toggleFont', () => {
    const { prefs } = renderToolbar()
    fireEvent.click(screen.getByText('Serif'))
    expect(prefs.toggleFont).toHaveBeenCalled()
  })

  it('Library close button calls onClose', () => {
    const props = renderToolbar()
    fireEvent.click(screen.getByLabelText('Library'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('no badge when counts are 0', () => {
    renderToolbar({ highlightCount: 0, bookmarkCount: 0 })
    expect(document.querySelectorAll('.tb-badge').length).toBe(0)
  })

  it('removes bookmark/highlight/bookmark buttons when handlers not provided', () => {
    renderToolbar({
      onToggleBookmark: undefined,
      onToggleBookmarks: undefined,
      onToggleHighlights: undefined,
    })
    expect(screen.queryByLabelText('Bookmark this page')).toBeNull()
    expect(screen.queryByLabelText('Open bookmarks')).toBeNull()
    expect(screen.queryByLabelText('Open highlights')).toBeNull()
  })
})
