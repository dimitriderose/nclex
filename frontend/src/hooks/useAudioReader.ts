import { useCallback, useEffect, useRef, useState } from 'react'
import { readerLog } from '../reader/readerLogger'

const SPEED_STEPS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const

interface AudioReaderState {
  isPlaying: boolean
  isPaused: boolean
  currentSentence: number
  totalSentences: number
  speed: number
  voices: SpeechSynthesisVoice[]
  selectedVoiceURI: string | null
  isAvailable: boolean
}

/**
 * Extract readable sentences from an HTML element by cloning it,
 * stripping non-readable tags, and splitting on sentence boundaries.
 */
function extractSentences(el: HTMLElement): string[] {
  const clone = el.cloneNode(true) as HTMLElement

  // Remove non-readable elements
  clone
    .querySelectorAll('script, style, noscript, svg')
    .forEach((n) => n.remove())

  // Get text content, collapse whitespace
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()

  if (!text) return []

  // Split into sentences: match runs ending with punctuation (. ! ?)
  // followed by whitespace or end of string, or a trailing fragment.
  const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g) ?? [text]

  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

export function useAudioReader() {
  const [state, setState] = useState<AudioReaderState>({
    isPlaying: false,
    isPaused: false,
    currentSentence: 0,
    totalSentences: 0,
    speed: 1.0,
    voices: [],
    selectedVoiceURI: null,
    isAvailable: typeof window !== 'undefined' && 'speechSynthesis' in window,
  })

  // Refs to hold mutable state that the speech callbacks close over
  const sentencesRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)
  const speedRef = useRef(1.0)
  const voiceURIRef = useRef<string | null>(null)
  const playingRef = useRef(false)
  const speedIndexRef = useRef(1) // index into SPEED_STEPS, default 1.0

  // Keep refs in sync with state
  useEffect(() => {
    speedRef.current = state.speed
  }, [state.speed])

  useEffect(() => {
    voiceURIRef.current = state.selectedVoiceURI
  }, [state.selectedVoiceURI])

  // --- Voice loading ---
  const loadVoices = useCallback(() => {
    if (!state.isAvailable) return
    const available = speechSynthesis.getVoices()
    if (available.length === 0) return

    setState((prev) => {
      // If no voice selected yet, pick a sensible default
      let selectedURI = prev.selectedVoiceURI
      if (!selectedURI) {
        const defaultVoice =
          available.find((v) => v.default) ??
          available.find((v) => v.lang.startsWith('en')) ??
          available[0]
        selectedURI = defaultVoice?.voiceURI ?? null
      }
      return { ...prev, voices: available, selectedVoiceURI: selectedURI }
    })
  }, [state.isAvailable])

  useEffect(() => {
    if (!state.isAvailable) return

    loadVoices()
    speechSynthesis.addEventListener('voiceschanged', loadVoices)

    // Warn if voices haven't loaded after 3 seconds
    const voiceTimeout = setTimeout(() => {
      const voices = speechSynthesis.getVoices()
      if (voices.length === 0) {
        readerLog.warn('audio.no_voices', { message: 'No voices loaded after 3 seconds' })
      }
    }, 3000)

    return () => {
      clearTimeout(voiceTimeout)
      speechSynthesis.removeEventListener('voiceschanged', loadVoices)
      // Set playingRef to false BEFORE cancel so that if onend fires
      // after cancel, it won't re-queue the next sentence.
      playingRef.current = false
      speechSynthesis.cancel()
    }
  }, [state.isAvailable, loadVoices])

  // --- Core speak function ---
  const speakSentence = useCallback(
    (index: number) => {
      if (!state.isAvailable) return
      if (index >= sentencesRef.current.length) {
        // Finished all sentences
        speechSynthesis.cancel()
        playingRef.current = false
        currentIndexRef.current = 0
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          isPaused: false,
          currentSentence: 0,
        }))
        readerLog.info('audio.finished')
        return
      }

      currentIndexRef.current = index
      setState((prev) => ({ ...prev, currentSentence: index }))

      const utterance = new SpeechSynthesisUtterance(
        sentencesRef.current[index]
      )
      utterance.rate = speedRef.current
      utterance.pitch = 1.0

      // Resolve voice
      const voices = speechSynthesis.getVoices()
      const uri = voiceURIRef.current
      if (uri) {
        const voice = voices.find((v) => v.voiceURI === uri) ?? null
        if (voice) utterance.voice = voice
      }

      utterance.onend = () => {
        if (playingRef.current) {
          speakSentence(index + 1)
        }
      }

      utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          readerLog.error('audio.speech_error', e.error, {
            sentence: index,
          })
          playingRef.current = false
          currentIndexRef.current = 0
          setState((prev) => ({
            ...prev,
            isPlaying: false,
            isPaused: false,
            currentSentence: 0,
            totalSentences: 0,
          }))
        }
      }

      speechSynthesis.speak(utterance)
    },
    [state.isAvailable]
  )

  // --- Public methods ---

  const play = useCallback(
    (contentEl: HTMLElement | null) => {
      if (!state.isAvailable || !contentEl) return

      // Cancel any stale speech state before starting fresh
      speechSynthesis.cancel()
      playingRef.current = false

      // Check if voices are available before attempting to play
      const availableVoices = speechSynthesis.getVoices()
      if (availableVoices.length === 0) {
        readerLog.warn('audio.no_voices', { message: 'No speech synthesis voices available' })
        return
      }

      // Extract sentences from current content
      const extracted = extractSentences(contentEl)
      if (extracted.length === 0) {
        readerLog.warn('audio.no_content')
        return
      }

      sentencesRef.current = extracted
      currentIndexRef.current = 0
      playingRef.current = true

      setState((prev) => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
        currentSentence: 0,
        totalSentences: extracted.length,
      }))

      readerLog.info('audio.play', { sentences: extracted.length })
      speakSentence(0)
    },
    [state.isAvailable, speakSentence]
  )

  const pause = useCallback(() => {
    if (!state.isAvailable) return
    speechSynthesis.pause()
    playingRef.current = false
    setState((prev) => ({ ...prev, isPlaying: false, isPaused: true }))
    readerLog.info('audio.pause')
  }, [state.isAvailable])

  const resume = useCallback(() => {
    if (!state.isAvailable) return
    speechSynthesis.resume()
    playingRef.current = true
    setState((prev) => ({ ...prev, isPlaying: true, isPaused: false }))
    readerLog.info('audio.resume')
  }, [state.isAvailable])

  const stop = useCallback(() => {
    if (!state.isAvailable) return
    speechSynthesis.cancel()
    playingRef.current = false
    currentIndexRef.current = 0
    sentencesRef.current = []
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentSentence: 0,
      totalSentences: 0,
    }))
    readerLog.info('audio.stop')
  }, [state.isAvailable])

  const skipForward = useCallback(() => {
    if (!state.isAvailable || sentencesRef.current.length === 0) return
    speechSynthesis.cancel()
    const next = Math.min(
      currentIndexRef.current + 1,
      sentencesRef.current.length - 1
    )
    playingRef.current = true
    setState((prev) => ({
      ...prev,
      isPlaying: true,
      isPaused: false,
      currentSentence: next,
    }))
    speakSentence(next)
  }, [state.isAvailable, speakSentence])

  const skipBackward = useCallback(() => {
    if (!state.isAvailable || sentencesRef.current.length === 0) return
    speechSynthesis.cancel()
    const prev = Math.max(currentIndexRef.current - 1, 0)
    playingRef.current = true
    setState((s) => ({
      ...s,
      isPlaying: true,
      isPaused: false,
      currentSentence: prev,
    }))
    speakSentence(prev)
  }, [state.isAvailable, speakSentence])

  const cycleSpeed = useCallback(() => {
    speedIndexRef.current =
      (speedIndexRef.current + 1) % SPEED_STEPS.length
    const newSpeed = SPEED_STEPS[speedIndexRef.current]
    speedRef.current = newSpeed
    setState((prev) => ({ ...prev, speed: newSpeed }))

    // If currently playing, restart the current sentence at the new speed
    if (playingRef.current) {
      speechSynthesis.cancel()
      speakSentence(currentIndexRef.current)
    }

    readerLog.info('audio.speed_change', { speed: newSpeed })
  }, [speakSentence])

  const setVoice = useCallback(
    (voiceURI: string) => {
      voiceURIRef.current = voiceURI
      setState((prev) => ({ ...prev, selectedVoiceURI: voiceURI }))

      // If currently playing, restart current sentence with new voice
      if (playingRef.current) {
        speechSynthesis.cancel()
        speakSentence(currentIndexRef.current)
      }

      readerLog.info('audio.voice_change', { voiceURI })
    },
    [speakSentence]
  )

  return {
    ...state,
    play,
    pause,
    resume,
    stop,
    skipForward,
    skipBackward,
    cycleSpeed,
    setVoice,
  }
}

export type AudioReaderAPI = ReturnType<typeof useAudioReader>
