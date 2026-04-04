import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NGNCasePage } from '../../pages/NGNCasePage'

vi.mock('../../components/NGNCaseStudy', () => ({
  NGNCaseStudyComponent: ({ caseStudy }: { caseStudy: { title: string } }) => (
    <div>CaseStudy: {caseStudy.title}</div>
  ),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('NGNCasePage', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders topic select and generate button', () => {
    render(<NGNCasePage />)
    expect(screen.getByText('NGN Case Studies')).toBeInTheDocument()
    expect(screen.getByText('Start Case Study')).toBeInTheDocument()
  })

  it('renders topic options', () => {
    render(<NGNCasePage />)
    expect(screen.getByText('Heart Failure')).toBeInTheDocument()
    expect(screen.getByText('Diabetic Ketoacidosis')).toBeInTheDocument()
  })

  it('generates case study on button click', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'HF Case', scenario: 'test', tabs: [], questions: [] }),
    })

    render(<NGNCasePage />)
    fireEvent.click(screen.getByText('Start Case Study'))

    await waitFor(() => {
      expect(screen.getByText('CaseStudy: HF Case')).toBeInTheDocument()
    })
  })

  it('shows error on generation failure', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    render(<NGNCasePage />)
    fireEvent.click(screen.getByText('Start Case Study'))

    await waitFor(() => {
      expect(screen.getByText(/could not generate case study/i)).toBeInTheDocument()
    })
  })
})
