import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

describe('useSpeechRecognition', () => {
  let mockRecognitionInstance: any
  let MockSpeechRecognition: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    mockRecognitionInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      continuous: false,
      interimResults: false,
      lang: '',
      onstart: null as any,
      onresult: null as any,
      onerror: null as any,
      onend: null as any,
    }
    MockSpeechRecognition = vi.fn(() => mockRecognitionInstance)
    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition)
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn().mockImplementation((text: string) => ({
      text,
      rate: 1,
      pitch: 1,
      lang: '',
      onend: null,
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns isSupported true when SpeechRecognition is available', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.isSupported).toBe(true)
  })

  it('returns isSupported false when SpeechRecognition is not available', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
    // No SpeechRecognition in window
    const origSR = (window as any).SpeechRecognition
    const origWebkit = (window as any).webkitSpeechRecognition
    delete (window as any).SpeechRecognition
    delete (window as any).webkitSpeechRecognition

    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.isSupported).toBe(false)

    if (origSR) (window as any).SpeechRecognition = origSR
    if (origWebkit) (window as any).webkitSpeechRecognition = origWebkit
  })

  it('starts listening and updates state', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    expect(MockSpeechRecognition).toHaveBeenCalled()
    expect(mockRecognitionInstance.start).toHaveBeenCalled()
    expect(mockRecognitionInstance.continuous).toBe(true)
    expect(mockRecognitionInstance.interimResults).toBe(true)
    expect(mockRecognitionInstance.lang).toBe('en-US')

    // Simulate onstart
    act(() => {
      mockRecognitionInstance.onstart()
    })
    expect(result.current.isListening).toBe(true)
  })

  it('processes speech results into transcript', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const mockEvent = {
      results: [
        [{ transcript: 'hello ' }],
        [{ transcript: 'world' }],
      ],
      length: 2,
    }

    act(() => {
      mockRecognitionInstance.onresult(mockEvent)
    })

    expect(result.current.transcript).toBe('hello world')
  })

  it('handles speech recognition error', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    act(() => {
      mockRecognitionInstance.onerror({ error: 'no-speech' })
    })

    expect(result.current.error).toBe('Speech recognition error: no-speech')
    expect(result.current.isListening).toBe(false)
  })

  it('handles recognition end', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
      mockRecognitionInstance.onstart()
    })
    expect(result.current.isListening).toBe(true)

    act(() => {
      mockRecognitionInstance.onend()
    })
    expect(result.current.isListening).toBe(false)
  })

  it('stops listening', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
      mockRecognitionInstance.onstart()
    })

    act(() => {
      result.current.stopListening()
    })

    expect(mockRecognitionInstance.stop).toHaveBeenCalled()
    expect(result.current.isListening).toBe(false)
  })

  it('resets transcript', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
      mockRecognitionInstance.onresult({
        results: [[{ transcript: 'hello' }]],
        length: 1,
      })
    })

    act(() => {
      result.current.resetTranscript()
    })

    expect(result.current.transcript).toBe('')
  })

  it('sets error when startListening called without SpeechRecognition support', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
    delete (window as any).SpeechRecognition
    delete (window as any).webkitSpeechRecognition

    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    expect(result.current.error).toBe('Speech recognition not supported in this browser')
  })

  it('cleans up on unmount', async () => {
    const { useSpeechRecognition } = await import('../../hooks/useSpeechRecognition')
    const { result, unmount } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    unmount()

    expect(mockRecognitionInstance.stop).toHaveBeenCalled()
  })
})

describe('speak', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn().mockImplementation((text: string) => ({
      text,
      rate: 1,
      pitch: 1,
      lang: '',
      onend: null,
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls speechSynthesis.speak with utterance', async () => {
    const { speak } = await import('../../hooks/useSpeechRecognition')
    speak('Hello world')
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
    expect(window.speechSynthesis.speak).toHaveBeenCalled()
  })

  it('sets onend callback when provided', async () => {
    const { speak } = await import('../../hooks/useSpeechRecognition')
    const onEnd = vi.fn()
    speak('Hello', onEnd)

    const utterance = vi.mocked(SpeechSynthesisUtterance).mock.results[0].value
    expect(utterance.onend).toBe(onEnd)
  })

  it('does nothing when speechSynthesis is not available', async () => {
    vi.unstubAllGlobals()
    const origSS = window.speechSynthesis
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true, writable: true })

    const { speak } = await import('../../hooks/useSpeechRecognition')
    // Should not throw
    expect(() => speak('test')).not.toThrow()

    Object.defineProperty(window, 'speechSynthesis', { value: origSS, configurable: true, writable: true })
  })
})

describe('stopSpeaking', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls speechSynthesis.cancel', async () => {
    const { stopSpeaking } = await import('../../hooks/useSpeechRecognition')
    stopSpeaking()
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
  })
})
