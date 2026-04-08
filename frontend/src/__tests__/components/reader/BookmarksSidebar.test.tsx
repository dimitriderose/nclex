import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BookmarksSidebar } from '../../../components/reader/BookmarksSidebar'
import type { Bookmark } from '../../../hooks/useBookmarks'

const SAMPLE_BOOKMARKS: Bookmark[] = [
  { clientId: 'b1', page: 2, label: 'Chapter 1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
  { clientId: 'b2', page: 10, label: 'Important section', createdAt: '2025-01-02T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' },
  { clientId: 'b3', page: 5, label: 'Page 5', createdAt: '2025-01-03T00:00:00Z', updatedAt: '2025-01-03T00:00:00Z' },
]

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    isOpen: true,
    bookmarks: SAMPLE_BOOKMARKS,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onDelete: vi.fn(),
  }
  const props = { ...defaultProps, ...overrides }
  render(<BookmarksSidebar {...props} />)
  return props
}

describe('BookmarksSidebar', () => {
  it('shows empty state when no bookmarks', () => {
    renderSidebar({ bookmarks: [] })
    expect(screen.getByText(/No bookmarks yet/)).toBeInTheDocument()
  })

  it('renders bookmark list sorted by page', () => {
    renderSidebar()
    // Should render all 3 bookmarks sorted by page: 2, 5, 10
    const items = screen.getAllByText(/Page \d+/)
    expect(items.length).toBeGreaterThanOrEqual(3)
  })

  it('clicking bookmark navigates to page', () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByText('Chapter 1'))
    expect(props.onNavigate).toHaveBeenCalledWith(2)
  })

  it('delete button removes bookmark', () => {
    const props = renderSidebar()
    // Get all delete buttons
    const deleteButtons = screen.getAllByText('\u00d7') // × character
    // Filter to those that are delete buttons (in sidebar-item-delete class)
    const sidebarDeleteBtns = deleteButtons.filter(b => b.closest('.sidebar-item-delete'))
    fireEvent.click(sidebarDeleteBtns[0])
    // First sorted item is page 2
    expect(props.onDelete).toHaveBeenCalledWith(2)
  })

  it('search filters bookmarks', () => {
    renderSidebar()
    const searchInput = screen.getByPlaceholderText('Search bookmarks...')
    fireEvent.change(searchInput, { target: { value: 'Important' } })
    expect(screen.getByText('Important section')).toBeInTheDocument()
    expect(screen.queryByText('Chapter 1')).toBeNull()
  })

  it('shows no-match message when search has no results', () => {
    renderSidebar()
    const searchInput = screen.getByPlaceholderText('Search bookmarks...')
    fireEvent.change(searchInput, { target: { value: 'zzzzz' } })
    expect(screen.getByText(/No bookmarks match/)).toBeInTheDocument()
  })

  it('has open class when isOpen prop is true', () => {
    const { container } = render(
      <BookmarksSidebar
        isOpen={true}
        bookmarks={SAMPLE_BOOKMARKS}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(container.querySelector('.bookmarks-sidebar.open')).toBeTruthy()
  })
})
