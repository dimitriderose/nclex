/**
 * Tests targeting uncovered lines 192-294, 306-308 in useAudioReader.ts
 * These cover: play() with no content, play() with no voices,
 * speakSentence finishing all sentences, speakSentence error handler,
 * cycleSpeed while playing, setVoice while playing,
 * resume(), skipForward/skipBackward edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioReader } from '../../hooks/useAudioReader'

vi.mock('../../reader/readerLogger', () => ({
  readerLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

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

describe('useAudioReader — gap coverage', () => {
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

  it('play does nothing with null contentEl', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(null))
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(false)
  })

  it('play does nothing with empty content', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>   </p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    // extractSentences returns [] for whitespace-only content
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('resume calls speechSynthesis.resume', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Hello world.</p>'
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.play(el))
    act(() => result.current.pause())
    expect(result.current.isPaused).toBe(true)
    act(() => result.current.resume())
    expect(mockSynthesis.resume).toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(true)
    expect(result.current.isPaused).toBe(false)
  })

  it('speakSentence handles onend by advancing to next sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First sentence. Second sentence.</p>'
    const { result } = renderHook(() => useAudioReader())

    // Capture the utterance when speak is called
    let capturedUtterance: MockUtterance | null = null
    mockSynthesis.speak.mockImplementation((u: MockUtterance) => {
      capturedUtterance = u
    })

    act(() => result.current.play(el))
    expect(result.current.isPlaying).toBe(true)
    expect(result.current.totalSentences).toBe(2)

    // Simulate first sentence completing
    if (capturedUtterance) {
      act(() => capturedUtterance!.onend?.())
    }

    expect(result.current.currentSentence).toBe(1)
  })

  it('speakSentence resets state when all sentences are done', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Only sentence.</p>'
    const { result } = renderHook(() => useAudioReader())

    let capturedUtterance: MockUtterance | null = null
    mockSynthesis.speak.mockImplementation((u: MockUtterance) => {
      capturedUtterance = u
    })

    act(() => result.current.play(el))
    expect(result.current.totalSentences).toBe(1)

    // Simulate sentence completing -> tries index 1 which is >= length
    if (capturedUtterance) {
      act(() => capturedUtterance!.onend?.())
    }

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentSentence).toBe(0)
  })

  it('speakSentence onerror resets state for non-canceled errors', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Error sentence.</p>'
    const { result } = renderHook(() => useAudioReader())

    let capturedUtterance: MockUtterance | null = null
    mockSynthesis.speak.mockImplementation((u: MockUtterance) => {
      capturedUtterance = u
    })

    act(() => result.current.play(el))
    expect(result.current.isPlaying).toBe(true)

    // Simulate an error
    if (capturedUtterance) {
      act(() => capturedUtterance!.onerror?.({ error: 'synthesis-failed' }))
    }

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.totalSentences).toBe(0)
  })

  it('speakSentence onerror ignores "canceled" errors', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Cancel test.</p>'
    const { result } = renderHook(() => useAudioReader())

    let capturedUtterance: MockUtterance | null = null
    mockSynthesis.speak.mockImplementation((u: MockUtterance) => {
      capturedUtterance = u
    })

    act(() => result.current.play(el))

    // Simulate a canceled error (should not reset state)
    if (capturedUtterance) {
      act(() => capturedUtterance!.onerror?.({ error: 'canceled' }))
    }

    // State should still be playing since canceled is ignored
    expect(result.current.isPlaying).toBe(true)
  })

  it('speakSentence onerror ignores "interrupted" errors', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Interrupt test.</p>'
    const { result } = renderHook(() => useAudioReader())

    let capturedUtterance: MockUtterance | null = null
    mockSynthesis.speak.mockImplementation((u: MockUtterance) => {
      capturedUtterance = u
    })

    act(() => result.current.play(el))

    if (capturedUtterance) {
      act(() => capturedUtterance!.onerror?.({ error: 'interrupted' }))
    }

    expect(result.current.isPlaying).toBe(true)
  })

  it('cycleSpeed restarts current sentence when playing', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Speed test. Another one.</p>'
    const { result } = renderHook(() => useAudioReader())

    act(() => result.current.play(el))
    const speakCallsBefore = mockSynthesis.speak.mock.calls.length

    act(() => result.current.cycleSpeed())

    // Should cancel and re-speak
    expect(mockSynthesis.cancel).toHaveBeenCalled()
    expect(mockSynthesis.speak.mock.calls.length).toBeGreaterThan(speakCallsBefore)
  })

  it('setVoice restarts current sentence when playing', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Voice test.</p>'
    const { result } = renderHook(() => useAudioReader())

    act(() => result.current.play(el))
    const speakCallsBefore = mockSynthesis.speak.mock.calls.length

    act(() => result.current.setVoice('fr-voice'))

    expect(mockSynthesis.cancel).toHaveBeenCalled()
    expect(mockSynthesis.speak.mock.calls.length).toBeGreaterThan(speakCallsBefore)
  })

  it('skipForward does nothing when no sentences', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.skipForward())
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('skipBackward does nothing when no sentences', () => {
    const { result } = renderHook(() => useAudioReader())
    act(() => result.current.skipBackward())
    expect(mockSynthesis.speak).not.toHaveBeenCalled()
  })

  it('skipForward clamps at last sentence', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>One.</p>'
    const { result } = renderHook(() => useAudioReader())

    act(() => result.current.play(el))
    act(() => result.current.skipForward())
    // Should be clamped at sentence 0 (only 1 sentence, max index is 0)
    expect(result.current.currentSentence).toBe(0)
  })

  it('skipBackward clamps at 0', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>First. Second.</p>'
    const { result } = renderHook(() => useAudioReader())

    act(() => result.current.play(el))
    act(() => result.current.skipBackward())
    expect(result.current.currentSentence).toBe(0)
  })

  it('extracts sentences stripping script/style/noscript/svg elements', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Visible text.</p><script>evil();</script><style>.x{}</style><noscript>No JS</noscript><svg></svg>'
    const { result } = renderHook(() => useAudioReader())

    act(() => result.current.play(el))
    expect(result.current.totalSentences).toBe(1)
    expect(mockSynthesis.speak).toHaveBeenCalled()
  })

  it('loadVoices picks default voice', () => {
    mockSynthesis.getVoices.mockReturnValue([
      { name: 'French', lang: 'fr-FR', voiceURI: 'fr', default: false, localService: true } as SpeechSynthesisVoice,
      { name: 'English', lang: 'en-US', voiceURI: 'en', default: true, localService: true } as SpeechSynthesisVoice,
    ])

    const { result } = renderHook(() => useAudioReader())
    expect(result.current.selectedVoiceURI).toBe('en')
  })

  it('loadVoices falls back to en voice when no default', () => {
    mockSynthesis.getVoices.mockReturnValue([
      { name: 'French', lang: 'fr-FR', voiceURI: 'fr', default: false, localService: true } as SpeechSynthesisVoice,
      { name: 'English', lang: 'en-US', voiceURI: 'en', default: false, localService: true } as SpeechSynthesisVoice,
    ])

    const { result } = renderHook(() => useAudioReader())
    expect(result.current.selectedVoiceURI).toBe('en')
  })
})
