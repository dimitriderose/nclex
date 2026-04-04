import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExamSimulation } from '../../components/ExamSimulation'

// Mock CSS import
vi.mock('../../components/ExamSimulation.css', () => ({}))

// Mock exam-api
const mockStartExam = vi.fn()
const mockSubmitAnswer = vi.fn()
const mockFinishExam = vi.fn()
const mockGetExamHistory = vi.fn()

vi.mock('../../services/exam-api', () => ({
  examApi: {
    startExam: (...args: unknown[]) => mockStartExam(...args),
    submitAnswer: (...args: unknown[]) => mockSubmitAnswer(...args),
    finishExam: (...args: unknown[]) => mockFinishExam(...args),
    getExamHistory: (...args: unknown[]) => mockGetExamHistory(...args),
  },
}))

const mockExamStart = {
  sessionId: 'exam-1',
  status: 'IN_PROGRESS',
  timeLimitMinutes: 300,
  currentQuestion: {
    questionId: 'q1',
    questionNumber: 1,
    topic: 'Pharmacology',
    difficulty: 0.5,
    difficultyLabel: 'Medium',
    stem: 'What is the action of metoprolol?',
    options: [
      { id: 'A', text: 'Beta blocker' },
      { id: 'B', text: 'ACE inhibitor' },
      { id: 'C', text: 'Calcium channel blocker' },
      { id: 'D', text: 'Diuretic' },
    ],
    type: 'mc',
    maxQuestions: 145,
    minQuestions: 75,
  },
  totalQuestions: 145,
  currentDifficulty: 0.5,
}

describe('ExamSimulation', () => {
  beforeEach(() => {
    mockStartExam.mockReset()
    mockSubmitAnswer.mockReset()
    mockFinishExam.mockReset()
    mockGetExamHistory.mockReset()
  })

  // ── Start Screen ─────────────────────────────────────────────

  it('renders start screen with exam info', () => {
    render(<ExamSimulation />)
    expect(screen.getByText('NCLEX-RN Exam Simulation')).toBeInTheDocument()
    expect(screen.getByText(/75–145/)).toBeInTheDocument()
    expect(screen.getByText(/5 hours/)).toBeInTheDocument()
    expect(screen.getByText(/Adaptive/)).toBeInTheDocument()
  })

  it('renders Begin Exam button', () => {
    render(<ExamSimulation />)
    expect(screen.getByRole('button', { name: /begin exam/i })).toBeInTheDocument()
  })

  it('renders View History button', () => {
    render(<ExamSimulation />)
    expect(screen.getByRole('button', { name: /view history/i })).toBeInTheDocument()
  })

  it('starts exam on Begin Exam click', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('What is the action of metoprolol?')).toBeInTheDocument()
    })
    expect(mockStartExam).toHaveBeenCalledOnce()
  })

  it('shows Starting... while loading', async () => {
    mockStartExam.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))
    expect(screen.getByText('Starting...')).toBeInTheDocument()
  })

  it('shows error when exam start fails', async () => {
    mockStartExam.mockRejectedValue(new Error('Server unavailable'))
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Server unavailable')).toBeInTheDocument()
    })
  })

  it('shows generic error for non-Error throws', async () => {
    mockStartExam.mockRejectedValue('some string error')
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Failed to start exam')).toBeInTheDocument()
    })
  })

  // ── Exam Screen ──────────────────────────────────────────────

  it('displays question with options after start', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('What is the action of metoprolol?')).toBeInTheDocument()
    })

    expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    expect(screen.getByText('ACE inhibitor')).toBeInTheDocument()
    expect(screen.getByText('Calcium channel blocker')).toBeInTheDocument()
    expect(screen.getByText('Diuretic')).toBeInTheDocument()
  })

  it('shows question count and difficulty', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText(/Question 1 of 75–145/)).toBeInTheDocument()
    })
    expect(screen.getByText('Medium')).toBeInTheDocument()
  })

  it('Next button is disabled when no answer selected', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    })
  })

  it('enables Next button when an answer is selected', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta blocker'))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('submits answer and loads next question', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    mockSubmitAnswer.mockResolvedValue({
      correct: true,
      questionsAnswered: 1,
      currentDifficulty: 0.55,
      nextQuestion: {
        questionId: 'q2',
        questionNumber: 2,
        topic: 'Safety',
        difficulty: 0.55,
        difficultyLabel: 'Medium',
        stem: 'What is the priority nursing action?',
        options: [
          { id: 'A', text: 'Call the physician' },
          { id: 'B', text: 'Assess the patient' },
        ],
        type: 'mc',
        maxQuestions: 145,
        minQuestions: 75,
      },
      elapsedSeconds: 45,
      examContinues: true,
    })

    render(<ExamSimulation />)
    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta blocker'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText('What is the priority nursing action?')).toBeInTheDocument()
    })
  })

  it('shows results when exam ends after answer', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    mockSubmitAnswer.mockResolvedValue({
      correct: true,
      questionsAnswered: 75,
      currentDifficulty: 0.7,
      elapsedSeconds: 3600,
      examContinues: false,
      passPrediction: true,
      confidenceLevel: 0.95,
      totalQuestions: 75,
      correctCount: 60,
      accuracy: 80,
      topicBreakdown: {},
      timeAnalysis: { avgTimePerQuestion: 48, totalTimeMinutes: 60, remainingMinutes: 240 },
      difficultyAnalysis: { initial: 0.5, average: 0.6, final: 0.7, trend: 'increasing' },
    })

    render(<ExamSimulation />)
    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta blocker'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
  })

  it('shows End Exam button during exam', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /end exam/i })).toBeInTheDocument()
    })
  })

  it('shows error when answer submission fails', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    mockSubmitAnswer.mockRejectedValue(new Error('Submission failed'))
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta blocker'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText('Submission failed')).toBeInTheDocument()
    })
  })

  // ── History Screen ───────────────────────────────────────────

  it('shows empty history message', async () => {
    mockGetExamHistory.mockResolvedValue([])
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /view history/i }))

    await waitFor(() => {
      expect(screen.getByText(/no exam sessions yet/i)).toBeInTheDocument()
    })
  })

  it('shows history items', async () => {
    mockGetExamHistory.mockResolvedValue([
      {
        sessionId: 's1',
        status: 'COMPLETED',
        totalQuestions: 75,
        correctCount: 60,
        passPrediction: true,
        confidenceLevel: 0.95,
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T11:00:00Z',
        elapsedSeconds: 3600,
      },
    ])
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /view history/i }))

    await waitFor(() => {
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
    expect(screen.getByText('75 questions')).toBeInTheDocument()
    expect(screen.getByText('60 correct')).toBeInTheDocument()
  })

  it('shows Back button in history and returns to start', async () => {
    mockGetExamHistory.mockResolvedValue([])
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /view history/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('NCLEX-RN Exam Simulation')).toBeInTheDocument()
  })

  it('handles history load error', async () => {
    mockGetExamHistory.mockRejectedValue(new Error('History load failed'))
    render(<ExamSimulation />)

    fireEvent.click(screen.getByRole('button', { name: /view history/i }))

    await waitFor(() => {
      expect(screen.getByText('History load failed')).toBeInTheDocument()
    })
  })

  // ── Results Screen ───────────────────────────────────────────

  it('shows Take Another Exam button on results', async () => {
    mockStartExam.mockResolvedValue(mockExamStart)
    mockSubmitAnswer.mockResolvedValue({
      correct: true,
      questionsAnswered: 75,
      currentDifficulty: 0.7,
      elapsedSeconds: 3600,
      examContinues: false,
      passPrediction: false,
      confidenceLevel: 0.9,
      totalQuestions: 75,
      correctCount: 30,
      accuracy: 40,
      topicBreakdown: {},
      timeAnalysis: { avgTimePerQuestion: 48, totalTimeMinutes: 60, remainingMinutes: 240 },
    })

    render(<ExamSimulation />)
    fireEvent.click(screen.getByRole('button', { name: /begin exam/i }))

    await waitFor(() => {
      expect(screen.getByText('Beta blocker')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Beta blocker'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText('BELOW PASSING')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /take another exam/i })).toBeInTheDocument()
  })
})
