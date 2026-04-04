import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { VoiceAssistant } from '../../components/VoiceAssistant'

vi.mock('../../components/VoiceAssistant.css', () => ({}))

const mockUseSpeechRecognition = vi.fn().mockReturnValue({
  isListening: false,
  transcript: '',
  error: null,
  isSupported: true,
  startListening: vi.fn(),
  stopListening: vi.fn(),
  resetTranscript: vi.fn(),
})

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: (...args: any[]) => mockUseSpeechRecognition(...args),
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

// Additional coverage tests with dynamic mock overrides
describe('VoiceAssistant - unsupported browser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows unsupported message when isSupported is false', async () => {
    // Override the mock for this test
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: '',
      error: null,
      isSupported: false,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByText(/Web Speech API support/)).toBeInTheDocument()
  })
})

describe('VoiceAssistant - with transcript', () => {
  it('shows transcript and send button', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: 'What is metformin?',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    render(<VoiceAssistant isQuestionActive={true} />)
    expect(screen.getByText('What is metformin?')).toBeInTheDocument()
    expect(screen.getByText('Send')).toBeInTheDocument()
  })
})

describe('VoiceAssistant - listening state', () => {
  it('shows stop button when listening', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: true,
      transcript: '',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })
})

describe('VoiceAssistant - error display', () => {
  it('displays error message', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: '',
      error: 'Microphone access denied',
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    render(<VoiceAssistant isQuestionActive={false} />)
    expect(screen.getByText('Microphone access denied')).toBeInTheDocument()
  })
})

describe('VoiceAssistant - handleSend flow', () => {
  it('sends question and displays response', async () => {
    const mockStopListening = vi.fn()
    const mockResetTranscript = vi.fn()
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: 'What is metformin used for?',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: mockStopListening,
      resetTranscript: mockResetTranscript,
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ answer: 'Metformin is used for Type 2 DM.', source: 'drugs' }),
    })

    const onResponse = vi.fn()
    render(<VoiceAssistant isQuestionActive={true} onResponse={onResponse} />)

    const sendBtn = screen.getByText('Send')
    await act(async () => {
      fireEvent.click(sendBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('Metformin is used for Type 2 DM.')).toBeInTheDocument()
    })
    expect(onResponse).toHaveBeenCalledWith('Metformin is used for Type 2 DM.')
  })

  it('shows error message on fetch failure', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: 'Test question',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))

    render(<VoiceAssistant isQuestionActive={false} />)

    const sendBtn = screen.getByText('Send')
    await act(async () => {
      fireEvent.click(sendBtn)
    })

    await waitFor(() => {
      expect(screen.getByText(/encountered an error/)).toBeInTheDocument()
    })
  })

  it('does not send when transcript is empty', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: '   ',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    globalThis.fetch = vi.fn()

    render(<VoiceAssistant isQuestionActive={false} />)

    // The Send button appears because transcript is truthy (whitespace)
    const sendBtn = screen.getByText('Send')
    await act(async () => {
      fireEvent.click(sendBtn)
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('toggles hands-free checkbox', async () => {
    mockUseSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: '',
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    })

    render(<VoiceAssistant isQuestionActive={false} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })
})
