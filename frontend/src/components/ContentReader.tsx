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
import { parseEpub } from '../reader/epubParser'
import { readerLog } from '../reader/readerLogger'
import { api } from '../services/api'
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

const WORDS_PER_MINUTE = 238
const POSITION_SAVE_DEBOUNCE_MS = 1500

function estimateReadingTime(text: string): string {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.ceil(wordCount / WORDS_PER_MINUTE)
  if (minutes < 1) return '~1 min read'
  return `~${minutes} min read`
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

export function ContentReader({
  epubUrl,
  bookTitle,
  contentKey,
  onClose,
}: ContentReaderProps) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readingTime, setReadingTime] = useState<string | undefined>(undefined)
  const [retryCount, setRetryCount] = useState(0)
  const [positionRestored, setPositionRestored] = useState(false)

  // Sidebar toggles
  const [highlightsSidebarOpen, setHighlightsSidebarOpen] = useState(false)
  const [bookmarksSidebarOpen, setBookmarksSidebarOpen] = useState(false)

  // Highlight popup state
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const pendingRangeRef = useRef<Range | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // --- Fetch and parse EPUB ---
  const loadEpub = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(epubUrl, { signal })
        if (!response.ok) {
          readerLog.error('book.fetch_failed', new Error('HTTP ' + response.status), { epubUrl })
          throw new Error(`Failed to fetch EPUB (${response.status})`)
        }
        const contentLength = parseInt(response.headers.get('content-length') || '0')
        if (contentLength > 200 * 1024 * 1024) {
          readerLog.error('book.too_large', new Error('File too large'), { contentLength })
          throw new Error('This book is too large to open (max 200 MB)')
        }
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 200 * 1024 * 1024) {
          readerLog.error('book.too_large', new Error('File too large'), { size: buffer.byteLength })
          throw new Error('This book is too large to open (max 200 MB)')
        }
        const result = await parseEpub(buffer)
        if (signal.aborted) return

        setHtml(result.html)
        readerLog.info('book.opened', { contentKey, title: result.title })
        setReadingTime(estimateReadingTime(stripHtmlTags(result.html)))
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message =
          err instanceof Error ? err.message : 'Unknown error loading book'
        readerLog.error('book.load_failed', err, { epubUrl, contentKey })
        setError(message)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [epubUrl, contentKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadEpub(controller.signal)
    return () => controller.abort()
  }, [loadEpub, retryCount])

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

  // --- Restore reading position from API ---
  useEffect(() => {
    if (totalPages <= 0 || positionRestored) return

    let cancelled = false
    api
      .getReadingPosition(contentKey)
      .then((pos) => {
        if (cancelled || !pos) return
        const saved = pos.position as { page?: number }
        if (typeof saved?.page === 'number' && saved.page >= 0) {
          flipTo(saved.page)
          readerLog.info('reading_position.restored', {
            contentKey,
            page: saved.page,
          })
        }
      })
      .catch((err) => {
        readerLog.error('reading_position.restore_failed', err, { contentKey })
      })
      .finally(() => {
        if (!cancelled) setPositionRestored(true)
      })

    return () => {
      cancelled = true
    }
  }, [contentKey, totalPages, positionRestored, flipTo])

  // --- Auto-save position with debounce ---
  useEffect(() => {
    if (!positionRestored || totalPages <= 0) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      api
        .setReadingPosition(contentKey, { page: currentPage, totalPages })
        .then(() => {
          readerLog.debug('reading_position.saved', {
            contentKey,
            page: currentPage,
            totalPages,
          })
        })
        .catch((err) => {
          readerLog.error('reading_position.save_failed', err, {
            contentKey,
            page: currentPage,
          })
        })
    }, POSITION_SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [currentPage, totalPages, contentKey, positionRestored])

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

  // --- Keyboard navigation ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'BUTTON'
      ) {
        return
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault()
          flipNext()
          break
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          flipPrev()
          break
        case 'Home':
          e.preventDefault()
          flipTo(0)
          break
        case 'End':
          e.preventDefault()
          flipTo(totalPages - 1)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [flipNext, flipPrev, flipTo, totalPages])

  // --- Touch navigation ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const sel = window.getSelection()
      if (sel && sel.toString().trim()) return  // user is selecting text, don't flip
      const deltaX = e.changedTouches[0].clientX - touchStartX.current
      if (deltaX > 40) {
        flipPrev()
      } else if (deltaX < -40) {
        flipNext()
      }
    },
    [flipNext, flipPrev],
  )

  // --- Retry handler ---
  const handleRetry = useCallback(() => {
    setRetryCount((c) => {
      readerLog.info('book.retry', { retryCount: c + 1 })
      return c + 1
    })
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
