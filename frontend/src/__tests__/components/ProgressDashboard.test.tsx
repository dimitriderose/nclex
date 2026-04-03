import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProgressDashboard } from '../../components/ProgressDashboard'

// Mock api
vi.mock('../../services/api', () => ({
  api: {
    getStats: vi.fn(),
  },
}))

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { api } from '../../services/api'
const mockGetStats = vi.mocked(api.getStats)

describe('ProgressDashboard', () => {
  beforeEach(() => {
    mockGetStats.mockReset()
  })

  it('shows loading state initially', () => {
    mockGetStats.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ProgressDashboard />)
    expect(screen.getByText('Loading progress...')).toBeDefined()
  })

  it('shows empty state when no stats', async () => {
    mockGetStats.mockRejectedValue(new Error('Not found'))
    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText(/No study data yet/)).toBeDefined()
    })
  })

  it('renders dashboard with stats data', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Pharmacology', correct: true, timestamp: '2026-01-01T10:00:00Z' },
        { topic: 'Pharmacology', correct: false, timestamp: '2026-01-01T11:00:00Z' },
        { topic: 'Safety', correct: true, timestamp: '2026-01-02T10:00:00Z' },
      ],
      streak: 5,
      readinessScore: 75.0,
      ncjmmScores: {},
    } as any)

    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Progress Dashboard')).toBeDefined()
    })
    expect(screen.getByText('3')).toBeDefined() // total questions
    expect(screen.getByText('5')).toBeDefined() // streak
    expect(screen.getByText('Questions Answered')).toBeDefined()
    expect(screen.getByText('Day Streak')).toBeDefined()
  })

  it('shows topic accuracy bars', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Pharmacology', correct: true, timestamp: '2026-01-01T10:00:00Z' },
      ],
      streak: 1,
      readinessScore: 50.0,
      ncjmmScores: {},
    } as any)

    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Topic Accuracy')).toBeDefined()
    })
  })

  it('shows NCJMM steps section', async () => {
    mockGetStats.mockResolvedValue({
      topicScores: {},
      history: [
        { topic: 'Safety', correct: true, ncjmmStep: 'recognize_cues', timestamp: '2026-01-01T10:00:00Z' },
      ],
      streak: 1,
      readinessScore: 50.0,
      ncjmmScores: {},
    } as any)

    render(<ProgressDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Clinical Judgment (NCJMM) Steps')).toBeDefined()
    })
  })
})
