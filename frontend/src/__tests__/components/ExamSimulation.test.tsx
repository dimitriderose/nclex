import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { server } from '../../test/mocks/server'
import { ExamSimulation } from '../../components/ExamSimulation'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('ExamSimulation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders start screen with Begin Exam button', () => {
    render(<ExamSimulation />)
    expect(screen.getByText('NCLEX-RN Exam Simulation')).toBeDefined()
    expect(screen.getByText('Begin Exam')).toBeDefined()
  })

  it('renders exam info on start screen', () => {
    render(<ExamSimulation />)
    expect(screen.getByText('75\u2013145 (CAT)')).toBeDefined()
    expect(screen.getByText('5 hours')).toBeDefined()
    expect(screen.getByText('Adaptive')).toBeDefined()
  })

  it('renders View History button on start screen', () => {
    render(<ExamSimulation />)
    expect(screen.getByText('View History')).toBeDefined()
  })

  it('starts exam on Begin Exam click', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText(/Test question stem\?/)).toBeDefined()
    })
  })

  it('displays question with options after starting', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText('Option A')).toBeDefined()
      expect(screen.getByText('Option B')).toBeDefined()
      expect(screen.getByText('Option C')).toBeDefined()
      expect(screen.getByText('Option D')).toBeDefined()
    })
  })

  it('shows topic and difficulty label', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText('Pharmacology')).toBeDefined()
      expect(screen.getByText('Medium')).toBeDefined()
    })
  })

  it('Next button is disabled until option is selected', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      const nextBtn = screen.getByText('Next')
      expect(nextBtn.hasAttribute('disabled')).toBe(true)
    })
  })

  it('handles answer submission and shows next question', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText('Option A')).toBeDefined()
    })

    fireEvent.click(screen.getByText('Option A'))
    fireEvent.click(screen.getByText('Next'))

    await waitFor(() => {
      expect(screen.getByText('Second question?')).toBeDefined()
    })
  })

  it('shows End Exam button during exam', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText('End Exam')).toBeDefined()
    })
  })

  it('shows results after finishing exam', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('Begin Exam'))

    await waitFor(() => {
      expect(screen.getByText('End Exam')).toBeDefined()
    })

    fireEvent.click(screen.getByText('End Exam'))

    await waitFor(() => {
      expect(screen.getByText('PASS')).toBeDefined()
    })
  })

  it('shows history when View History is clicked', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('View History'))

    await waitFor(() => {
      expect(screen.getByText('Exam History')).toBeDefined()
    })
  })

  it('shows empty history message when no sessions', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('View History'))

    await waitFor(() => {
      expect(screen.getByText('No exam sessions yet.')).toBeDefined()
    })
  })

  it('Back button returns to start from history', async () => {
    vi.useRealTimers()
    render(<ExamSimulation />)
    fireEvent.click(screen.getByText('View History'))

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeDefined()
    })

    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('NCLEX-RN Exam Simulation')).toBeDefined()
  })
})
