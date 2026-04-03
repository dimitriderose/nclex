import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OfflineBanner, SyncStatusIndicator } from '../../components/OfflineBanner'

// Mock the useOnlineStatus hook
const mockTriggerSync = vi.fn().mockResolvedValue(undefined)
const mockHookReturn = {
  isOnline: true,
  queueLength: 0,
  lastSyncAt: null as string | null,
  offlineBankSize: 50,
  triggerSync: mockTriggerSync,
}

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockHookReturn,
}))

// Mock CSS import
vi.mock('../../components/OfflineBanner.css', () => ({}))

describe('OfflineBanner', () => {
  beforeEach(() => {
    mockHookReturn.isOnline = true
    mockHookReturn.queueLength = 0
    mockHookReturn.lastSyncAt = null
    mockHookReturn.offlineBankSize = 50
    mockTriggerSync.mockClear()
  })

  it('returns null when online with no pending items', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows offline banner when offline', () => {
    mockHookReturn.isOnline = false
    render(<OfflineBanner />)
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument()
    expect(screen.getByText(/50 available/i)).toBeInTheDocument()
  })

  it('shows pending sync items when online with queue', () => {
    mockHookReturn.queueLength = 3
    render(<OfflineBanner />)
    expect(screen.getByText(/3 pending sync items/i)).toBeInTheDocument()
  })

  it('shows singular "item" for queueLength of 1', () => {
    mockHookReturn.queueLength = 1
    render(<OfflineBanner />)
    expect(screen.getByText(/1 pending sync item$/)).toBeInTheDocument()
  })

  it('shows Sync Now button when online with pending items', () => {
    mockHookReturn.queueLength = 2
    render(<OfflineBanner />)
    const btn = screen.getByRole('button', { name: /sync now/i })
    expect(btn).toBeInTheDocument()
  })

  it('calls triggerSync when Sync Now button is clicked', () => {
    mockHookReturn.queueLength = 2
    render(<OfflineBanner />)
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    expect(mockTriggerSync).toHaveBeenCalledOnce()
  })

  it('shows last sync time when available', () => {
    mockHookReturn.isOnline = false
    mockHookReturn.lastSyncAt = '2026-01-15T10:30:00Z'
    render(<OfflineBanner />)
    expect(screen.getByText(/last synced/i)).toBeInTheDocument()
  })

  it('does not show last sync time when null', () => {
    mockHookReturn.isOnline = false
    mockHookReturn.lastSyncAt = null
    render(<OfflineBanner />)
    expect(screen.queryByText(/last synced/i)).not.toBeInTheDocument()
  })

  it('applies offline CSS class when offline', () => {
    mockHookReturn.isOnline = false
    const { container } = render(<OfflineBanner />)
    expect(container.querySelector('.offline')).toBeInTheDocument()
  })

  it('applies syncing CSS class when online with pending items', () => {
    mockHookReturn.queueLength = 1
    const { container } = render(<OfflineBanner />)
    expect(container.querySelector('.syncing')).toBeInTheDocument()
  })
})

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    mockHookReturn.isOnline = true
    mockHookReturn.queueLength = 0
  })

  it('shows Online when online', () => {
    render(<SyncStatusIndicator />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('shows Offline when offline', () => {
    mockHookReturn.isOnline = false
    render(<SyncStatusIndicator />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('shows pending count when queue has items', () => {
    mockHookReturn.queueLength = 5
    render(<SyncStatusIndicator />)
    expect(screen.getByText(/5 pending/)).toBeInTheDocument()
  })

  it('applies correct CSS class for online/offline state', () => {
    const { container, rerender } = render(<SyncStatusIndicator />)
    expect(container.querySelector('.online')).toBeInTheDocument()

    mockHookReturn.isOnline = false
    rerender(<SyncStatusIndicator />)
    expect(container.querySelector('.offline')).toBeInTheDocument()
  })
})
