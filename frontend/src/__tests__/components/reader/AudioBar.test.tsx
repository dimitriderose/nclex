import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioBar } from '../../../components/reader/AudioBar'

vi.mock('../../../styles/ReaderAudio.css', () => ({}))

const mockVoice = { name: 'English', lang: 'en-US', voiceURI: 'en', default: true, localService: true } as SpeechSynthesisVoice

function createAudioMock(overrides = {}) {
  return {
    isAvailable: true,
    isPlaying: false,
    isPaused: false,
    currentSentence: 0,
    totalSentences: 10,
    speed: 1.0,
    voices: [mockVoice],
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

function renderAudioBar(audioOverrides = {}) {
  const audio = createAudioMock(audioOverrides)
  const contentRef = { current: document.createElement('div') }
  const result = render(<AudioBar audio={audio as any} contentRef={contentRef as any} />)
  return { audio, result }
}

describe('AudioBar', () => {
  it('returns null when not available', () => {
    const { result } = renderAudioBar({ isAvailable: false })
    expect(result.container.innerHTML).toBe('')
  })

  it('has hidden class when not playing or paused', () => {
    const { result } = renderAudioBar({ isPlaying: false, isPaused: false })
    const bar = result.container.querySelector('.audio-bar')
    expect(bar?.className).toContain('hidden')
  })

  it('shows without hidden class when playing', () => {
    const { result } = renderAudioBar({ isPlaying: true })
    const bar = result.container.querySelector('.audio-bar')
    expect(bar?.className).not.toContain('hidden')
  })

  it('shows Play button when not playing', () => {
    renderAudioBar({ isPlaying: false })
    expect(screen.getByLabelText('Play audio')).toBeInTheDocument()
  })

  it('shows Pause button when playing', () => {
    renderAudioBar({ isPlaying: true })
    expect(screen.getByLabelText('Pause audio')).toBeInTheDocument()
  })

  it('stop button calls audio.stop', () => {
    const { audio } = renderAudioBar()
    fireEvent.click(screen.getByLabelText('Stop audio'))
    expect(audio.stop).toHaveBeenCalled()
  })

  it('displays current speed', () => {
    renderAudioBar({ speed: 1.5 })
    const speedBtn = screen.getByText('1.5x')
    expect(speedBtn).toBeInTheDocument()
  })

  it('speed button calls cycleSpeed', () => {
    const { audio } = renderAudioBar({ speed: 1.0 })
    fireEvent.click(screen.getByText('1x'))
    expect(audio.cycleSpeed).toHaveBeenCalled()
  })

  it('renders voice select dropdown', () => {
    renderAudioBar()
    const select = screen.getByLabelText('Select voice')
    expect(select).toBeInTheDocument()
    expect(select.tagName).toBe('SELECT')
  })

  it('displays sentence info when totalSentences > 0', () => {
    renderAudioBar({ currentSentence: 3, totalSentences: 10 })
    expect(screen.getByText('4 / 10')).toBeInTheDocument()
  })
})
