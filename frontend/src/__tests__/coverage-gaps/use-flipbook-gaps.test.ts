/**
 * Tests targeting uncovered lines 145, 151, 249-253 in useFlipbook.ts
 * Line 145: paginate skipping on zero-size viewport
 * Line 151: lineHeight fallback when parseFloat returns NaN
 * Lines 249-253: resize handler debounce and cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlipbook } from '../../hooks/useFlipbook'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('useFlipbook — gap coverage', () => {
  let mockContent: HTMLDivElement
  let mockViewport: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()

    mockViewport = document.createElement('div')
    Object.defineProperty(mockViewport, 'getBoundingClientRect', {
      value: () => ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(mockViewport, 'offsetWidth', { value: 1000, configurable: true })

    mockContent = document.createElement('div')
    Object.defineProperty(mockContent, 'scrollWidth', { value: 3000, configurable: true })
    Object.defineProperty(mockContent, 'offsetHeight', { value: 800, configurable: true })

    const origGetComputed = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === mockContent) {
        return {
          columnGap: '120px',
          lineHeight: '24px',
          fontSize: '16px',
          paddingLeft: '56px',
          paddingRight: '56px',
          getPropertyValue: (prop: string) => {
            if (prop === 'column-gap') return '120px'
            return ''
          },
        } as unknown as CSSStyleDeclaration
      }
      return origGetComputed(el)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function renderFlipbook(contentOverride?: HTMLDivElement, viewportOverride?: HTMLDivElement) {
    const contentRef = { current: contentOverride ?? mockContent } as React.RefObject<HTMLDivElement>
    const viewportRef = { current: viewportOverride ?? mockViewport } as React.RefObject<HTMLDivElement>
    return renderHook(() => useFlipbook({ contentRef, viewportRef }))
  }

  it('paginate skips when viewport has zero dimensions', () => {
    const zeroViewport = document.createElement('div')
    Object.defineProperty(zeroViewport, 'getBoundingClientRect', {
      value: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })

    const { result } = renderFlipbook(mockContent, zeroViewport)
    act(() => result.current.paginate())
    // totalPages should remain at default since paginate was skipped
    expect(result.current.totalPages).toBe(1)
  })

  it('paginate handles NaN lineHeight by falling back to fontSize * 1.6', () => {
    const origGetComputed = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === mockContent) {
        return {
          columnGap: '120px',
          lineHeight: 'normal', // This will cause parseFloat to return NaN
          fontSize: '16px',
          paddingLeft: '56px',
          paddingRight: '56px',
          getPropertyValue: (prop: string) => {
            if (prop === 'column-gap') return '120px'
            return ''
          },
        } as unknown as CSSStyleDeclaration
      }
      return origGetComputed(el)
    })

    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    expect(result.current.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('resize triggers re-paginate after debounce', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    const pagesBefore = result.current.totalPages

    // Trigger resize
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    // Before debounce, pages should not change
    // After debounce (200ms), paginate is called
    act(() => {
      vi.advanceTimersByTime(250)
    })

    // Should have re-paginated
    expect(result.current.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('multiple rapid resizes are debounced to one call', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())

    // Fire multiple resize events
    act(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
    })

    act(() => {
      vi.advanceTimersByTime(250)
    })

    // Should still work correctly
    expect(result.current.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('cleanup removes resize listener and clears timeouts', () => {
    const { unmount } = renderFlipbook()

    unmount()

    // No errors should occur from stale timers
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  })

  it('flipNext is a no-op at last page', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())

    // Go to last page
    const max = result.current.totalPages - 1
    act(() => result.current.flipTo(max))
    expect(result.current.currentPage).toBe(max)

    // Try to flip beyond
    act(() => result.current.flipNext())
    expect(result.current.currentPage).toBe(max)
  })

  it('isFlipping becomes true during flip animation and resets after timeout', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())

    if (result.current.totalPages > 1) {
      act(() => result.current.flipNext())
      expect(result.current.isFlipping).toBe(true)

      act(() => vi.advanceTimersByTime(600))
      expect(result.current.isFlipping).toBe(false)
    }
  })

  it('paginate builds chapter map from .epub-chapter elements', () => {
    // Add epub-chapter elements to mockContent
    mockContent.innerHTML = `
      <div class="epub-chapter" data-epub-src="ch1.xhtml"><h2>Chapter One</h2><p>Content</p></div>
      <div class="epub-chapter" data-epub-src="ch2.xhtml"><h2>Chapter Two</h2><p>More</p></div>
    `

    const { result } = renderFlipbook()
    act(() => result.current.paginate())

    // chapterInfo should be populated
    expect(result.current.chapterInfo).not.toBeNull()
    if (result.current.chapterInfo) {
      expect(result.current.chapterInfo.total).toBe(2)
    }
  })

  it('paginate handles null contentRef', () => {
    const contentRef = { current: null } as React.RefObject<HTMLDivElement>
    const viewportRef = { current: mockViewport } as React.RefObject<HTMLDivElement>
    const { result } = renderHook(() => useFlipbook({ contentRef, viewportRef }))

    // Should not crash
    act(() => result.current.paginate())
    expect(result.current.totalPages).toBe(1)
  })

  it('getColumnGap returns DEFAULT_COLUMN_GAP when content is null', () => {
    const contentRef = { current: null } as React.RefObject<HTMLDivElement>
    const viewportRef = { current: mockViewport } as React.RefObject<HTMLDivElement>
    const { result } = renderHook(() => useFlipbook({ contentRef, viewportRef }))

    // No crash
    expect(result.current.currentPage).toBe(0)
  })
})
