import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProgressDashboard } from '../../components/ProgressDashboard'

// Mock CSS import
vi.mock('../../components/ProgressDashboard.css', () => ({}))

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock api
const mockGetStats = vi.fn()
vi.mock('../../services/api', () => ({
  api: {
    getStats: (...args: unknown[]) => mockGetStats(...args),
  },
}))

describe('ProgressDashboard', () => {
  beforeEach(() => {
    mockGetStats.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading state initially', () => {
    mockGetStats.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ProgressDashboard />)
    expect(screen.getByText(/loading progress/i)).toBeInTheDocument()
  })

  it('shows empty state when no stats', async () => {
    mockGetStats.mockResolvedValue(null)
    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText(/no study data yet/i)).toBeInTheDocument()
    })
  })

  it('shows empty state when stats have no history', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [],
      streak: 0,
      readinessScore: 0,
      ncjmmScores: {},
    })
    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText(/no study data yet/i)).toBeInTheDocument()
    })
  })

  it('renders dashboard with stats data', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: { 'Pharmacological Therapies': 80 },
      history: [
        { topic: 'Pharmacological Therapies', correct: true, timestamp: '2026-01-15T10:00:00Z', ncjmmStep: 'recognize_cues' },
        { topic: 'Pharmacological Therapies', correct: false, timestamp: '2026-01-15T11:00:00Z', ncjmmStep: 'analyze_cues' },
        { topic: 'Management of Care', correct: true, timestamp: '2026-01-16T10:00:00Z', ncjmmStep: 'take_action' },
      ],
      streak: 5,
      readinessScore: 75,
      ncjmmScores: {},
    })

    render(<ProgressDashboard />)

    await waitFor(() => {
      expect(screen.getByText('Progress Dashboard')).toBeInTheDocument()
    })

    // Check readiness score is displayed
    expect(screen.getByText(/\d+%/)).toBeInTheDocument()

    // Check quick stats
    expect(screen.getByText('3')).toBeInTheDocument() // total questions
    expect(screen.getByText('5')).toBeInTheDocument() // streak

    // Check topic accuracy section
    expect(screen.getByText('Topic Accuracy')).toBeInTheDocument()
    expect(screen.getByText(/Pharmacological Therapies/)).toBeInTheDocument()
    expect(screen.getByText(/Management of Care/)).toBeInTheDocument()

    // Check NCJMM section
    expect(screen.getByText(/Clinical Judgment/)).toBeInTheDocument()
  })

  it('displays correct readiness band label', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Pharmacological Therapies', correct: true, timestamp: '2026-01-15T10:00:00Z' },
        { topic: 'Pharmacological Therapies', correct: true, timestamp: '2026-01-15T11:00:00Z' },
      ],
      streak: 10,
      readinessScore: 95,
      ncjmmScores: {},
    })

    render(<ProgressDashboard />)

    await waitFor(() => {
      // 100% accuracy on one topic = very high or high
      expect(screen.getByText(/Very High|High/)).toBeInTheDocument()
    })
  })

  it('handles API error gracefully', async () => {
    mockGetStats.mockRejectedValue(new Error('Network error'))
    render(<ProgressDashboard />)

    await waitFor(() => {
      // Should show empty state after error
      expect(screen.getByText(/no study data yet/i)).toBeInTheDocument()
    })
  })

  it('renders study activity section', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Safety', correct: true, timestamp: '2026-03-01T10:00:00Z' },
      ],
      streak: 1,
      readinessScore: 50,
      ncjmmScores: {},
    })

    render(<ProgressDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Study Activity/i)).toBeInTheDocument()
    })
  })

  it('shows recommendation text based on readiness band', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Unknown Topic', correct: false, timestamp: '2026-01-15T10:00:00Z' },
        { topic: 'Unknown Topic', correct: false, timestamp: '2026-01-15T11:00:00Z' },
        { topic: 'Unknown Topic', correct: false, timestamp: '2026-01-15T12:00:00Z' },
      ],
      streak: 0,
      readinessScore: 20,
      ncjmmScores: {},
    })

    render(<ProgressDashboard />)

    await waitFor(() => {
      // Low band recommendation
      expect(screen.getByText(/more study time needed/i)).toBeInTheDocument()
    })
  })
})
