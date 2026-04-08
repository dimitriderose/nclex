import type { useReaderPreferences, ReaderTheme } from '../../hooks/useReaderPreferences'

interface ReaderToolbarProps {
  prefs: ReturnType<typeof useReaderPreferences>
  onClose: () => void
  readingTimeText?: string
  isBookmarked?: boolean
  bookmarkCount?: number
  highlightCount?: number
  onToggleBookmark?: () => void
  onToggleBookmarks?: () => void
  onToggleHighlights?: () => void
  onListen?: () => void
  isListening?: boolean
  isTTSAvailable?: boolean
}

const THEME_COLORS: { name: ReaderTheme; label: string; color: string }[] = [
  { name: '', label: 'Light', color: '#FAFAF7' },
  { name: 'sepia', label: 'Sepia', color: '#F2E8D5' },
  { name: 'dark', label: 'Dark', color: '#1A1A1A' },
  { name: 'night', label: 'Night', color: '#1C1810' },
]

const SPACING_LABELS: Record<string, string> = {
  compact: 'Tight',
  default: 'Spacing',
  relaxed: 'Loose',
}

const MARGIN_LABELS: Record<string, string> = {
  narrow: 'Narrow',
  default: 'Margins',
  wide: 'Wide',
}

export function ReaderToolbar({
  prefs,
  onClose,
  readingTimeText,
  isBookmarked = false,
  bookmarkCount = 0,
  highlightCount = 0,
  onToggleBookmark,
  onToggleBookmarks,
  onToggleHighlights,
  onListen,
  isListening = false,
  isTTSAvailable = false,
}: ReaderToolbarProps) {
  const {
    fontSize,
    isSerif,
    lineHeightPreset,
    marginPreset,
    theme,
    increaseFontSize,
    decreaseFontSize,
    toggleFont,
    cycleLineHeight,
    cycleMargin,
    setTheme,
  } = prefs

  const handleFullscreen = () => {
    if (!document.fullscreenEnabled) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }

  return (
    <div className="reader-toolbar">
      <button className="tb-toggle" onClick={onClose} aria-label="Library">
        ← Library
      </button>

      <span className="tb-divider" />

      <button className="tb-btn" onClick={decreaseFontSize} aria-label="Decrease font size">
        −
      </button>
      <span className="tb-val">{fontSize}</span>
      <button className="tb-btn" onClick={increaseFontSize} aria-label="Increase font size">
        +
      </button>

      <span className="tb-divider" />

      <button className="tb-toggle" onClick={toggleFont}>
        {isSerif ? 'Serif' : 'Sans'}
      </button>

      <span className="tb-divider" />

      <button className="tb-toggle" onClick={cycleLineHeight}>
        {SPACING_LABELS[lineHeightPreset] ?? 'Spacing'}
      </button>

      <span className="tb-divider" />

      <button className="tb-toggle" onClick={cycleMargin}>
        {MARGIN_LABELS[marginPreset] ?? 'Margins'}
      </button>

      <span className="tb-divider" />

      <span className="tb-label" id="readingTime">
        {readingTimeText ?? ''}
      </span>

      {isTTSAvailable && onListen && (
        <>
          <span className="tb-divider" />
          <button
            className={`tb-toggle${isListening ? ' active' : ''}`}
            onClick={onListen}
            aria-label={isListening ? 'Stop listening' : 'Listen'}
          >
            {isListening ? '⏹ Stop' : '🔊 Listen'}
          </button>
        </>
      )}

      <span className="tb-divider" />

      <span className="theme-dots">
        {THEME_COLORS.map((t) => (
          <button
            key={t.label}
            className={`theme-dot${theme === t.name ? ' active' : ''}`}
            style={{ backgroundColor: t.color }}
            onClick={() => setTheme(t.name)}
            aria-label={`Theme: ${t.label}`}
          />
        ))}
      </span>

      <span className="tb-divider" />

      {document.fullscreenEnabled && (
        <button className="tb-btn" onClick={handleFullscreen} aria-label="Toggle fullscreen">
          ⛶
        </button>
      )}

      {(onToggleBookmark || onToggleBookmarks || onToggleHighlights) && (
        <>
          <span className="tb-divider" />

          {onToggleBookmark && (
            <button
              className={`tb-btn${isBookmarked ? ' active' : ''}`}
              onClick={onToggleBookmark}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            >
              {isBookmarked ? '⚑' : '⚐'}
            </button>
          )}

          {onToggleBookmarks && (
            <button
              className="tb-btn"
              onClick={onToggleBookmarks}
              aria-label="Open bookmarks"
              title={`Bookmarks (${bookmarkCount})`}
            >
              ☰
              {bookmarkCount > 0 && <span className="tb-badge">{bookmarkCount}</span>}
            </button>
          )}

          {onToggleHighlights && (
            <button
              className="tb-btn"
              onClick={onToggleHighlights}
              aria-label="Open highlights"
              title={`Highlights (${highlightCount})`}
            >
              ✎
              {highlightCount > 0 && <span className="tb-badge">{highlightCount}</span>}
            </button>
          )}
        </>
      )}
    </div>
  )
}
