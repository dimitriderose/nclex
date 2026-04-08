import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HighlightsSidebar } from '../../../components/reader/HighlightsSidebar'
import type { Highlight } from '../../../hooks/useHighlights'

const SAMPLE_HIGHLIGHTS: Highlight[] = [
  { id: 'h1', text: 'Short highlight text', color: 'yellow', note: 'My note', startXpath: '', startOffset: 0, endXpath: '', endOffset: 5, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'h2', text: 'Another highlight', color: 'green', note: '', startXpath: '', startOffset: 0, endXpath: '', endOffset: 5, createdAt: '2025-01-02T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' },
  { id: 'h3', text: 'A'.repeat(200), color: 'blue', note: '', startXpath: '', startOffset: 0, endXpath: '', endOffset: 5, createdAt: '2025-01-03T00:00:00Z', updatedAt: '2025-01-03T00:00:00Z' },
]

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    isOpen: true,
    highlights: SAMPLE_HIGHLIGHTS,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onDelete: vi.fn(),
    onUpdateNote: vi.fn(),
  }
  const props = { ...defaultProps, ...overrides }
  render(<HighlightsSidebar {...props} />)
  return props
}

describe('HighlightsSidebar', () => {
  it('shows empty state when no highlights', () => {
    renderSidebar({ highlights: [] })
    expect(screen.getByText(/No highlights yet/)).toBeInTheDocument()
  })

  it('renders highlights list', () => {
    renderSidebar()
    expect(screen.getByText('Short highlight text')).toBeInTheDocument()
    expect(screen.getByText('Another highlight')).toBeInTheDocument()
  })

  it('truncates text longer than 140 characters', () => {
    renderSidebar()
    // The long text should be truncated to 140 chars + "..."
    const items = screen.getAllByText(/^A+/)
    const longItem = items.find((el) => el.textContent!.includes('...'))
    expect(longItem).toBeTruthy()
    expect(longItem!.textContent!.length).toBeLessThan(200)
  })

  it('clicking highlight navigates', () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByText('Short highlight text'))
    // onNavigate is called with the full Highlight object
    expect(props.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
  })

  it('delete button removes highlight', () => {
    const props = renderSidebar()
    const deleteButtons = screen.getAllByLabelText('Delete highlight')
    fireEvent.click(deleteButtons[0])
    expect(props.onDelete).toHaveBeenCalledWith('h1')
  })

  it('shows Add note button for highlights without notes', () => {
    renderSidebar()
    expect(screen.getAllByText('Add note').length).toBeGreaterThanOrEqual(1)
  })

  it('clicking note shows textarea and Enter saves', () => {
    const props = renderSidebar()
    // Click on the existing note (which is "My note" on h1) to start editing
    fireEvent.click(screen.getByText('My note'))
    const textarea = screen.getByPlaceholderText('Add a note...')
    fireEvent.change(textarea, { target: { value: 'Updated note' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onUpdateNote).toHaveBeenCalledWith('h1', 'Updated note')
  })

  it('Escape cancels note editing', () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByText('My note'))
    const textarea = screen.getByPlaceholderText('Add a note...')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    // Should go back to showing the note, not call update
    expect(props.onUpdateNote).not.toHaveBeenCalled()
  })

  it('has open class when isOpen prop is true', () => {
    const { container } = render(
      <HighlightsSidebar
        isOpen={true}
        highlights={SAMPLE_HIGHLIGHTS}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
        onUpdateNote={vi.fn()}
      />
    )
    expect(container.querySelector('.highlights-sidebar.open')).toBeTruthy()
  })
})
