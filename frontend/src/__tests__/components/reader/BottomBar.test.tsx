import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BottomBar } from '../../../components/reader/BottomBar'

describe('BottomBar', () => {
  it('displays page number', () => {
    render(<BottomBar currentPage={2} totalPages={10} progressPercent={20} chapterInfo={null} />)
    expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument()
  })

  it('displays chapter title', () => {
    render(<BottomBar currentPage={0} totalPages={5} chapterInfo={{ current: 1, total: 3, title: 'Introduction' }} progressPercent={0} />)
    expect(screen.getByText(/Introduction/)).toBeInTheDocument()
  })

  it('does not show chapter when null', () => {
    render(<BottomBar currentPage={0} totalPages={5} chapterInfo={null} progressPercent={0} />)
    expect(screen.getByText(/1 \/ 5/)).toBeInTheDocument()
    expect(screen.queryByText('Introduction')).toBeNull()
  })

  it('progress bar has correct aria-valuenow', () => {
    render(<BottomBar currentPage={4} totalPages={10} progressPercent={44} chapterInfo={null} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('44')
  })

  it('progress fill width matches percent', () => {
    render(<BottomBar currentPage={4} totalPages={10} progressPercent={44} chapterInfo={null} />)
    const bar = screen.getByRole('progressbar')
    const fill = bar.querySelector('.page-progress-fill') as HTMLElement
    expect(fill.style.width).toBe('44%')
  })

  it('page-info has aria-live for accessibility', () => {
    render(<BottomBar currentPage={0} totalPages={5} progressPercent={0} chapterInfo={null} />)
    const pageInfo = screen.getByText(/1 \/ 5/).closest('[aria-live]')
    expect(pageInfo?.getAttribute('aria-live')).toBe('polite')
  })
})
