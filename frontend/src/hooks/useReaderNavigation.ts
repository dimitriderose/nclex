import { useCallback, useEffect, useRef } from 'react'

export interface UseReaderNavigationOptions {
  flipNext: () => void
  flipPrev: () => void
  flipTo: (page: number) => void
  totalPages: number
}

export function useReaderNavigation({
  flipNext,
  flipPrev,
  flipTo,
  totalPages,
}: UseReaderNavigationOptions) {
  const touchStartX = useRef(0)

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
      if (sel && sel.toString().trim()) return // user is selecting text, don't flip
      const deltaX = e.changedTouches[0].clientX - touchStartX.current
      if (deltaX > 40) {
        flipPrev()
      } else if (deltaX < -40) {
        flipNext()
      }
    },
    [flipNext, flipPrev],
  )

  return { handleTouchStart, handleTouchEnd }
}
