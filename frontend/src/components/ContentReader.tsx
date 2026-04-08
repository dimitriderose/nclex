import { useEffect, useRef } from 'react'
import ePub from 'epubjs'
import type Book from 'epubjs/types/book'
import type Rendition from 'epubjs/types/rendition'
import '../styles/LibraryPage.css'

interface ContentReaderProps {
  epubUrl: string
  bookTitle: string
  onClose: () => void
}

export function ContentReader({ epubUrl, bookTitle, onClose }: ContentReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)

  useEffect(() => {
    if (!viewerRef.current) return

    const book = ePub(epubUrl)
    bookRef.current = book

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
    })
    renditionRef.current = rendition
    rendition.display()

    // Keyboard navigation
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') rendition.next()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') rendition.prev()
    }
    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('keydown', handleKey)
      book.destroy()
    }
  }, [epubUrl])

  const handlePrev = () => renditionRef.current?.prev()
  const handleNext = () => renditionRef.current?.next()

  return (
    <div className="reader-fullscreen">
      <div className="reader-toolbar">
        <button className="btn btn-secondary" onClick={onClose}>Back to Library</button>
        <span className="reader-title">{bookTitle}</span>
      </div>

      <div className="reader-epub-container" ref={viewerRef} />

      <div className="reader-nav">
        <button className="btn btn-secondary" onClick={handlePrev}>Previous</button>
        <button className="btn btn-secondary" onClick={handleNext}>Next</button>
      </div>
    </div>
  )
}
