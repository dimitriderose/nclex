import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryPage } from '../../pages/LibraryPage'

// Mock ContentReader to avoid its deep dependency tree
vi.mock('../../components/ContentReader', () => ({
  ContentReader: ({ bookTitle, onClose }: { bookTitle: string; onClose: () => void }) => (
    <div data-testid="content-reader">
      <span>{bookTitle}</span>
      <button onClick={onClose}>Close Reader</button>
    </div>
  ),
}))

// Mock the CSS import
vi.mock('../../styles/LibraryPage.css', () => ({}))

describe('LibraryPage', () => {
  it('renders all 6 book cards', () => {
    render(<LibraryPage />)
    const cards = document.querySelectorAll('.library-card')
    expect(cards.length).toBe(6)
  })

  it('each card has Read, EPUB, and PDF buttons', () => {
    render(<LibraryPage />)
    const readButtons = screen.getAllByText('Read')
    expect(readButtons).toHaveLength(6)
    const epubLinks = screen.getAllByText('EPUB')
    expect(epubLinks).toHaveLength(6)
    const pdfLinks = screen.getAllByText('PDF')
    expect(pdfLinks).toHaveLength(6)
  })

  it('clicking Read opens ContentReader', () => {
    render(<LibraryPage />)
    const readButtons = screen.getAllByText('Read')
    fireEvent.click(readButtons[0])
    expect(screen.getByTestId('content-reader')).toBeInTheDocument()
    expect(screen.getByText('Nursing Pharmacology 2e')).toBeInTheDocument()
  })

  it('EPUB download link has correct href', () => {
    render(<LibraryPage />)
    const epubLinks = screen.getAllByText('EPUB')
    expect(epubLinks[0].getAttribute('href')).toBe('/books/epubs/Nursing-Pharmacology-1714529271.epub')
  })

  it('PDF download link has correct href', () => {
    render(<LibraryPage />)
    const pdfLinks = screen.getAllByText('PDF')
    expect(pdfLinks[0].getAttribute('href')).toBe('/books/pdfs/Nursing-Pharmacology-1714529312.pdf')
  })

  it('closing ContentReader returns to library grid', () => {
    render(<LibraryPage />)
    fireEvent.click(screen.getAllByText('Read')[0])
    expect(screen.getByTestId('content-reader')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Close Reader'))
    expect(screen.queryByTestId('content-reader')).toBeNull()
    expect(screen.getByText('Textbook Library')).toBeInTheDocument()
  })
})
