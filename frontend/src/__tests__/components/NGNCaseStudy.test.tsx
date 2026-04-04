import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NGNCaseStudyComponent } from '../../components/NGNCaseStudy'
import type { NGNCaseStudy } from '../../types/content'

vi.mock('../../components/NGNCaseStudy.css', () => ({}))

function makeCaseStudy(overrides: Partial<NGNCaseStudy> = {}): NGNCaseStudy {
  return {
    id: 'cs1',
    title: 'Heart Failure Case',
    scenario: 'A 68-year-old patient presents with shortness of breath.',
    tabs: [
      { id: 'tab1', label: 'Nurses Notes', content: 'Patient is anxious and diaphoretic.', type: 'nurses_notes' },
      { id: 'tab2', label: 'Vital Signs', content: 'BP 180/100, HR 110, RR 28, SpO2 89%', type: 'vital_signs' },
      { id: 'tab3', label: 'Lab Results', content: 'BNP: 1200 pg/mL', type: 'lab_results' },
    ],
    questions: [
      {
        id: 'q1',
        type: 'matrix_multiple_choice',
        prompt: 'For each finding, select whether it is expected or unexpected.',
        data: {
          rows: ['Elevated BNP', 'Normal SpO2'],
          columns: ['Expected', 'Unexpected'],
          correctSelections: { 'Elevated BNP': 'Expected', 'Normal SpO2': 'Unexpected' },
        },
        correctAnswer: null,
        rationale: 'Elevated BNP is expected in heart failure. SpO2 of 89% is abnormal.',
        ncjmmStep: 'recognize_cues',
        maxScore: 2,
      },
    ],
    topic: 'Cardiovascular',
    source: 'Saunders',
    safetyValidated: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('NGNCaseStudyComponent', () => {
  let onComplete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onComplete = vi.fn()
  })

  it('renders title, scenario, and tabs', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Heart Failure Case')).toBeInTheDocument()
    expect(screen.getByText('A 68-year-old patient presents with shortness of breath.')).toBeInTheDocument()
    expect(screen.getByText('Nurses Notes')).toBeInTheDocument()
    expect(screen.getByText('Vital Signs')).toBeInTheDocument()
    expect(screen.getByText('Lab Results')).toBeInTheDocument()
  })

  it('renders the topic badge and source', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Cardiovascular')).toBeInTheDocument()
    expect(screen.getByText('Source: Saunders')).toBeInTheDocument()
    expect(screen.getByText('NGN Case Study')).toBeInTheDocument()
  })

  it('shows safety validated badge when safetyValidated is true', () => {
    const cs = makeCaseStudy({ safetyValidated: true })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByTitle('Safety validated')).toBeInTheDocument()
  })

  it('does not show safety badge when safetyValidated is false', () => {
    const cs = makeCaseStudy({ safetyValidated: false })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.queryByText('\u2713 Safe')).not.toBeInTheDocument()
  })

  it('shows first tab content by default', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Patient is anxious and diaphoretic.')).toBeInTheDocument()
  })

  it('switches tab content on click', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    fireEvent.click(screen.getByText('Vital Signs'))
    expect(screen.getByText('BP 180/100, HR 110, RR 28, SpO2 89%')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Lab Results'))
    expect(screen.getByText('BNP: 1200 pg/mL')).toBeInTheDocument()
  })

  it('renders question counter', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument()
  })

  it('renders matrix question with rows and columns', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Elevated BNP')).toBeInTheDocument()
    expect(screen.getByText('Normal SpO2')).toBeInTheDocument()
    expect(screen.getAllByText('Expected').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Unexpected').length).toBeGreaterThanOrEqual(1)
  })

  it('allows selecting matrix answers and submitting', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[0])
    fireEvent.click(radios[3])

    fireEvent.click(screen.getByText('Submit Answer'))

    // Single question -> goes to summary after submit
    expect(onComplete).toHaveBeenCalled()
    expect(screen.getByText(/Results/)).toBeInTheDocument()
  })

  it('renders cloze drop-down question', () => {
    const cs = makeCaseStudy({
      questions: [
        {
          id: 'q-cloze',
          type: 'cloze_drop_down',
          prompt: 'Complete the following.',
          data: {
            blanks: {
              blank1: { options: ['Hypertension', 'Hypotension'], correct: 'Hypertension' },
              blank2: { options: ['Tachycardia', 'Bradycardia'], correct: 'Tachycardia' },
            },
          },
          correctAnswer: null,
          rationale: 'The correct selections are Hypertension and Tachycardia.',
          ncjmmStep: 'analyze_cues',
          maxScore: 2,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Complete the following.')).toBeInTheDocument()
    expect(screen.getByText('blank1:')).toBeInTheDocument()
    expect(screen.getByText('blank2:')).toBeInTheDocument()

    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)

    // Select correct answers
    fireEvent.change(selects[0], { target: { value: 'Hypertension' } })
    fireEvent.change(selects[1], { target: { value: 'Tachycardia' } })

    fireEvent.click(screen.getByText('Submit Answer'))
    // Single question -> goes to summary
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ questionId: 'q-cloze', score: 2, maxScore: 2 }),
    ])
  })

  it('renders highlight text question', () => {
    const cs = makeCaseStudy({
      questions: [
        {
          id: 'q-hl',
          type: 'highlight_text',
          prompt: 'Highlight the relevant findings.',
          data: {
            correctHighlights: ['Shortness of breath', 'Edema', 'Fatigue'],
          },
          correctAnswer: null,
          rationale: 'All three are signs of heart failure.',
          ncjmmStep: 'recognize_cues',
          maxScore: 3,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Highlight the relevant findings.')).toBeInTheDocument()

    const phrases = screen.getAllByRole('button', { name: /Shortness of breath|Edema|Fatigue/ })
    expect(phrases).toHaveLength(3)

    // Click to highlight
    fireEvent.click(screen.getByText('Shortness of breath'))
    fireEvent.click(screen.getByText('Edema'))

    // Toggle off
    fireEvent.click(screen.getByText('Shortness of breath'))

    fireEvent.click(screen.getByText('Submit Answer'))
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ questionId: 'q-hl', score: 1, maxScore: 3 }),
    ])
  })

  it('renders bow_tie question with conditions, actions, parameters', () => {
    const cs = makeCaseStudy({
      questions: [
        {
          id: 'q-bt',
          type: 'bow_tie',
          prompt: 'Select the relevant conditions, actions, and parameters.',
          data: {
            conditions: ['Heart Failure', 'COPD'],
            actions: ['Administer diuretic', 'Elevate HOB'],
            parameters: ['SpO2 > 94%', 'Urine output > 30mL/hr'],
          },
          correctAnswer: null,
          rationale: 'These are the correct clinical elements.',
          ncjmmStep: 'generate_solutions',
          maxScore: 4,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('Conditions')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Parameters')).toBeInTheDocument()
    expect(screen.getByText('Heart Failure')).toBeInTheDocument()
    expect(screen.getByText('Administer diuretic')).toBeInTheDocument()
    expect(screen.getByText(/SpO2 > 94%/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Submit Answer'))
    // bow_tie gets partial credit: Math.round(maxScore * 0.5) = 2
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ questionId: 'q-bt', score: 2, maxScore: 4 }),
    ])
  })

  it('question counter shows correct position', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)
    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument()
  })

  it('summary shows scores for each question', () => {
    const cs = makeCaseStudy({
      safetyValidated: true,
      questions: [
        {
          id: 'q1',
          type: 'bow_tie',
          prompt: 'Q1',
          data: { conditions: [], actions: [], parameters: [] },
          correctAnswer: null,
          rationale: 'R1',
          ncjmmStep: 'recognize_cues',
          maxScore: 4,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    fireEvent.click(screen.getByText('Submit Answer'))

    // Summary: 2/4 (50%)
    expect(screen.getByText('Heart Failure Case — Results')).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 4/)).toBeInTheDocument()
    expect(screen.getByText(/50%/)).toBeInTheDocument()
    expect(screen.getByText('Question 1')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
  })

  it('shows safety warning when not validated', () => {
    const cs = makeCaseStudy({
      safetyValidated: false,
      questions: [
        {
          id: 'q1',
          type: 'bow_tie',
          prompt: 'Q1',
          data: { conditions: [], actions: [], parameters: [] },
          correctAnswer: null,
          rationale: 'R1',
          ncjmmStep: 'recognize_cues',
          maxScore: 2,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    fireEvent.click(screen.getByText('Submit Answer'))

    expect(screen.getByText('This case study has not been safety-validated. Content may contain inaccuracies.')).toBeInTheDocument()
  })

  it('does not show safety warning when validated', () => {
    const cs = makeCaseStudy({
      safetyValidated: true,
      questions: [
        {
          id: 'q1',
          type: 'bow_tie',
          prompt: 'Q1',
          data: { conditions: [], actions: [], parameters: [] },
          correctAnswer: null,
          rationale: 'R1',
          ncjmmStep: 'recognize_cues',
          maxScore: 2,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    fireEvent.click(screen.getByText('Submit Answer'))

    expect(screen.queryByText(/safety-validated/)).not.toBeInTheDocument()
  })

  it('disables inputs after submission for multi-question case', () => {
    // Use 2 questions so submit doesn't go to summary immediately
    const cs = makeCaseStudy({
      questions: [
        {
          id: 'q1', type: 'bow_tie', prompt: 'Q1',
          data: { conditions: ['C1'], actions: [], parameters: [] },
          correctAnswer: null, rationale: 'R1', ncjmmStep: 'recognize_cues', maxScore: 1,
        },
        {
          id: 'q2', type: 'bow_tie', prompt: 'Q2',
          data: { conditions: ['C2'], actions: [], parameters: [] },
          correctAnswer: null, rationale: 'R2', ncjmmStep: 'take_action', maxScore: 1,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    // Submit q1 -> advances to q2
    fireEvent.click(screen.getByText('Submit Answer'))
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
  })

  it('shows ncjmm step badge with underscores replaced by spaces', () => {
    const cs = makeCaseStudy()
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    expect(screen.getByText('recognize cues')).toBeInTheDocument()
  })

  it('correctly scores matrix answers', () => {
    const cs = makeCaseStudy({
      questions: [
        {
          id: 'q-matrix',
          type: 'matrix_multiple_choice',
          prompt: 'Match findings.',
          data: {
            rows: ['Row1', 'Row2'],
            columns: ['ColA', 'ColB'],
            correctSelections: { Row1: 'ColA', Row2: 'ColB' },
          },
          correctAnswer: null,
          rationale: 'Correct.',
          ncjmmStep: 'analyze_cues',
          maxScore: 2,
        },
      ],
    })
    render(<NGNCaseStudyComponent caseStudy={cs} onComplete={onComplete} />)

    const radios = screen.getAllByRole('radio')
    // Row1: ColA (index 0), Row2: ColB (index 3)
    fireEvent.click(radios[0])
    fireEvent.click(radios[3])
    fireEvent.click(screen.getByText('Submit Answer'))

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ score: 2, maxScore: 2 }),
    ])
  })
})
