import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useFlipbook } from '../hooks/useFlipbook'
import { useReaderPreferences } from '../hooks/useReaderPreferences'
import { useAudioReader } from '../hooks/useAudioReader'
import { useHighlights, resolveXPath, type Highlight } from '../hooks/useHighlights'
import { useBookmarks } from '../hooks/useBookmarks'
import { useEPUBLoader } from '../hooks/useEPUBLoader'
import { useReaderNavigation } from '../hooks/useReaderNavigation'
import { useReadingPosition } from '../hooks/useReadingPosition'
import { readerLog } from '../reader/readerLogger'
import { ReaderToolbar } from './reader/ReaderToolbar'
import { FlipbookContainer } from './reader/FlipbookContainer'
import { BottomBar } from './reader/BottomBar'
import { AudioBar } from './reader/AudioBar'
import { HighlightPopup } from './reader/HighlightPopup'
import { HighlightsSidebar } from './reader/HighlightsSidebar'
import { BookmarksSidebar } from './reader/BookmarksSidebar'
import '../styles/ReaderTheme.css'
import '../styles/ReaderFlipbook.css'
import '../styles/ReaderHighlights.css'

interface ContentReaderProps {
  epubUrl: string
  bookTitle: string
  contentKey: string
  onClose: () => void
}

export function ContentReader({
  epubUrl,
  bookTitle,
  contentKey,
  onClose,
}: ContentReaderProps) {
  // Sidebar toggles
  const [highlightsSidebarOpen, setHighlightsSidebarOpen] = useState(false)
  const [bookmarksSidebarOpen, setBookmarksSidebarOpen] = useState(false)

  // Highlight popup state
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const pendingRangeRef = useRef<Range | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // --- Extracted hooks ---
  const { html, loading, error, readingTime, handleRetry } = useEPUBLoader(epubUrl, contentKey)

  const prefs = useReaderPreferences()
  const audio = useAudioReader()
  const flipbook = useFlipbook({ contentRef, viewportRef })
  const {
    currentPage,
    totalPages,
    chapterInfo,
    flipNext,
    flipPrev,
    flipTo,
    paginate,
    progressPercent,
  } = flipbook

  const { handleTouchStart, handleTouchEnd } = useReaderNavigation({
    flipNext,
    flipPrev,
    flipTo,
    totalPages,
  })

  // Hooks for highlights and bookmarks
  const {
    highlights,
    addHighlight,
    removeHighlight,
    updateNote,
    renderHighlights,
  } = useHighlights(contentKey)

  const {
    bookmarks,
    toggleBookmark,
    isBookmarked,
    removeBookmark,
  } = useBookmarks(contentKey)

  // --- Paginate after content is rendered ---
  useLayoutEffect(() => {
    if (html && !loading && !error) {
      const frameId = requestAnimationFrame(() => {
        paginate()
        // Re-apply highlights after repagination
        if (contentRef.current) {
          renderHighlights(contentRef.current)
        }
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [html, loading, error, paginate, prefs.fontSize, prefs.lineHeight, prefs.margins, renderHighlights])

  // --- Reading position restore + auto-save ---
  useReadingPosition({ contentKey, currentPage, totalPages, flipTo })

  // --- Text selection handling for highlight popup ---
  useEffect(() => {
    const handleSelectionEnd = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        return
      }

      const range = sel.getRangeAt(0)
      if (
        !contentRef.current ||
        !contentRef.current.contains(range.commonAncestorContainer)
      ) {
        return
      }

      const text = range.toString().trim()
      if (!text) return

      pendingRangeRef.current = range.cloneRange()

      const rect = range.getBoundingClientRect()
      const readerEl = contentRef.current.closest('.nclex-reader')
      const readerRect = readerEl
        ? readerEl.getBoundingClientRect()
        : { left: 0, top: 0 }

      setPopupPosition({
        left: Math.max(8, rect.left + rect.width / 2 - 65 - readerRect.left),
        top: Math.max(8, rect.top - 48 - readerRect.top),
      })
    }

    const handleMouseUp = () => {
      setTimeout(handleSelectionEnd, 10)
    }

    const handleTouchEndSelection = () => {
      setTimeout(handleSelectionEnd, 300)
    }

    const el = contentRef.current
    if (!el) return

    el.addEventListener('mouseup', handleMouseUp)
    el.addEventListener('touchend', handleTouchEndSelection)

    return () => {
      el.removeEventListener('mouseup', handleMouseUp)
      el.removeEventListener('touchend', handleTouchEndSelection)
    }
  }, [html, loading, error])

  const handleHighlightColor = useCallback(
    (color: 'yellow' | 'green' | 'blue' | 'pink') => {
      if (!pendingRangeRef.current || !contentRef.current) return
      addHighlight(pendingRangeRef.current, color, contentRef.current)
      window.getSelection()?.removeAllRanges()
      pendingRangeRef.current = null
    },
    [addHighlight],
  )

  const handlePopupClose = useCallback(() => {
    setPopupPosition(null)
    pendingRangeRef.current = null
  }, [])

  // --- Bookmark toggle for current page ---
  const handleToggleBookmark = useCallback(() => {
    const page1 = currentPage + 1 // 1-indexed
    toggleBookmark(page1)
  }, [currentPage, toggleBookmark])

  // --- Highlight sidebar navigation ---
  const handleHighlightNavigate = useCallback((hl: Highlight) => {
    if (contentRef.current) {
      const node = resolveXPath(hl.startXpath, contentRef.current)
      if (node) {
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement
        if (el) {
          const gap = parseInt(getComputedStyle(contentRef.current).columnGap) || 120
          const computed = getComputedStyle(contentRef.current)
          const padLeft = parseFloat(computed.paddingLeft) || 56
          const padRight = parseFloat(computed.paddingRight) || 56
          const viewportEl = viewportRef.current
          if (viewportEl) {
            const pageWidth = viewportEl.offsetWidth
            const colWidth = pageWidth - padLeft - padRight
            const page = Math.floor(el.offsetLeft / (colWidth + gap))
            flipTo(page)
          }
        }
      }
    }
    setHighlightsSidebarOpen(false)
  }, [flipTo])

  const handleHighlightDelete = useCallback(
    (id: string) => {
      removeHighlight(id, contentRef.current ?? undefined)
    },
    [removeHighlight],
  )

  // --- Bookmark sidebar navigation ---
  const handleBookmarkNavigate = useCallback(
    (page: number) => {
      flipTo(page - 1) // bookmarks are 1-indexed, flipTo is 0-indexed
      setBookmarksSidebarOpen(false)
    },
    [flipTo],
  )

  // Cleanup effect for book close
  useEffect(() => {
    return () => { readerLog.info('book.closed', { contentKey }) }
  }, [contentKey])

  // Set document title
  useEffect(() => {
    if (bookTitle) {
      document.title = bookTitle
    }
    return () => {
      document.title = 'NCLEX Trainer'
    }
  }, [bookTitle])

  return (
    <div
      className="nclex-reader"
      data-reader-theme={prefs.theme}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <ReaderToolbar
        prefs={prefs}
        onClose={onClose}
        readingTimeText={readingTime}
        isBookmarked={isBookmarked(currentPage + 1)}
        bookmarkCount={bookmarks.length}
        highlightCount={highlights.length}
        onToggleBookmark={handleToggleBookmark}
        onToggleBookmarks={() => setBookmarksSidebarOpen((o) => !o)}
        onToggleHighlights={() => setHighlightsSidebarOpen((o) => !o)}
        isTTSAvailable={audio.isAvailable}
        isListening={audio.isPlaying || audio.isPaused}
        onListen={() => {
          if (audio.isPlaying || audio.isPaused) {
            audio.stop()
          } else {
            // Extract only the visible page's content for TTS
            const content = contentRef.current
            const viewport = viewportRef.current
            if (!content || !viewport) return

            const computed = getComputedStyle(content)
            const padLeft = parseFloat(computed.paddingLeft) || 56
            const padRight = parseFloat(computed.paddingRight) || 56
            const colWidth = viewport.offsetWidth - padLeft - padRight

            // Walk only direct children of the column container.
            // offsetLeft on direct children is relative to the multi-column
            // container itself, which is reliable for column detection.
            const gap = parseInt(computed.columnGap) || 120
            const stepSize = colWidth + gap
            const pageStart = currentPage * stepSize
            const pageEnd = pageStart + colWidth

            const tempEl = document.createElement('div')
            for (const child of Array.from(content.children)) {
              const el = child as HTMLElement
              if (typeof el.offsetLeft !== 'number') continue
              if (el.offsetLeft >= pageStart && el.offsetLeft < pageEnd) {
                tempEl.appendChild(el.cloneNode(true))
              }
            }

            if (tempEl.textContent?.trim()) {
              audio.play(tempEl)
            } else {
              readerLog.warn('audio.no_page_content', { page: currentPage })
            }
          }
        }}
      />

      {loading ? (
        <div className="reader-loading">Loading&hellip;</div>
      ) : error ? (
        <div className="reader-error">
          <p>{error}</p>
          <button className="error-retry" onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <FlipbookContainer
            html={html}
            prefs={prefs}
            flipbook={flipbook}
            viewportRef={viewportRef}
            contentRef={contentRef}
          />
          <HighlightPopup
            position={popupPosition}
            onHighlight={handleHighlightColor}
            onClose={handlePopupClose}
          />
        </>
      )}

      {!loading && !error && (
        <BottomBar
          currentPage={currentPage}
          totalPages={totalPages}
          progressPercent={progressPercent}
          chapterInfo={chapterInfo}
        />
      )}

      {!loading && !error && (
        <AudioBar audio={audio} contentRef={contentRef} />
      )}

      <HighlightsSidebar
        highlights={highlights}
        isOpen={highlightsSidebarOpen}
        onClose={() => setHighlightsSidebarOpen(false)}
        onNavigate={handleHighlightNavigate}
        onDelete={handleHighlightDelete}
        onUpdateNote={updateNote}
      />

      <BookmarksSidebar
        bookmarks={bookmarks}
        isOpen={bookmarksSidebarOpen}
        onClose={() => setBookmarksSidebarOpen(false)}
        onNavigate={handleBookmarkNavigate}
        onDelete={removeBookmark}
      />
    </div>
  )
}
