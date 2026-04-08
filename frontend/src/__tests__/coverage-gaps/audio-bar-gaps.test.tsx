/**
 * Tests targeting uncovered lines 15-22, 71, 105-113 in AudioBar.tsx
 * These cover: handlePlayPause (pause/resume/play branches),
 * empty sentence info display, voice select with non-English voices.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioBar } from '../../components/reader/AudioBar'

vi.mock('../../styles/ReaderAudio.css', () => ({}))

const mockEnVoice = { name: 'English', lang: 'en-US', voiceURI: 'en', default: true, localService: true } as SpeechSynthesisVoice
const mockFrVoice = { name: 'French', lang: 'fr-FR', voiceURI: 'fr', default: false, localService: true } as SpeechSynthesisVoice

function createAudioMock(overrides = {}) {
  return {
    isAvailable: true,
    isPlaying: false,
    isPaused: false,
    currentSentence: 0,
    totalSentences: 0,
    speed: 1.0,
    voices: [mockEnVoice],
    selectedVoiceURI: 'en',
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    skipForward: vi.fn(),
    skipBackward: vi.fn(),
    cycleSpeed: vi.fn(),
    setVoice: vi.fn(),
    ...overrides,
  }
}

describe('AudioBar — gap coverage', () => {
  it('handlePlayPause calls pause when isPlaying', () => {
    const audio = createAudioMock({ isPlaying: true, totalSentences: 5 })
    const contentRef = { current: document.createElement('div') }
    render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    // The play/pause button
    fireEvent.click(screen.getByLabelText('Pause audio'))
    expect(audio.pause).toHaveBeenCalled()
  })

  it('handlePlayPause calls resume when isPaused', () => {
    const audio = createAudioMock({ isPaused: true, totalSentences: 5 })
    const contentRef = { current: document.createElement('div') }
    render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    fireEvent.click(screen.getByLabelText('Play audio'))
    expect(audio.resume).toHaveBeenCalled()
  })

  it('handlePlayPause calls play when neither playing nor paused', () => {
    const audio = createAudioMock({ isPlaying: false, isPaused: false })
    const contentRef = { current: document.createElement('div') }
    render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    fireEvent.click(screen.getByLabelText('Play audio'))
    expect(audio.play).toHaveBeenCalledWith(contentRef.current)
  })

  it('displays empty string when totalSentences is 0', () => {
    const audio = createAudioMock({ totalSentences: 0, isPlaying: true })
    const contentRef = { current: document.createElement('div') }
    const { container } = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    const info = container.querySelector('.audio-sentence-info')
    expect(info?.textContent).toBe('')
  })

  it('renders Other Languages optgroup for non-English voices', () => {
    const audio = createAudioMock({
      voices: [mockEnVoice, mockFrVoice],
      isPlaying: true,
    })
    const contentRef = { current: document.createElement('div') }
    const { container } = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    // optgroup labels aren't text nodes — use DOM queries
    const optgroups = container.querySelectorAll('optgroup')
    expect(optgroups).toHaveLength(2)
    expect(optgroups[0].getAttribute('label')).toBe('English')
    expect(optgroups[1].getAttribute('label')).toBe('Other Languages')
  })

  it('voice select onChange calls setVoice', () => {
    const audio = createAudioMock({
      voices: [mockEnVoice, mockFrVoice],
      isPlaying: true,
    })
    const contentRef = { current: document.createElement('div') }
    render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    const select = screen.getByLabelText('Select voice')
    fireEvent.change(select, { target: { value: 'fr' } })
    expect(audio.setVoice).toHaveBeenCalledWith('fr')
  })

  it('skip buttons call skipForward and skipBackward', () => {
    const audio = createAudioMock({ isPlaying: true, totalSentences: 5 })
    const contentRef = { current: document.createElement('div') }
    render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    fireEvent.click(screen.getByLabelText('Next sentence'))
    expect(audio.skipForward).toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Previous sentence'))
    expect(audio.skipBackward).toHaveBeenCalled()
  })

  it('renders with only non-English voices (no English optgroup)', () => {
    const audio = createAudioMock({
      voices: [mockFrVoice],
      isPlaying: true,
    })
    const contentRef = { current: document.createElement('div') }
    const { container } = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    // optgroup labels aren't findable by getByText — use DOM queries
    const optgroups = container.querySelectorAll('optgroup')
    expect(optgroups).toHaveLength(1)
    expect(optgroups[0].getAttribute('label')).toBe('Other Languages')
    const option = container.querySelector('option[value="fr"]')
    expect(option).toBeInTheDocument()
  })

  it('renders with empty voices array', () => {
    const audio = createAudioMock({
      voices: [],
      isPlaying: true,
    })
    const contentRef = { current: document.createElement('div') }
    const { container } = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    const select = container.querySelector('.audio-voice-select')
    expect(select).toBeInTheDocument()
  })

  it('renders with selectedVoiceURI null (value falls back to empty string)', () => {
    const audio = createAudioMock({
      selectedVoiceURI: null,
      voices: [],  // empty voices so no option auto-selects
      isPlaying: true,
    })
    const contentRef = { current: document.createElement('div') }
    const { container } = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)

    const select = container.querySelector('.audio-voice-select') as HTMLSelectElement
    expect(select.value).toBe('')
  })
})
