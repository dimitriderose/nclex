import { useState } from 'react'
import { ContentReader } from '../components/ContentReader'
import '../styles/LibraryPage.css'

interface BookInfo {
  key: string
  title: string
  source: string
  epubFile: string
  pdfFile: string
}

const OPENRN_BOOKS: BookInfo[] = [
  {
    key: 'pharmacology',
    title: 'Nursing Pharmacology 2e',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Pharmacology-1714529271.epub',
    pdfFile: 'Nursing-Pharmacology-1714529312.pdf',
  },
  {
    key: 'fundamentals',
    title: 'Nursing Fundamentals 2e',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Fundamentals-2e-1771870888.epub',
    pdfFile: 'Nursing-Fundamentals-2e-1771870838.pdf',
  },
  {
    key: 'skills',
    title: 'Nursing Skills 2e',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Skills-2e-1720739235.epub',
    pdfFile: 'Nursing-Skills-2e-1720739301.pdf',
  },
  {
    key: 'mentalhealth',
    title: 'Nursing: Mental Health & Community Concepts 2e',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Mental-Health-and-Community-Concepts-2e-1773254138.epub',
    pdfFile: 'Nursing-Mental-Health-and-Community-Concepts-2e-1773254105.pdf',
  },
  {
    key: 'management',
    title: 'Nursing Management & Professional Concepts 2e',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Management-and-Professional-Concepts-2e-1771870794.epub',
    pdfFile: 'Nursing-Management-and-Professional-Concepts-2e-1771870775.pdf',
  },
  {
    key: 'advancedskills',
    title: 'Nursing Advanced Skills',
    source: 'OpenRN (CC-BY 4.0)',
    epubFile: 'Nursing-Advanced-Skills-1720731356.epub',
    pdfFile: 'Nursing-Advanced-Skills-1720731398.pdf',
  },
]

export function LibraryPage() {
  const [activeBook, setActiveBook] = useState<BookInfo | null>(null)

  if (activeBook) {
    return (
      <ContentReader
        epubUrl={`/books/epubs/${activeBook.epubFile}`}
        bookTitle={activeBook.title}
        contentKey={`openrn:${activeBook.key}`}
        onClose={() => setActiveBook(null)}
      />
    )
  }

  return (
    <div className="library-page">
      <div className="library-header">
        <h2>Textbook Library</h2>
        <p className="library-subtitle">
          Open-source nursing textbooks from OpenRN. Free to read, download, and share (CC-BY 4.0).
        </p>
      </div>

      <div className="library-grid">
        {OPENRN_BOOKS.map((book) => (
          <div key={book.key} className="library-card">
            <div className="library-card-body">
              <h3 className="library-card-title">{book.title}</h3>
              <span className="library-card-source">{book.source}</span>
            </div>
            <div className="library-card-actions">
              <button
                className="btn btn-primary"
                onClick={() => setActiveBook(book)}
              >
                Read
              </button>
              <a
                className="btn btn-secondary"
                href={`/books/epubs/${book.epubFile}`}
                download={book.epubFile}
              >
                EPUB
              </a>
              <a
                className="btn btn-secondary"
                href={`/books/pdfs/${book.pdfFile}`}
                download={book.pdfFile}
              >
                PDF
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
