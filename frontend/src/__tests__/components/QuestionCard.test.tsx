import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionCard } from '../../components/QuestionCard'
import type { GeneratedQuestion } from '../../types/content'

// Mock the question-service module
vi.mock('../../services/question-service', () => ({
  questionService: {
    scoreSATA: vi.fn().mockReturnValue(1.0),
    scoreDosage: vi.fn().mockReturnValue(true),
    scoreMC: vi.fn().mockReturnValue(true),
  },
}))

import { questionService } from '../../services/question-service'

function makeMCQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    id: 'q1',
    type: 'mc',
    stem: 'What is the normal adult heart rate?',
    options: [
      { id: 'A', text: '40-60 bpm', isCorrect: false },
      { id: 'B', text: '60-100 bpm', isCorrect: true },
      { id: 'C', text: '100-120 bpm', isCorrect: false },
      { id: 'D', text: '120-140 bpm', isCorrect: false },
    ],
    rationale: 'Normal adult heart rate is 60-100 bpm.',
    ncjmmStep: 'recognize_cues',
    ncjmmValidated: true,
    topic: 'Cardiovascular',
    subtopic: 'Vital Signs',
    difficulty: 'easy',
    source: 'Saunders',
    sourceKey: 'Cardiovascular',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSATAQuestion(): GeneratedQuestion {
  return makeMCQuestion({
    id: 'q-sata',
    type: 'sata',
    stem: 'Select all signs of dehydration.',
    options: [
      { id: 'A', text: 'Dry mucous membranes', isCorrect: true },
      { id: 'B', text: 'Decreased urine output', isCorrect: true },
      { id: 'C', text: 'Hypertension', isCorrect: false },
      { id: 'D', text: 'Tachycardia', isCorrect: true },
    ],
    rationale: 'Signs of dehydration include dry membranes and tachycardia.',
  })
}

function makeDosageQuestion(): GeneratedQuestion {
  return makeMCQuestion({
    id: 'q-dosage',
    type: 'dosage',
    stem: 'Calculate the IV flow rate.',
    options: [],
    calculation: {
      formula: 'Volume / Time',
      correctAnswer: 25,
      unit: 'mL/hr',
      tolerance: 0.5,
    },
    rationale: 'The correct flow rate is 25 mL/hr.',
  })
}

describe('QuestionCard', () => {
  const onAnswer = vi.fn()

  beforeEach(() => {
    onAnswer.mockClear()
    vi.clearAllMocks()
  })

  // ── Rendering ────────────────────────────────────────────────

  it('renders question stem', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText('What is the normal adult heart rate?')).toBeInTheDocument()
  })

  it('renders all options for MC question', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText('40-60 bpm')).toBeInTheDocument()
    expect(screen.getByText('60-100 bpm')).toBeInTheDocument()
    expect(screen.getByText('100-120 bpm')).toBeInTheDocument()
    expect(screen.getByText('120-140 bpm')).toBeInTheDocument()
  })

  it('renders header badges (type, difficulty, NCJMM)', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText('MC')).toBeInTheDocument()
    expect(screen.getByText('easy')).toBeInTheDocument()
    expect(screen.getByText('Recognize Cues')).toBeInTheDocument()
  })

  it('renders validated badge when ncjmmValidated is true', () => {
    render(<QuestionCard question={makeMCQuestion({ ncjmmValidated: true })} onAnswer={onAnswer} />)
    expect(screen.getByTitle('NCJMM tag validated')).toBeInTheDocument()
  })

  it('does not render validated badge when ncjmmValidated is false', () => {
    render(<QuestionCard question={makeMCQuestion({ ncjmmValidated: false })} onAnswer={onAnswer} />)
    expect(screen.queryByTitle('NCJMM tag validated')).not.toBeInTheDocument()
  })

  it('renders topic and subtopic', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText(/Cardiovascular/)).toBeInTheDocument()
    expect(screen.getByText(/Vital Signs/)).toBeInTheDocument()
  })

  it('renders topic without subtopic when subtopic is undefined', () => {
    const { container } = render(<QuestionCard question={makeMCQuestion({ subtopic: undefined })} onAnswer={onAnswer} />)
    const topicEl = container.querySelector('.question-topic')!
    expect(topicEl.textContent).toBe('Cardiovascular')
  })

  it('renders Submit Answer button', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeInTheDocument()
  })

  it('Submit button is disabled when no option is selected', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeDisabled()
  })

  // ── MC interaction ───────────────────────────────────────────

  it('selects an option on click and enables submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByText('60-100 bpm'))
    expect(screen.getByRole('button', { name: /submit answer/i })).not.toBeDisabled()
  })

  it('calls onAnswer with correct result on MC submit', () => {
    vi.mocked(questionService.scoreMC).mockReturnValue(true)
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer).toHaveBeenCalledOnce()
    const result = onAnswer.mock.calls[0][0]
    expect(result.questionId).toBe('q1')
    expect(result.correct).toBe(true)
    expect(result.score).toBe(1)
    expect(result.selectedIds).toEqual(['B'])
    expect(result.ncjmmStep).toBe('recognize_cues')
    expect(result.topic).toBe('Cardiovascular')
    expect(result.timeTaken).toBeGreaterThanOrEqual(0)
  })

  it('calls onAnswer with incorrect result when wrong MC answer', () => {
    vi.mocked(questionService.scoreMC).mockReturnValue(false)
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('40-60 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer).toHaveBeenCalledOnce()
    const result = onAnswer.mock.calls[0][0]
    expect(result.correct).toBe(false)
    expect(result.score).toBe(0)
  })

  it('shows rationale after submission', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.queryByText(/normal adult heart rate is 60-100/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.getByText(/normal adult heart rate is 60-100/i)).toBeInTheDocument()
  })

  it('shows source attribution after submission', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.getByText(/Source: Saunders/i)).toBeInTheDocument()
  })

  it('hides Submit button after submission', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.queryByRole('button', { name: /submit answer/i })).not.toBeInTheDocument()
  })

  it('disables option buttons after submission', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const optionButtons = screen.getAllByRole('button')
    optionButtons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('does not allow double submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))
    expect(onAnswer).toHaveBeenCalledOnce()
  })

  it('MC selects only one option at a time', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('40-60 bpm'))
    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const result = onAnswer.mock.calls[0][0]
    expect(result.selectedIds).toEqual(['B'])
  })

  // ── SATA interaction ─────────────────────────────────────────

  it('renders SATA instruction text', () => {
    render(<QuestionCard question={makeSATAQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText(/select all that apply/i)).toBeInTheDocument()
  })

  it('allows multiple selections for SATA', () => {
    vi.mocked(questionService.scoreSATA).mockReturnValue(1.0)
    render(<QuestionCard question={makeSATAQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('Dry mucous membranes'))
    fireEvent.click(screen.getByText('Decreased urine output'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const result = onAnswer.mock.calls[0][0]
    expect(result.selectedIds).toContain('A')
    expect(result.selectedIds).toContain('B')
    expect(result.selectedIds).toHaveLength(2)
  })

  it('toggles SATA selection on re-click', () => {
    vi.mocked(questionService.scoreSATA).mockReturnValue(0.5)
    render(<QuestionCard question={makeSATAQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('Dry mucous membranes'))
    fireEvent.click(screen.getByText('Dry mucous membranes')) // deselect
    fireEvent.click(screen.getByText('Tachycardia'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const result = onAnswer.mock.calls[0][0]
    expect(result.selectedIds).toEqual(['D'])
  })

  it('marks SATA correct when score >= 0.8', () => {
    vi.mocked(questionService.scoreSATA).mockReturnValue(0.8)
    render(<QuestionCard question={makeSATAQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('Dry mucous membranes'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer.mock.calls[0][0].correct).toBe(true)
  })

  it('marks SATA incorrect when score < 0.8', () => {
    vi.mocked(questionService.scoreSATA).mockReturnValue(0.5)
    render(<QuestionCard question={makeSATAQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('Dry mucous membranes'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer.mock.calls[0][0].correct).toBe(false)
  })

  // ── Dosage interaction ───────────────────────────────────────

  it('renders dosage input instead of options', () => {
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByPlaceholderText(/enter your answer/i)).toBeInTheDocument()
    expect(screen.getByText('mL/hr')).toBeInTheDocument()
  })

  it('renders dosage formula', () => {
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByText(/Formula: Volume \/ Time/)).toBeInTheDocument()
  })

  it('Submit button is disabled when dosage answer is empty', () => {
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeDisabled()
  })

  it('handles correct dosage answer submission', () => {
    vi.mocked(questionService.scoreDosage).mockReturnValue(true)
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)

    const input = screen.getByPlaceholderText(/enter your answer/i)
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer).toHaveBeenCalledOnce()
    const result = onAnswer.mock.calls[0][0]
    expect(result.correct).toBe(true)
    expect(result.score).toBe(1)
  })

  it('shows correct answer after dosage submission', () => {
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)

    const input = screen.getByPlaceholderText(/enter your answer/i)
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.getByText(/Correct answer: 25 mL\/hr/i)).toBeInTheDocument()
  })

  it('handles incorrect dosage answer', () => {
    vi.mocked(questionService.scoreDosage).mockReturnValue(false)
    render(<QuestionCard question={makeDosageQuestion()} onAnswer={onAnswer} />)

    const input = screen.getByPlaceholderText(/enter your answer/i)
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(onAnswer.mock.calls[0][0].correct).toBe(false)
    expect(onAnswer.mock.calls[0][0].score).toBe(0)
  })

  // ── showRationale prop ───────────────────────────────────────

  it('shows rationale immediately when forceShowRationale is true', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} showRationale={true} />)
    expect(screen.getByText(/normal adult heart rate is 60-100/i)).toBeInTheDocument()
  })

  it('hides rationale initially when forceShowRationale is omitted', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)
    expect(screen.queryByText(/normal adult heart rate is 60-100/i)).not.toBeInTheDocument()
  })

  // ── Option class assignment ──────────────────────────────────

  it('marks correct options with correct class after submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const correctBtn = screen.getByText('60-100 bpm').closest('button')!
    expect(correctBtn.className).toContain('correct')
  })

  it('marks incorrect selection with incorrect class after submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('40-60 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const incorrectBtn = screen.getByText('40-60 bpm').closest('button')!
    expect(incorrectBtn.className).toContain('incorrect')
  })

  // ── Source attribution ───────────────────────────────────────

  it('shows sourceKey in parens when different from topic', () => {
    const q = makeMCQuestion({ source: 'Saunders', sourceKey: 'cardio_ch5', topic: 'Cardiovascular' })
    render(<QuestionCard question={q} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.getByText(/cardio_ch5/)).toBeInTheDocument()
  })

  it('does not show sourceKey in parens when same as topic', () => {
    const q = makeMCQuestion({ source: 'Saunders', sourceKey: 'Cardiovascular', topic: 'Cardiovascular' })
    render(<QuestionCard question={q} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    const sourceEl = screen.getByText(/Source: Saunders/)
    expect(sourceEl.textContent).not.toContain('(Cardiovascular)')
  })

  // ── Correct/incorrect visual feedback ────────────────────────

  it('shows check mark on correct options after submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    // Check mark character
    expect(screen.getByText('\u2713')).toBeInTheDocument()
  })

  it('shows X mark on incorrectly selected options after submit', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('40-60 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    expect(screen.getByText('\u2717')).toBeInTheDocument()
  })

  it('does not change selection after submission', () => {
    render(<QuestionCard question={makeMCQuestion()} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByText('60-100 bpm'))
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    // Try clicking another option - should be disabled
    fireEvent.click(screen.getByText('40-60 bpm'))
    // onAnswer should still only have been called once
    expect(onAnswer).toHaveBeenCalledOnce()
  })
})
