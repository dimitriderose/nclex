import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HighlightPopup } from '../../../components/reader/HighlightPopup'

describe('HighlightPopup', () => {
  it('renders nothing when position is null', () => {
    const { container } = render(
      <HighlightPopup position={null} onHighlight={vi.fn()} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders 4 color buttons', () => {
    render(
      <HighlightPopup position={{ top: 50, left: 100 }} onHighlight={vi.fn()} onClose={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
  })

  it('clicking color calls onHighlight with color name and onClose', () => {
    const onHighlight = vi.fn()
    const onClose = vi.fn()
    render(
      <HighlightPopup position={{ top: 50, left: 100 }} onHighlight={onHighlight} onClose={onClose} />
    )
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    // The component passes the color name ('yellow'), not hex
    expect(onHighlight).toHaveBeenCalledWith('yellow')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape key closes popup', () => {
    const onClose = vi.fn()
    render(
      <HighlightPopup position={{ top: 50, left: 100 }} onHighlight={vi.fn()} onClose={onClose} />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('click outside closes popup', () => {
    const onClose = vi.fn()
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <HighlightPopup position={{ top: 50, left: 100 }} onHighlight={vi.fn()} onClose={onClose} />
      </div>
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('is positioned at the given coordinates', () => {
    render(
      <HighlightPopup position={{ top: 300, left: 200 }} onHighlight={vi.fn()} onClose={vi.fn()} />
    )
    const popup = document.querySelector('.highlight-popup') as HTMLElement
    expect(popup).toBeTruthy()
    expect(popup.style.left).toBe('200px')
    expect(popup.style.top).toBe('300px')
  })

  it('each button has different aria-label', () => {
    render(
      <HighlightPopup position={{ top: 50, left: 100 }} onHighlight={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByLabelText('Highlight yellow')).toBeInTheDocument()
    expect(screen.getByLabelText('Highlight green')).toBeInTheDocument()
    expect(screen.getByLabelText('Highlight blue')).toBeInTheDocument()
    expect(screen.getByLabelText('Highlight pink')).toBeInTheDocument()
  })
})
