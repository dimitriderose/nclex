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

  it('play does nothing when contentEl is null', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(null))
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('play does nothing when element has no extractable text', () => {
    const el = document.createElement('div')
    el.innerHTML = '<script>console.log("hi")</script><style>.x{}</style>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    // extractSentences strips script/style, so no text remains
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('resume calls speechSynthesis.resume and sets isPlaying', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.pause())
    expect(result.current.isPaused).toBe(true)
    act(() => result.current.resume())
    expect(mockSynthesis.resume).toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(true)
    expect(result.current.isPaused).toBe(false)
  })

  it('cycleSpeed while playing restarts current sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First sentence. Second sentence.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    expect(result.current.isPlaying).toBe(true)

    const callCountBefore = mockSynthesis.speak.mock.calls.length
    act(() => result.current.cycleSpeed())
    // Should cancel and re-speak
    expect(mockSynthesis.cancel).toHaveBeenCalled()
    expect(mockSynthesis.speak.mock.calls.length).toBeGreaterThan(callCountBefore)
  })

  it('setVoice while playing restarts current sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello world.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))

    const callCountBefore = mockSynthesis.speak.mock.calls.length
    act(() => result.current.setVoice('fr'))
    // Should cancel and re-speak
    expect(mockSynthesis.cancel).toHaveBeenCalled()
    expect(mockSynthesis.speak.mock.calls.length).toBeGreaterThan(callCountBefore)
  })

  it('utterance onend advances to next sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First. Second.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))

    // Get the utterance and trigger onend
    const utterance = mockSynthesis.speak.mock.calls[0][0] as MockUtterance
    act(() => utterance.onend?.())
    expect(result.current.currentSentence).toBe(1)
  })

  it('utterance onend after last sentence resets state', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Only sentence.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    expect(result.current.totalSentences).toBe(1)

    // Trigger onend for the only sentence
    const utterance = mockSynthesis.speak.mock.calls[0][0] as MockUtterance
    act(() => utterance.onend?.())
    // speakSentence(1) is called which is >= length, so it finishes
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentSentence).toBe(0)
  })

  it('utterance onerror resets state for non-canceled errors', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello world.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))

    const utterance = mockSynthesis.speak.mock.calls[0][0] as MockUtterance
    act(() => utterance.onerror?.({ error: 'synthesis-failed' }))
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.totalSentences).toBe(0)
  })

  it('utterance onerror ignores canceled errors', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello world.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))

    const utterance = mockSynthesis.speak.mock.calls[0][0] as MockUtterance
    act(() => utterance.onerror?.({ error: 'canceled' }))
    // Should still be playing (error ignored)
    expect(result.current.isPlaying).toBe(true)
  })

  it('skipForward at last sentence stays at last', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Only.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.skipForward())
    expect(result.current.currentSentence).toBe(0)
  })

  it('skipBackward at first sentence stays at 0', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First. Second.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.skipBackward())
    expect(result.current.currentSentence).toBe(0)
  })

  it('skipForward/skipBackward are no-ops when no sentences', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.skipForward())
    act(() => result.current.skipBackward())
    expect(result.current.currentSentence).toBe(0)
  })

  it('extracts sentences correctly with multiple punctuation types', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Question? Exclaim! Statement. Done</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    expect(result.current.totalSentences).toBeGreaterThanOrEqual(3)
  })
})
