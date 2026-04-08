import { useState } from 'react'
import type { Highlight } from '../../hooks/useHighlights'

interface HighlightsSidebarProps {
  highlights: Highlight[]
  isOpen: boolean
  onClose: () => void
  onNavigate: (highlight: Highlight) => void
  onDelete: (id: string) => void
  onUpdateNote: (id: string, note: string) => void
}

const COLOR_MAP: Record<string, string> = {
  yellow: '#FFEB3B',
  green: '#66BB6A',
  blue: '#42A5F5',
  pink: '#EC407A',
}

export function HighlightsSidebar({
  highlights,
  isOpen,
  onClose,
  onNavigate,
  onDelete,
  onUpdateNote,
}: HighlightsSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const startEdit = (hl: Highlight) => {
    setEditingId(hl.id)
    setEditText(hl.note)
  }

  const commitEdit = () => {
    if (editingId) {
      onUpdateNote(editingId, editText.trim())
      setEditingId(null)
      setEditText('')
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  return (
    <div className={`highlights-sidebar${isOpen ? ' open' : ''}`}>
      <div className="sidebar-header">
        <h3>Highlights ({highlights.length})</h3>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close highlights">
          &times;
        </button>
      </div>

      <div className="sidebar-content">
        {highlights.length === 0 ? (
          <div className="sidebar-empty">
            <p>No highlights yet.</p>
            <p className="sidebar-empty-hint">
              Select text in the reader and choose a color to highlight.
            </p>
          </div>
        ) : (
          <ul className="sidebar-list">
            {highlights.map((hl) => (
              <li
                key={hl.id}
                className="sidebar-item"
                style={{ borderLeftColor: COLOR_MAP[hl.color] || COLOR_MAP.yellow }}
              >
                <div
                  className="sidebar-item-text"
                  onClick={() => onNavigate(hl)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNavigate(hl)
                  }}
                >
                  {hl.text.length > 140 ? hl.text.substring(0, 140) + '...' : hl.text}
                </div>

                {editingId === hl.id ? (
                  <div className="sidebar-item-note-edit">
                    <textarea
                      className="sidebar-note-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder="Add a note..."
                      autoFocus
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          commitEdit()
                        }
                        if (e.key === 'Escape') cancelEdit()
                      }}
                    />
                    <div className="sidebar-note-actions">
                      <button className="sidebar-note-save" onClick={commitEdit}>
                        Save
                      </button>
                      <button className="sidebar-note-cancel" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : hl.note ? (
                  <div
                    className="sidebar-item-note"
                    onClick={() => startEdit(hl)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') startEdit(hl)
                    }}
                  >
                    {hl.note}
                  </div>
                ) : (
                  <button
                    className="sidebar-item-add-note"
                    onClick={() => startEdit(hl)}
                  >
                    Add note
                  </button>
                )}

                <div className="sidebar-item-actions">
                  <button
                    className="sidebar-item-delete"
                    onClick={() => onDelete(hl.id)}
                    aria-label="Delete highlight"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
