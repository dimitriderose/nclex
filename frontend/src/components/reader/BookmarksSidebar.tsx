import { useState, useMemo } from 'react'
import type { Bookmark } from '../../hooks/useBookmarks'

interface BookmarksSidebarProps {
  bookmarks: Bookmark[]
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: number) => void
  onDelete: (page: number) => void
}

export function BookmarksSidebar({
  bookmarks,
  isOpen,
  onClose,
  onNavigate,
  onDelete,
}: BookmarksSidebarProps) {
  const [search, setSearch] = useState('')

  const sorted = useMemo(
    () => [...bookmarks].sort((a, b) => a.page - b.page),
    [bookmarks],
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted
    const q = search.toLowerCase()
    return sorted.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        String(b.page).includes(q),
    )
  }, [sorted, search])

  return (
    <div className={`bookmarks-sidebar${isOpen ? ' open' : ''}`}>
      <div className="sidebar-header">
        <h3>Bookmarks ({bookmarks.length})</h3>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close bookmarks">
          &times;
        </button>
      </div>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Search bookmarks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sidebar-search-input"
        />
      </div>

      <div className="sidebar-content">
        {filtered.length === 0 ? (
          <div className="sidebar-empty">
            {bookmarks.length === 0 ? (
              <>
                <p>No bookmarks yet.</p>
                <p className="sidebar-empty-hint">
                  Tap the bookmark icon to save the current page.
                </p>
              </>
            ) : (
              <p>No bookmarks match your search.</p>
            )}
          </div>
        ) : (
          <ul className="sidebar-list">
            {filtered.map((bm) => (
              <li
                key={bm.page}
                className="sidebar-item bookmark-item"
              >
                <div
                  className="sidebar-item-text"
                  onClick={() => onNavigate(bm.page)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNavigate(bm.page)
                  }}
                >
                  <span className="bookmark-page">Page {bm.page}</span>
                  <span className="bookmark-label">{bm.label}</span>
                </div>
                <button
                  className="sidebar-item-delete"
                  onClick={() => onDelete(bm.page)}
                  aria-label={`Delete bookmark page ${bm.page}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
