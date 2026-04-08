import { useCallback, type RefObject } from 'react'
import type { useFlipbook } from '../../hooks/useFlipbook'
import type { useReaderPreferences } from '../../hooks/useReaderPreferences'

interface FlipbookContainerProps {
  html: string
  prefs: ReturnType<typeof useReaderPreferences>
  flipbook: ReturnType<typeof useFlipbook>
  viewportRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
}

export function FlipbookContainer({
  html,
  prefs,
  flipbook,
  viewportRef,
  contentRef,
}: FlipbookContainerProps) {
  const { fontSize, lineHeight, fontFamily, margins } = prefs
  const marginPx = window.innerWidth <= 640 ? margins.mobile : margins.desktop
  const { isFlipping, flipNext, flipPrev, flipTo, atStart, atEnd } = flipbook

  // Navigate to a DOM element's page in the flipbook
  const navigateToElement = useCallback((el: HTMLElement, content: HTMLElement) => {
    const gap = parseInt(getComputedStyle(content).columnGap) || 120
    const computed = getComputedStyle(content)
    const padLeft = parseFloat(computed.paddingLeft) || 56
    const padRight = parseFloat(computed.paddingRight) || 56
    const viewportEl = viewportRef.current
    if (!viewportEl) return
    const colWidth = viewportEl.offsetWidth - padLeft - padRight
    const stepSize = colWidth + gap
    if (stepSize <= 0) return
    const page = Math.floor(el.offsetLeft / stepSize)
    flipTo(page)
  }, [viewportRef, flipTo])

  // Handle clicks on links inside EPUB content
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href) return

    // External link — set target and let browser handle it naturally
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
      return
    }

    // Internal link — prevent default navigation
    e.preventDefault()

    const content = contentRef.current
    if (!content) return

    // Parse href into file part and fragment
    const hashIndex = href.indexOf('#')
    const filePart = hashIndex >= 0 ? href.substring(0, hashIndex) : href
    const fragment = hashIndex >= 0 ? href.substring(hashIndex + 1) : ''

    let targetEl: HTMLElement | null = null

    // Try fragment ID first (most specific)
    if (fragment) {
      const el = document.getElementById(fragment)
      if (el && content.contains(el)) {
        targetEl = el
      }
    }

    // If no fragment match, find the chapter div by file path
    if (!targetEl && filePart) {
      // Try exact match on data-epub-src
      targetEl = content.querySelector(
        `.epub-chapter[data-epub-src="${filePart}"]`
      )

      // Try matching by filename (last path segment) for relative links
      if (!targetEl) {
        const fileName = filePart.split('/').pop()
        const chapters = content.querySelectorAll('.epub-chapter[data-epub-src]')
        for (const ch of chapters) {
          const src = (ch as HTMLElement).dataset.epubSrc
          if (src === fileName || src?.endsWith('/' + fileName)) {
            targetEl = ch as HTMLElement
            break
          }
        }
      }
    }

    if (targetEl) {
      navigateToElement(targetEl, content)
    }
  }, [contentRef, navigateToElement])

  return (
    <div className="flipbook">
      <div className="flipbook-page">
        <div className="flipbook-viewport" ref={viewportRef}>
          <div
            className="flipbook-content"
            ref={contentRef}
            onClick={handleContentClick}
            style={{
              fontSize: `${fontSize}px`,
              lineHeight,
              fontFamily,
              paddingLeft: `${marginPx}px`,
              paddingRight: `${marginPx}px`,
              ['--reader-fs' as string]: `${fontSize}px`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>

        <div
          className={`flip-zone flip-prev${atStart ? ' at-boundary' : ''}`}
          onClick={flipPrev}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipPrev(); } }}
          role="button"
          tabIndex={0}
          aria-label="Previous page"
        />
        <div
          className={`flip-zone flip-next${atEnd ? ' at-boundary' : ''}`}
          onClick={flipNext}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipNext(); } }}
          role="button"
          tabIndex={0}
          aria-label="Next page"
        />

        <div className={`page-shadow${isFlipping ? ' flipping' : ''}`} />
        <div className={`page-curl${atEnd ? ' at-boundary' : ''}`} />
      </div>
    </div>
  )
}
