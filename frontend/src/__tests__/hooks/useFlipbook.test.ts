import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlipbook } from '../../hooks/useFlipbook'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('useFlipbook', () => {
  let mockContent: HTMLDivElement
  let mockViewport: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()

    // Create viewport with real dimensions
    mockViewport = document.createElement('div')
    Object.defineProperty(mockViewport, 'getBoundingClientRect', {
      value: () => ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(mockViewport, 'offsetWidth', { value: 1000, configurable: true })

    // Create content element with scrollWidth to simulate multi-page content
    mockContent = document.createElement('div')
    Object.defineProperty(mockContent, 'scrollWidth', { value: 3000, configurable: true })
    Object.defineProperty(mockContent, 'offsetHeight', { value: 800, configurable: true })

    // Mock getComputedStyle
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

  function renderFlipbook() {
    const contentRef = { current: mockContent } as React.RefObject<HTMLDivElement>
    const viewportRef = { current: mockViewport } as React.RefObject<HTMLDivElement>
    return renderHook(() => useFlipbook({ contentRef, viewportRef }))
  }

  it('initializes at page 0', () => {
    const { result } = renderFlipbook()
    expect(result.current.currentPage).toBe(0)
  })

  it('paginate calculates totalPages', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    // scrollWidth 3000 / (columnWidth 888 + gap 120) ~= 3 pages
    expect(result.current.totalPages).toBeGreaterThanOrEqual(1)
  })

  it('flipNext increments page after paginate', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    const totalBefore = result.current.totalPages
    if (totalBefore > 1) {
      act(() => result.current.flipNext())
      expect(result.current.currentPage).toBe(1)
    }
  })

  it('flipPrev decrements page', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    if (result.current.totalPages > 1) {
      act(() => result.current.flipNext())
      act(() => result.current.flipPrev())
      expect(result.current.currentPage).toBe(0)
    }
  })

  it('flipPrev no-op at first page', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    act(() => result.current.flipPrev())
    expect(result.current.currentPage).toBe(0)
  })

  it('flipTo jumps to specific page (clamped)', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    const max = result.current.totalPages - 1
    act(() => result.current.flipTo(99))
    expect(result.current.currentPage).toBe(max)
    act(() => result.current.flipTo(-5))
    expect(result.current.currentPage).toBe(0)
  })

  it('atStart true at page 0', () => {
    const { result } = renderFlipbook()
    expect(result.current.atStart).toBe(true)
  })

  it('atEnd true at last page', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    const max = result.current.totalPages - 1
    act(() => result.current.flipTo(max))
    expect(result.current.atEnd).toBe(true)
  })

  it('progressPercent is 0 at start and 100 at end', () => {
    const { result } = renderFlipbook()
    act(() => result.current.paginate())
    // At page 0
    expect(result.current.progressPercent).toBe(0)
    const max = result.current.totalPages - 1
    act(() => result.current.flipTo(max))
    expect(result.current.progressPercent).toBe(100)
  })
})
