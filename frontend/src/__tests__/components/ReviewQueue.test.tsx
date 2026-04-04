import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../components/ReviewQueue.css', () => ({}))

vi.mock('../../services/api', () => ({
  api: {
    getFlags: vi.fn(),
  },
}))

vi.mock('../../services/spaced-repetition', () => ({
  spacedRepetitionService: {
    getDueItems: vi.fn(),
    reviewQuestion: vi.fn(),
  },
}))

vi.mock('../../components/QuestionCard', () => ({
  QuestionCard: ({ question, onAnswer }: { question: { stem: string }; onAnswer: (r: unknown) => void }) => (
    <div data-testid="question-card">
      <p>{question.stem}</p>
      <button onClick={() => onAnswer({ questionId: 'q1', correct: true, score: 1, selectedIds: ['A'], ncjmmStep: 'recognize_cues', topic: 'Test', timeTaken: 5 })}>
        Mock Answer
      </button>
    </div>
  ),
}))

import { api } from '../../services/api'
import { spacedRepetitionService } from '../../services/spaced-repetition'
import { ReviewQueue } from '../../components/ReviewQueue'
import type { SM2Data } from '../../types/content'

function makeSM2(overrides: Partial<SM2Data> = {}): SM2Data {
  return {
    easeFactor: 2.5,
    interval: 1,
    repetitions: 0,
    nextReviewDate: new Date().toISOString(),
    lastReviewDate: new Date().toISOString(),
    lastGrade: 3,
    ...overrides,
  }
}

function makeReviewItem(id: string) {
  return {
    flagId: id,
    question: {
      id: id,
      type: 'mc' as const,
      stem: `Question ${id}`,
      options: [{ id: 'A', text: 'Answer A', isCorrect: true }],
      rationale: 'Rationale',
      ncjmmStep: 'recognize_cues' as const,
      ncjmmValidated: true,
      topic: 'Test',
      difficulty: 'medium' as const,
      source: 'Test',
      sourceKey: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
    },
    sm2: makeSM2(),
    dueToday: true,
  }
}

describe('ReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    vi.mocked(api.getFlags).mockReturnValue(new Promise(() => {})) // never resolves
    render(<ReviewQueue />)
    expect(screen.getByText('Loading review queue...')).toBeInTheDocument()
  })

  it('shows empty state when no flags exist', async () => {
    vi.mocked(api.getFlags).mockResolvedValue([])
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([])

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('No reviews due today!')).toBeInTheDocument()
    })
    expect(screen.getByText('Flag questions during practice to build your review queue.')).toBeInTheDocument()
  })

  it('shows empty state with flags but none due today', async () => {
    const flags = [{ id: 'f1', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' }]
    vi.mocked(api.getFlags).mockResolvedValue(flags)
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([
      { ...makeReviewItem('f1'), dueToday: false },
    ])

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('No reviews due today!')).toBeInTheDocument()
    })
    expect(screen.getByText(/You have 1 flagged questions/)).toBeInTheDocument()
  })

  it('renders review flow with question card and grading buttons', async () => {
    const flags = [{ id: 'f1', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' }]
    vi.mocked(api.getFlags).mockResolvedValue(flags)
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([makeReviewItem('f1')])
    vi.mocked(spacedRepetitionService.reviewQuestion).mockReturnValue(makeSM2({ interval: 3 }))

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('Spaced Review')).toBeInTheDocument()
    })
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByTestId('question-card')).toBeInTheDocument()

    // Answer the question to show grading
    fireEvent.click(screen.getByText('Mock Answer'))

    expect(screen.getByText('How well did you know this?')).toBeInTheDocument()
    expect(screen.getByText(/Blackout/)).toBeInTheDocument()
    expect(screen.getByText(/Perfect/)).toBeInTheDocument()
  })

  it('shows summary after all questions graded', async () => {
    const flags = [{ id: 'f1', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' }]
    vi.mocked(api.getFlags).mockResolvedValue(flags)
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([makeReviewItem('f1')])
    const sm2Result = makeSM2({ interval: 3, nextReviewDate: '2026-04-06T00:00:00Z' })
    vi.mocked(spacedRepetitionService.reviewQuestion).mockReturnValue(sm2Result)

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('Spaced Review')).toBeInTheDocument()
    })

    // Answer and grade
    fireEvent.click(screen.getByText('Mock Answer'))
    fireEvent.click(screen.getByText(/Good/))

    expect(screen.getByText('Review Complete!')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument() // Reviewed count
    expect(screen.getByText('4.0')).toBeInTheDocument() // Avg grade
    expect(screen.getByText('Grade: 4')).toBeInTheDocument()
  })

  it('advances to next question on grade in multi-question flow', async () => {
    const flags = [
      { id: 'f1', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' },
      { id: 'f2', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' },
    ]
    vi.mocked(api.getFlags).mockResolvedValue(flags)
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([
      makeReviewItem('f1'),
      makeReviewItem('f2'),
    ])
    vi.mocked(spacedRepetitionService.reviewQuestion).mockReturnValue(makeSM2({ nextReviewDate: '2026-04-06T00:00:00Z' }))

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument()
    })

    // Answer and grade first question
    fireEvent.click(screen.getByText('Mock Answer'))
    fireEvent.click(screen.getByText(/Hard/))

    // Should advance to question 2
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('handles error loading flags gracefully', async () => {
    vi.mocked(api.getFlags).mockRejectedValue(new Error('Network error'))

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('No reviews due today!')).toBeInTheDocument()
    })
  })

  it('shows SM2 info in grading panel', async () => {
    const flags = [{ id: 'f1', userId: 'u1', topic: 'Test', question: {}, category: 'REVIEW' as const, notes: null, createdAt: '', updatedAt: '' }]
    vi.mocked(api.getFlags).mockResolvedValue(flags)
    vi.mocked(spacedRepetitionService.getDueItems).mockReturnValue([makeReviewItem('f1')])

    render(<ReviewQueue />)

    await waitFor(() => {
      expect(screen.getByText('Spaced Review')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Mock Answer'))

    expect(screen.getByText('Ease: 2.50')).toBeInTheDocument()
    expect(screen.getByText('Interval: 1d')).toBeInTheDocument()
    expect(screen.getByText('Reps: 0')).toBeInTheDocument()
  })
})
