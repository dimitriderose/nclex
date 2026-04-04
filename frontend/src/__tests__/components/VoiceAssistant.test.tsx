import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceAssistant } from '../../components/VoiceAssistant'

vi.mock('../../components/VoiceAssistant.css', () => ({}))

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: '',
    error: null,
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
}))

describe('VoiceAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders voice assistant header', () => {
    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByText('NCLEX Voice Assistant')).toBeInTheDocument()
  })

  it('shows empty state message', () => {
    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByText(/tap the mic/i)).toBeInTheDocument()
  })

  it('renders mic button', () => {
    render(<VoiceAssistant isQuestionActive={false} />)
    const btn = screen.getByRole('button', { name: /listen/i })
    expect(btn).toBeInTheDocument()
  })

  it('renders hands-free toggle', () => {
    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByText('Hands-free')).toBeInTheDocument()
  })

  it('renders checkbox for hands-free', () => {
    render(<VoiceAssistant isQuestionActive={false} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
    expect(checkbox).not.toBeChecked()
  })
})
