import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionCard } from '../../components/QuestionCard'
import type { GeneratedQuestion } from '../../types/content'

// Mock question-service
vi.mock('../../services/question-service', () => ({
  questionService: {
    scoreMC: vi.fn((selectedId: string, options: { id: string; isCorrect: boolean }[]) => {
      const opt = options.find(o => o.id === selectedId)
      return opt?.isCorrect ?? false
    }),
    scoreSATA: vi.fn(() => 1.0),
    scoreDosage: vi.fn((answer: number, correct: number) => answer === correct),
  },
}))

const baseQuestion: GeneratedQuestion = {
  id: 'q1',
  type: 'mc',
  stem: 'What is the normal heart rate?',
  options: [
    { id: 'A', text: '40-60 bpm', isCorrect: false },
    { id: 'B', text: '60-100 bpm', isCorrect: true },
    { id: 'C', text: '100-150 bpm', isCorrect: false },
    { id: 'D', text: '150-200 bpm', isCorrect: false },
  ],
  rationale: 'Normal resting heart rate is 60-100 bpm.',
  ncjmmStep: 'recognize_cues' as const,
  ncjmmValidated: true,
  topic: 'Vital Signs',
  subtopic: 'Heart Rate',
  difficulty: 'easy',
  source: 'OpenRN',
  sourceKey: 'vital-signs',
  partialCredit: null,
  calculation: null,
  createdAt: '2026-01-01T00:00:00Z',
}

describe('QuestionCard', () => {
  const onAnswer = vi.fn()

  beforeEach(() => {
    onAnswer.mockClear()
  })

  it('renders question stem', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText('What is the normal heart rate?')).toBeDefined()
  })

  it('renders all options', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText('40-60 bpm')).toBeDefined()
    expect(screen.getByText('60-100 bpm')).toBeDefined()
    expect(screen.getByText('100-150 bpm')).toBeDefined()
    expect(screen.getByText('150-200 bpm')).toBeDefined()
  })

  it('renders topic and subtopic', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText(/Vital Signs/)).toBeDefined()
  })

  it('renders type badge', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText('MC')).toBeDefined()
  })

  it('renders difficulty badge', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText('easy')).toBeDefined()
  })

  it('submit button is disabled when no option selected', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    const submitBtn = screen.getByText('Submit Answer')
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
  })

  it('handles option selection and submission', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByText('60-100 bpm'))
    const submitBtn = screen.getByText('Submit Answer')
    expect(submitBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submitBtn)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'q1',
      correct: true,
    }))
  })

  it('shows rationale after submission', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByText('Submit Answer'))
    expect(screen.getByText('Rationale')).toBeDefined()
    expect(screen.getByText('Normal resting heart rate is 60-100 bpm.')).toBeDefined()
  })

  it('shows source attribution after submission', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByText('Submit Answer'))
    expect(screen.getByText(/Source: OpenRN/)).toBeDefined()
  })

  it('shows SATA instruction for sata type', () => {
    const sataQuestion = { ...baseQuestion, type: 'sata' as const }
    render(<QuestionCard question={sataQuestion} onAnswer={onAnswer} />)
    expect(screen.getByText('Select all that apply.')).toBeDefined()
  })

  it('shows dosage input for dosage type', () => {
    const dosageQuestion = {
      ...baseQuestion,
      type: 'dosage' as const,
      calculation: { formula: 'dose/concentration', correctAnswer: 2.5, unit: 'mL', tolerance: 0.1 },
    }
    render(<QuestionCard question={dosageQuestion} onAnswer={onAnswer} />)
    expect(screen.getByPlaceholderText('Enter your answer')).toBeDefined()
    expect(screen.getByText('mL')).toBeDefined()
  })

  it('renders validated badge when ncjmmValidated is true', () => {
    render(<QuestionCard question={baseQuestion} onAnswer={onAnswer} />)
    expect(screen.getByTitle('NCJMM tag validated')).toBeDefined()
  })
})
