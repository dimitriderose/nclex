import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  QuestionCard: ({ question, onAnswer }: { question: { id: string; stem: string }; onAnswer?: (result: any) => void }) => (
    <div>
      QuestionCard
      <div>{question.stem}</div>
      <button onClick={() => onAnswer?.({
        questionId: question.id,
        topic: 'Test Topic',
        correct: true,
        ncjmmStep: 'recognize_cues',
        score: 1,
        timeTaken: 30,
      })}>
        SubmitAnswer
      </button>
      <button onClick={() => onAnswer?.({
        questionId: question.id,
        topic: 'Test Topic',
        correct: false,
        ncjmmStep: 'recognize_cues',
        score: 0,
        timeTaken: 30,
      })}>
        SubmitWrongAnswer
      </button>
    </div>
  ),
}))

// Mock services
vi.mock('../../services/question-service', () => ({
  questionService: {
    generate: vi.fn(),
    generateBatch: vi.fn().mockResolvedValue([]),
    recordAttempt: vi.fn().mockResolvedValue(undefined),
    scoreSATA: vi.fn(),
    scoreDosage: vi.fn(),
    scoreMC: vi.fn(),
  },
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
import type { GeneratedQuestion } from '../../types/content'

let questionIdCounter = 0

function makeQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  questionIdCounter += 1
  return {
    id: `q${questionIdCounter}`,
    type: 'mc',
    stem: `Question stem ${questionIdCounter}`,
    options: [{ id: 'a', text: 'Option A', isCorrect: true }],
    rationale: 'Because',
    ncjmmStep: 'recognize_cues',
    ncjmmValidated: true,
    topic: 'Pharmacological Therapies',
    difficulty: 'medium',
    source: 'test',
    sourceKey: 'test',
    createdAt: '2024-01-01',
    ...overrides,
  }
}

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
  beforeEach(async () => {
    const { questionService } = await import('../../services/question-service')
    vi.mocked(questionService.generate).mockReset()
    vi.mocked(questionService.generateBatch).mockReset().mockResolvedValue([])
    vi.mocked(questionService.recordAttempt).mockReset().mockResolvedValue(undefined)
  })

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

  it('shows loading state while generating a question with an empty queue', async () => {
    const { questionService } = await import('../../services/question-service')
    vi.mocked(questionService.generateBatch).mockResolvedValue([])
    vi.mocked(questionService.generate).mockReturnValue(new Promise(() => {})) // never resolves

    render(<PracticePage />)

    // Let the initial prefetch fill resolve to an empty queue (cold).
    await waitFor(() => {
      expect(questionService.generateBatch).toHaveBeenCalled()
    })

    const btn = screen.getByText('New Question')
    fireEvent.click(btn)

    expect(screen.getByText('Generating...')).toBeInTheDocument()
  })

  it('serves a question instantly from a pre-populated queue', async () => {
    const { questionService } = await import('../../services/question-service')
    vi.mocked(questionService.generateBatch).mockResolvedValue([
      makeQuestion({ id: 'queued-1', stem: 'Queued question one' }),
      makeQuestion({ id: 'queued-2', stem: 'Queued question two' }),
    ])
    // generate() should NOT be needed when the queue has questions ready.
    vi.mocked(questionService.generate).mockReturnValue(new Promise(() => {}))

    render(<PracticePage />)

    // Wait for the initial fill to land in the queue.
    await waitFor(() => {
      expect(questionService.generateBatch).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('New Question'))

    await waitFor(() => {
      expect(screen.getByText('Queued question one')).toBeInTheDocument()
    })

    expect(screen.queryByText('Generating...')).not.toBeInTheDocument()
    expect(questionService.generate).not.toHaveBeenCalled()
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

  it('falls back to the offline bank when question generation fails', async () => {
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

  // ---- Prefetch queue ----
  describe('prefetch queue', () => {
    it('refills the queue with a fresh batch when topic or type changes', async () => {
      const { questionService } = await import('../../services/question-service')
      vi.mocked(questionService.generateBatch).mockResolvedValue([])

      render(<PracticePage />)

      // Initial fill for the default selection.
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledWith({
          topics: ['Pharmacological Therapies'],
          questionTypes: ['mc'],
          count: 5,
          difficulty: 'medium',
        })
      })

      const callsBeforeChange = vi.mocked(questionService.generateBatch).mock.calls.length

      const topicSelect = screen.getAllByRole('combobox')[0]
      fireEvent.change(topicSelect, { target: { value: 'Management of Care' } })

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledWith({
          topics: ['Management of Care'],
          questionTypes: ['mc'],
          count: 5,
          difficulty: 'medium',
        })
      })

      // A genuinely new call was made for the new topic (not just a re-render).
      expect(vi.mocked(questionService.generateBatch).mock.calls.length).toBeGreaterThan(callsBeforeChange)

      const callsBeforeTypeChange = vi.mocked(questionService.generateBatch).mock.calls.length
      const typeSelect = screen.getAllByRole('combobox')[1]
      fireEvent.change(typeSelect, { target: { value: 'sata' } })

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledWith({
          topics: ['Management of Care'],
          questionTypes: ['sata'],
          count: 5,
          difficulty: 'medium',
        })
      })
      expect(vi.mocked(questionService.generateBatch).mock.calls.length).toBeGreaterThan(callsBeforeTypeChange)
    })

    it('discards a stale batch that resolves after the topic has changed', async () => {
      const { questionService } = await import('../../services/question-service')

      let resolveStale: (value: any[]) => void = () => {}
      const stalePromise = new Promise<any[]>((resolve) => { resolveStale = resolve })

      vi.mocked(questionService.generateBatch).mockImplementationOnce(() => stalePromise as any)
      vi.mocked(questionService.generateBatch).mockResolvedValue([])

      render(<PracticePage />)

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledTimes(1)
      })

      // Change topic before the first (stale) batch resolves.
      const topicSelect = screen.getAllByRole('combobox')[0]
      fireEvent.change(topicSelect, { target: { value: 'Management of Care' } })

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledTimes(2)
      })

      // Now resolve the stale batch with questions for the OLD topic — they must not
      // be appended to the queue (queueKeyRef no longer matches).
      resolveStale([
        makeQuestion({ id: 'stale-1', stem: 'Stale question', topic: 'Pharmacological Therapies' }),
      ])

      // Drain microtasks.
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledTimes(2)
      })

      vi.mocked(questionService.generate).mockReturnValue(new Promise(() => {}))
      fireEvent.click(screen.getByText('New Question'))

      // The stale question must NOT be served — the spinner should show because the
      // (new-topic) queue is empty and generate() hangs.
      await waitFor(() => {
        expect(screen.getByText('Generating...')).toBeInTheDocument()
      })
      expect(screen.queryByText('Stale question')).not.toBeInTheDocument()
    })

    it('replenishes the queue in the background once it drops to the threshold', async () => {
      const { questionService } = await import('../../services/question-service')

      // QUEUE_REPLENISH_THRESHOLD is 2 — seed the queue with 3 (threshold + 1).
      const seeded = [
        makeQuestion({ id: 'seed-1', stem: 'Seed question one' }),
        makeQuestion({ id: 'seed-2', stem: 'Seed question two' }),
        makeQuestion({ id: 'seed-3', stem: 'Seed question three' }),
      ]
      vi.mocked(questionService.generateBatch).mockResolvedValueOnce(seeded)

      let resolveReplenish: (value: any[]) => void = () => {}
      const replenishPromise = new Promise<any[]>((resolve) => { resolveReplenish = resolve })
      vi.mocked(questionService.generateBatch).mockImplementationOnce(() => replenishPromise as any)

      render(<PracticePage />)

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledTimes(1)
      })

      // Consume one — queue goes from 3 to 2 (== threshold), which should trigger replenishment.
      fireEvent.click(screen.getByText('New Question'))

      await waitFor(() => {
        expect(screen.getByText('Seed question one')).toBeInTheDocument()
      })

      // The replenish call fires for the gap (QUEUE_TARGET(5) - remaining(2) = 3) without blocking the UI —
      // the question is already showing, no spinner.
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalledTimes(2)
      })
      expect(questionService.generateBatch).toHaveBeenLastCalledWith({
        topics: ['Pharmacological Therapies'],
        questionTypes: ['mc'],
        count: 3,
        difficulty: 'medium',
      })
      expect(screen.queryByText('Generating...')).not.toBeInTheDocument()

      resolveReplenish([])
    })
  })

  // ---- Fallback chain ----
  describe('fallback chain on batch failure', () => {
    it('falls back to generate() when generateBatch rejects', async () => {
      const { questionService } = await import('../../services/question-service')
      const { offlineBank } = await import('../../services/offline-bank')

      vi.mocked(questionService.generateBatch).mockRejectedValue(new Error('batch failed'))
      vi.mocked(questionService.generate).mockRejectedValue(new Error('generate failed'))
      vi.mocked(offlineBank.getRandomQuestion).mockReturnValue(makeQuestion({
        id: 'offline-fallback',
        stem: 'Offline fallback question',
      }))

      render(<PracticePage />)

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('New Question'))

      await waitFor(() => {
        expect(questionService.generate).toHaveBeenCalled()
      })
    })

    it('falls back to the offline bank when generate() also fails', async () => {
      const { questionService } = await import('../../services/question-service')
      const { offlineBank } = await import('../../services/offline-bank')

      vi.mocked(questionService.generateBatch).mockRejectedValue(new Error('batch failed'))
      vi.mocked(questionService.generate).mockRejectedValue(new Error('generate failed'))
      vi.mocked(offlineBank.getRandomQuestion).mockReturnValue(makeQuestion({
        id: 'offline-fallback',
        stem: 'Offline fallback question',
      }))

      render(<PracticePage />)

      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('New Question'))

      await waitFor(() => {
        expect(offlineBank.getRandomQuestion).toHaveBeenCalledWith('Pharmacological Therapies')
      })
      await waitFor(() => {
        expect(screen.getByText('Offline fallback question')).toBeInTheDocument()
      })
    })

    it('shows an error when both generate() and the offline bank fail', async () => {
      const { questionService } = await import('../../services/question-service')
      const { offlineBank } = await import('../../services/offline-bank')

      vi.mocked(questionService.generateBatch).mockRejectedValue(new Error('batch failed'))
      vi.mocked(questionService.generate).mockRejectedValue(new Error('generate failed'))
      vi.mocked(offlineBank.getRandomQuestion).mockReturnValue(null)

      render(<PracticePage />)
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('New Question'))

      await waitFor(() => {
        expect(screen.getByText(/Could not generate a question/)).toBeInTheDocument()
      })
    })
  })

  // ---- recordAttempt ----
  describe('recordAttempt', () => {
    it('records an attempt with the question id and correctness', async () => {
      const { questionService } = await import('../../services/question-service')
      const { api } = await import('../../services/api')

      vi.mocked(questionService.generateBatch).mockResolvedValue([
        makeQuestion({ id: 'attempt-q1', stem: 'Attempt question one' }),
        makeQuestion({ id: 'attempt-q2', stem: 'Attempt question two' }),
      ])
      vi.mocked(api.appendHistory).mockResolvedValue(undefined as any)
      vi.mocked(questionService.recordAttempt).mockResolvedValue(undefined)

      render(<PracticePage />)
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('New Question'))
      await waitFor(() => {
        expect(screen.getByText('Attempt question one')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('SubmitAnswer'))

      await waitFor(() => {
        expect(questionService.recordAttempt).toHaveBeenNthCalledWith(1, 'attempt-q1', true)
      })

      fireEvent.click(screen.getByText('Next Question'))
      await waitFor(() => {
        expect(screen.getByText('Attempt question two')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('SubmitWrongAnswer'))

      await waitFor(() => {
        expect(questionService.recordAttempt).toHaveBeenNthCalledWith(2, 'attempt-q2', false)
      })

      expect(questionService.recordAttempt).toHaveBeenCalledTimes(2)
    })

    it('swallows a rejected recordAttempt without throwing', async () => {
      const { questionService } = await import('../../services/question-service')
      const { api } = await import('../../services/api')

      vi.mocked(questionService.generateBatch).mockResolvedValue([
        makeQuestion({ id: 'attempt-q1', stem: 'Attempt question one' }),
      ])
      vi.mocked(api.appendHistory).mockResolvedValue(undefined as any)
      vi.mocked(questionService.recordAttempt).mockRejectedValueOnce(new Error('record failed'))

      render(<PracticePage />)
      await waitFor(() => {
        expect(questionService.generateBatch).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByText('New Question'))
      await waitFor(() => {
        expect(screen.getByText('Attempt question one')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('SubmitAnswer'))

      await waitFor(() => {
        expect(questionService.recordAttempt).toHaveBeenNthCalledWith(1, 'attempt-q1', true)
      })

      expect(screen.queryByText(/Could not generate a question/)).not.toBeInTheDocument()
    })
  })
})
