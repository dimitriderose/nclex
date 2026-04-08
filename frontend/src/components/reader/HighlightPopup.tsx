import { useEffect, useRef } from 'react'

interface HighlightPopupProps {
  position: { top: number; left: number } | null
  onHighlight: (color: 'yellow' | 'green' | 'blue' | 'pink') => void
  onClose: () => void
}

const COLORS: Array<{ color: 'yellow' | 'green' | 'blue' | 'pink'; hex: string }> = [
  { color: 'yellow', hex: '#FFEB3B' },
  { color: 'green', hex: '#66BB6A' },
  { color: 'blue', hex: '#42A5F5' },
  { color: 'pink', hex: '#EC407A' },
]

export function HighlightPopup({ position, onHighlight, onClose }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!position) return

    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [position, onClose])

  if (!position) return null

  return (
    <div
      ref={ref}
      className="highlight-popup"
      style={{ top: position.top, left: position.left }}
    >
      {COLORS.map(({ color, hex }) => (
        <button
          key={color}
          className="highlight-color-btn"
          style={{ backgroundColor: hex }}
          aria-label={`Highlight ${color}`}
          onClick={() => {
            onHighlight(color)
            onClose()
          }}
        />
      ))}
    </div>
  )
}
