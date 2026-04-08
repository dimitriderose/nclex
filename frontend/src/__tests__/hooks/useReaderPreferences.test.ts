import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReaderPreferences } from '../../hooks/useReaderPreferences'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('useReaderPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns correct defaults', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.fontSize).toBe(20)
    expect(result.current.isSerif).toBe(true)
    expect(result.current.lineHeightPreset).toBe('default')
    expect(result.current.marginPreset).toBe('default')
    expect(result.current.theme).toBe('')
  })

  it('reads valid fontSize from localStorage', () => {
    localStorage.setItem('reader-fs', '24')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.fontSize).toBe(24)
  })

  it('ignores invalid fontSize and uses default', () => {
    localStorage.setItem('reader-fs', 'abc')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.fontSize).toBe(20)
  })

  it('reads serif/sans from localStorage', () => {
    localStorage.setItem('reader-font', 'sans')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.isSerif).toBe(false)
  })

  it('reads valid theme from localStorage', () => {
    localStorage.setItem('reader-theme', 'dark')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.theme).toBe('dark')
  })

  it('ignores invalid theme and uses fallback', () => {
    localStorage.setItem('reader-theme', 'neon')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.theme).toBe('')
  })

  it('increaseFontSize adds 2 and persists', () => {
    const { result } = renderHook(() => useReaderPreferences())
    act(() => result.current.increaseFontSize())
    expect(result.current.fontSize).toBe(22)
    expect(localStorage.getItem('reader-fs')).toBe('22')
  })

  it('decreaseFontSize subtracts 2 and persists', () => {
    const { result } = renderHook(() => useReaderPreferences())
    act(() => result.current.decreaseFontSize())
    expect(result.current.fontSize).toBe(18)
    expect(localStorage.getItem('reader-fs')).toBe('18')
  })

  it('fontSize clamps at max 36 and min 14', () => {
    localStorage.setItem('reader-fs', '36')
    const { result } = renderHook(() => useReaderPreferences())
    act(() => result.current.increaseFontSize())
    expect(result.current.fontSize).toBe(36)

    localStorage.setItem('reader-fs', '14')
    const { result: result2 } = renderHook(() => useReaderPreferences())
    act(() => result2.current.decreaseFontSize())
    expect(result2.current.fontSize).toBe(14)
  })

  it('toggleFont flips isSerif and persists', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.isSerif).toBe(true)
    act(() => result.current.toggleFont())
    expect(result.current.isSerif).toBe(false)
    expect(localStorage.getItem('reader-font')).toBe('sans')
  })

  it('cycleLineHeight cycles compact -> default -> relaxed -> compact', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.lineHeightPreset).toBe('default')
    act(() => result.current.cycleLineHeight())
    expect(result.current.lineHeightPreset).toBe('relaxed')
    act(() => result.current.cycleLineHeight())
    expect(result.current.lineHeightPreset).toBe('compact')
    act(() => result.current.cycleLineHeight())
    expect(result.current.lineHeightPreset).toBe('default')
  })

  it('cycleMargin cycles narrow -> default -> wide -> narrow', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.marginPreset).toBe('default')
    act(() => result.current.cycleMargin())
    expect(result.current.marginPreset).toBe('wide')
    act(() => result.current.cycleMargin())
    expect(result.current.marginPreset).toBe('narrow')
    act(() => result.current.cycleMargin())
    expect(result.current.marginPreset).toBe('default')
  })

  it('setTheme updates and persists', () => {
    const { result } = renderHook(() => useReaderPreferences())
    act(() => result.current.setTheme('sepia'))
    expect(result.current.theme).toBe('sepia')
    expect(localStorage.getItem('reader-theme')).toBe('sepia')
  })

  it('lineHeight returns correct value for serif + default', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.lineHeight).toBe(1.72)
  })

  it('lineHeight changes for sans', () => {
    localStorage.setItem('reader-font', 'sans')
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.lineHeight).toBe(1.65)
  })

  it('margins returns correct desktop/mobile pair', () => {
    const { result } = renderHook(() => useReaderPreferences())
    expect(result.current.margins).toEqual({ desktop: 56, mobile: 20 })
  })
})
