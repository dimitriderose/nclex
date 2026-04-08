import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioReader } from '../../hooks/useAudioReader'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Mock SpeechSynthesisUtterance
class MockUtterance {
  text: string
  rate = 1
  pitch = 1
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}
Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, writable: true, configurable: true })

const mockSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  paused: false,
  getVoices: vi.fn(() => [
    { name: 'English', lang: 'en-US', voiceURI: 'en', default: true, localService: true } as SpeechSynthesisVoice,
  ]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}

describe('useAudioReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'speechSynthesis', { value: mockSynthesis, writable: true, configurable: true })
    mockSynthesis.getVoices.mockReturnValue([
      { name: 'English', lang: 'en-US', voiceURI: 'en', default: true, localService: true } as SpeechSynthesisVoice,
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isAvailable true when speechSynthesis exists', () => {
    const { result } = renderHook(() => useAudioReader())
    expect(result.current.isAvailable).toBe(true)
  })

  it('play calls speechSynthesis.speak', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello world.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    expect(mockSynthesis.speak).toHaveBeenCalled()
  })

  it('play does nothing when no voices', () => {
    mockSynthesis.getVoices.mockReturnValue([])
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('pause calls speechSynthesis.pause', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.pause())
    expect(mockSynthesis.pause).toHaveBeenCalled()
  })

  it('stop calls speechSynthesis.cancel and resets', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.stop())
    expect(mockSynthesis.cancel).toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentSentence).toBe(0)
  })

  it('cycleSpeed cycles through speed steps', () => {
    const { result } = renderHook(() => useAudioReader())
    expect(result.current.speed).toBe(1.0)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(1.25)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(1.5)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(1.75)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(2.0)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(0.75)
  })

  it('setVoice updates selected voice', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.setVoice('fr'))
    expect(result.current.selectedVoiceURI).toBe('fr')
  })

  it('skipForward advances to next sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First. Second. Third.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.skipForward())
    expect(result.current.currentSentence).toBe(1)
  })

  it('skipBackward goes to previous sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First. Second.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.skipForward())
    expect(result.current.currentSentence).toBe(1)
    act(() => result.current.skipBackward())
    expect(result.current.currentSentence).toBe(0)
  })

  it('cleanup cancels speech on unmount', () => {
    const { unmount } = renderHook(() => useAudioReader())
    unmount()
    expect(mockSynthesis.cancel).toHaveBeenCalled()
  })
})
