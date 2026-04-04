import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock all child components
vi.mock('../../components/ExamSimulation', () => ({
  ExamSimulation: () => <div>ExamSimulation</div>,
}))
vi.mock('../../components/ProgressDashboard', () => ({
  ProgressDashboard: () => <div>ProgressDashboard</div>,
}))
vi.mock('../../components/ReviewQueue', () => ({
  ReviewQueue: () => <div>ReviewQueue</div>,
}))
vi.mock('../../components/VoiceAssistant', () => ({
  VoiceAssistant: ({ isQuestionActive }: { isQuestionActive: boolean }) => (
    <div>VoiceAssistant active={String(isQuestionActive)}</div>
  ),
}))
vi.mock('../../components/QuestionCard', () => ({
  QuestionCard: ({ onAnswer }: { onAnswer?: (result: any) => void }) => (
    <div>
      QuestionCard
      <button onClick={() => onAnswer?.({
        topic: 'Test Topic',
        correct: true,
        ncjmmStep: 'recognize_cues',
        score: 1,
        timeTaken: 30,
      })}>
        SubmitAnswer
      </button>
    </div>
  ),
}))

// Mock services
vi.mock('../../services/question-service', () => ({
  questionService: { generate: vi.fn(), generateBatch: vi.fn(), scoreSATA: vi.fn(), scoreDosage: vi.fn(), scoreMC: vi.fn() },
}))
vi.mock('../../services/offline-bank', () => ({
  offlineBank: { getRandomQuestion: vi.fn() },
}))
vi.mock('../../services/sync-queue', () => ({
  syncQueue: { enqueue: vi.fn() },
}))
vi.mock('../../services/api', () => ({
  api: { appendHistory: vi.fn() },
}))

import { ExamPage } from '../../pages/ExamPage'
import { ProgressPage } from '../../pages/ProgressPage'
import { ReviewPage } from '../../pages/ReviewPage'
import { VoicePage } from '../../pages/VoicePage'
import { PracticePage } from '../../pages/PracticePage'

describe('ExamPage', () => {
  it('renders ExamSimulation component', () => {
    render(<ExamPage />)
    expect(screen.getByText('ExamSimulation')).toBeInTheDocument()
  })
})

describe('ProgressPage', () => {
  it('renders ProgressDashboard component', () => {
    render(<ProgressPage />)
    expect(screen.getByText('ProgressDashboard')).toBeInTheDocument()
  })
})

describe('ReviewPage', () => {
  it('renders ReviewQueue component', () => {
    render(<ReviewPage />)
    expect(screen.getByText('ReviewQueue')).toBeInTheDocument()
  })
})

describe('VoicePage', () => {
  it('renders VoiceAssistant with isQuestionActive=false', () => {
    render(<VoicePage />)
    expect(screen.getByText(/VoiceAssistant active=false/)).toBeInTheDocument()
  })
})

describe('PracticePage', () => {
  it('renders practice controls', () => {
    render(<PracticePage />)
    expect(screen.getByText('New Question')).toBeInTheDocument()
    expect(screen.getByText('Ready to Practice?')).toBeInTheDocument()
  })

  it('renders topic and question type selects', () => {
    render(<PracticePage />)
    expect(screen.getByText('Multiple Choice')).toBeInTheDocument()
    expect(screen.getByText('Pharmacological Therapies')).toBeInTheDocument()
  })

  it('shows answered count', () => {
    render(<PracticePage />)
    expect(screen.getByText('0 answered this session')).toBeInTheDocument()
  })

  it('shows loading state when generating question', async () => {
    const { questionService } = await import('../../services/question-service')
    vi.mocked(questionService.generate).mockReturnValue(new Promise(() => {})) // never resolves

    render(<PracticePage />)
    const btn = screen.getByText('New Question')
    fireEvent.click(btn)

    expect(screen.getByText('Generating...')).toBeInTheDocument()
  })

  it('shows question card on successful generation', async () => {
    const { questionService } = await import('../../services/question-service')
    vi.mocked(questionService.generate).mockResolvedValue({
      id: 'q1',
      type: 'mc',
      stem: 'Test question stem',
      options: [{ id: 'a', text: 'Option A', isCorrect: true }],
      rationale: 'Because',
      ncjmmStep: 'recognize_cues',
      ncjmmValidated: true,
      topic: 'Pharmacological Therapies',
      difficulty: 'medium',
      source: 'test',
      sourceKey: 'test',
      createdAt: '2024-01-01',
    })

    render(<PracticePage />)
    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText('QuestionCard')).toBeInTheDocument()
    })
  })

  it('shows error and falls back to offline bank on generate failure', async () => {
    const { questionService } = await import('../../services/question-service')
    const { offlineBank } = await import('../../services/offline-bank')
    vi.mocked(questionService.generate).mockRejectedValue(new Error('offline'))
    vi.mocked(offlineBank.getRandomQuestion).mockReturnValue(null)

    render(<PracticePage />)
    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText(/Could not generate a question/)).toBeInTheDocument()
    })
  })

  it('uses offline bank question when API fails but bank has questions', async () => {
    const { questionService } = await import('../../services/question-service')
    const { offlineBank } = await import('../../services/offline-bank')
    vi.mocked(questionService.generate).mockRejectedValue(new Error('offline'))
    vi.mocked(offlineBank.getRandomQuestion).mockReturnValue({
      id: 'offline-q1',
      type: 'mc',
      stem: 'Offline question',
      options: [{ id: 'a', text: 'A', isCorrect: true }],
      rationale: 'R',
      ncjmmStep: 'recognize_cues',
      ncjmmValidated: true,
      topic: 'Pharmacological Therapies',
      difficulty: 'medium',
      source: 'offline',
      sourceKey: 'offline',
      createdAt: '2024-01-01',
    })

    render(<PracticePage />)
    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText('QuestionCard')).toBeInTheDocument()
    })
  })

  it('changes topic selection', () => {
    render(<PracticePage />)
    const topicSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(topicSelect, { target: { value: 'Management of Care' } })
    expect(topicSelect).toHaveValue('Management of Care')
  })

  it('changes question type selection', () => {
    render(<PracticePage />)
    const typeSelect = screen.getAllByRole('combobox')[1]
    fireEvent.change(typeSelect, { target: { value: 'sata' } })
    expect(typeSelect).toHaveValue('sata')
  })

  it('calls api.appendHistory on answer submission', async () => {
    const { questionService } = await import('../../services/question-service')
    const { api } = await import('../../services/api')
    vi.mocked(questionService.generate).mockResolvedValue({
      id: 'q1', type: 'mc', stem: 'Test', options: [{ id: 'a', text: 'A', isCorrect: true }],
      rationale: 'R', ncjmmStep: 'recognize_cues', ncjmmValidated: true,
      topic: 'Pharmacological Therapies', difficulty: 'medium',
      source: 'test', sourceKey: 'test', createdAt: '2024-01-01',
    })
    vi.mocked(api.appendHistory).mockResolvedValue(undefined as any)

    render(<PracticePage />)
    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText('SubmitAnswer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('SubmitAnswer'))
    await waitFor(() => {
      expect(api.appendHistory).toHaveBeenCalledWith(expect.objectContaining({
        topic: 'Test Topic',
        correct: true,
      }))
    })
    expect(screen.getByText('1 answered this session')).toBeInTheDocument()
  })

  it('enqueues to syncQueue when api.appendHistory fails', async () => {
    const { questionService } = await import('../../services/question-service')
    const { api } = await import('../../services/api')
    const { syncQueue } = await import('../../services/sync-queue')
    vi.mocked(questionService.generate).mockResolvedValue({
      id: 'q1', type: 'mc', stem: 'Test', options: [{ id: 'a', text: 'A', isCorrect: true }],
      rationale: 'R', ncjmmStep: 'recognize_cues', ncjmmValidated: true,
      topic: 'Pharmacological Therapies', difficulty: 'medium',
      source: 'test', sourceKey: 'test', createdAt: '2024-01-01',
    })
    vi.mocked(api.appendHistory).mockRejectedValue(new Error('offline'))

    render(<PracticePage />)
    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText('SubmitAnswer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('SubmitAnswer'))
    await waitFor(() => {
      expect(syncQueue.enqueue).toHaveBeenCalledWith('history_append', expect.objectContaining({
        topic: 'Test Topic',
        correct: true,
      }))
    })
  })
})
