import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
  QuestionCard: () => <div>QuestionCard</div>,
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
})
