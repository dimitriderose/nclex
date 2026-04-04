import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../styles/AdminDashboard.css', () => ({}))
vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/admin-api', () => ({
  adminApi: {
    listUsers: vi.fn().mockResolvedValue({ users: [], totalPages: 0 }),
    getAuditLog: vi.fn().mockResolvedValue({ logs: [], totalPages: 0 }),
    exportAuditLogCsv: vi.fn().mockResolvedValue(new Blob(['csv'])),
    getReports: vi.fn().mockResolvedValue({ reports: [], totalPages: 0 }),
    getContentCacheStatus: vi.fn().mockResolvedValue([]),
    triggerCacheRefresh: vi.fn().mockResolvedValue({}),
    getKpis: vi.fn().mockResolvedValue({
      totalUsers: 100, activeUsersToday: 25, questionsAnsweredToday: 500,
      claudeApiCallsToday: 50, errorCountToday: 3, rateLimitHitsToday: 5,
      signupsThisWeek: 10, avgReadinessScore: 72.5,
      clientErrorsToday: 1, authFailuresToday: 2, externalServiceErrorsToday: 0,
    }),
    updateUserRole: vi.fn(),
    softDeleteUser: vi.fn(),
    hardDeleteUser: vi.fn(),
    updateReport: vi.fn(),
  },
}))

import { adminApi } from '../../services/admin-api'
import { AdminDashboard } from '../../pages/AdminDashboard'

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], totalPages: 0 })
  })

  it('renders admin dashboard with tabs', () => {
    render(<AdminDashboard />)
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('Audit Log')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('KPIs')).toBeInTheDocument()
  })

  it('shows users panel by default', async () => {
    render(<AdminDashboard />)
    await waitFor(() => {
      expect(adminApi.listUsers).toHaveBeenCalled()
    })
  })

  it('switches to audit log tab', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Audit Log'))
    await waitFor(() => {
      expect(adminApi.getAuditLog).toHaveBeenCalled()
    })
  })

  it('switches to KPIs tab and shows data', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('KPIs'))
    await waitFor(() => {
      expect(adminApi.getKpis).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('Total Users')).toBeInTheDocument()
    })
  })

  it('switches to content tab', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))
    await waitFor(() => {
      expect(adminApi.getContentCacheStatus).toHaveBeenCalled()
    })
  })

  it('switches to reports tab', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))
    await waitFor(() => {
      expect(adminApi.getReports).toHaveBeenCalled()
    })
  })

  it('renders user table with data', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users: [
        {
          id: 'user-1',
          email: 'alice@test.com',
          role: 'USER',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          deletionRequestedAt: null,
          lastActiveAt: '2024-06-15T10:00:00Z',
          questionsAnswered: 42,
          readinessScore: 78.5,
        },
        {
          id: 'user-2',
          email: 'bob@test.com',
          role: 'ADMIN',
          createdAt: '2024-02-01T00:00:00Z',
          updatedAt: '2024-02-02T00:00:00Z',
          deletionRequestedAt: '2024-07-01T00:00:00Z',
          lastActiveAt: null,
          questionsAnswered: 0,
          readinessScore: 0,
        },
      ],
      totalPages: 1,
    })

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('alice@test.com')).toBeInTheDocument()
    })
    expect(screen.getByText('bob@test.com')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('78.5')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
  })

  it('renders audit log with data', async () => {
    vi.mocked(adminApi.getAuditLog).mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          eventType: 'LOGIN',
          userId: 'abcdefgh-1234-5678-9012',
          actorId: null,
          metadata: { browser: 'Chrome' },
          ipAddress: '192.168.1.1',
          createdAt: '2024-06-15T10:00:00Z',
        },
      ],
      totalPages: 1,
    })

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Audit Log'))
    await waitFor(() => {
      expect(screen.getByText('LOGIN')).toBeInTheDocument()
    })
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument()
    expect(screen.getByText('abcdefgh')).toBeInTheDocument()
  })

  it('renders reports panel with data and action buttons', async () => {
    vi.mocked(adminApi.getReports).mockResolvedValue({
      reports: [
        {
          id: 'report-1',
          userId: 'user-1',
          questionTopic: 'Pharmacology',
          questionData: {},
          reportReason: 'Incorrect answer',
          userNotes: 'Answer B should be correct',
          status: 'PENDING',
          reviewNotes: null,
          reviewedAt: null,
          createdAt: '2024-06-15T00:00:00Z',
          updatedAt: '2024-06-15T00:00:00Z',
        },
      ],
      totalPages: 1,
    })

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))
    await waitFor(() => {
      expect(screen.getByText('Pharmacology')).toBeInTheDocument()
    })
    expect(screen.getByText('Incorrect answer')).toBeInTheDocument()
    expect(screen.getByText('Answer B should be correct')).toBeInTheDocument()
    // "Reviewed" appears as both a dropdown option and an action button
    expect(screen.getByRole('button', { name: 'Reviewed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fixed' })).toBeInTheDocument()
  })

  it('renders KPI cards with actual values', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('KPIs'))
    await waitFor(() => {
      expect(screen.getByText('Total Users')).toBeInTheDocument()
    })
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('Active Today')).toBeInTheDocument()
    expect(screen.getByText('Questions Today')).toBeInTheDocument()
    expect(screen.getByText('Avg Readiness')).toBeInTheDocument()
    expect(screen.getByText('72.5')).toBeInTheDocument()
  })

  it('renders content cache panel with data', async () => {
    vi.mocked(adminApi.getContentCacheStatus).mockResolvedValue([
      {
        source: 'fda',
        entryCount: 150,
        expiredCount: 5,
        lastIndexedAt: '2024-06-15T10:00:00Z',
        oldestEntry: '2024-01-01T00:00:00Z',
        newestEntry: '2024-06-15T00:00:00Z',
      },
    ])

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))
    await waitFor(() => {
      expect(screen.getByText('fda')).toBeInTheDocument()
    })
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows empty state in content cache panel', async () => {
    vi.mocked(adminApi.getContentCacheStatus).mockResolvedValue([])
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))
    await waitFor(() => {
      expect(screen.getByText('No cached content sources found')).toBeInTheDocument()
    })
  })

  it('handles KPI loading failure', async () => {
    vi.mocked(adminApi.getKpis).mockRejectedValue(new Error('Failed'))
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('KPIs'))
    await waitFor(() => {
      expect(screen.getByText('Failed to load KPIs')).toBeInTheDocument()
    })
  })

  it('shows user search input', async () => {
    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search by email...')).toBeInTheDocument()
    })
  })

  it('handles user search', async () => {
    render(<AdminDashboard />)
    await waitFor(() => {
      expect(adminApi.listUsers).toHaveBeenCalled()
    })
    const searchInput = screen.getByPlaceholderText('Search by email...')
    fireEvent.change(searchInput, { target: { value: 'alice' } })
    await waitFor(() => {
      expect(adminApi.listUsers).toHaveBeenCalledWith('alice', 0)
    })
  })

  it('renders pagination buttons in users panel', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], totalPages: 3 })
    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Previous')).toBeInTheDocument()
      expect(screen.getByText('Next')).toBeInTheDocument()
    })
  })

  it('handles soft delete user action', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users: [{
        id: 'u1', email: 'test@test.com', role: 'USER',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        deletionRequestedAt: null, lastActiveAt: null,
        questionsAnswered: 0, readinessScore: 0,
      }],
      totalPages: 1,
    })
    vi.mocked(adminApi.softDeleteUser).mockResolvedValue(undefined as any)

    // Mock confirm
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Soft Delete'))
    await waitFor(() => {
      expect(adminApi.softDeleteUser).toHaveBeenCalledWith('u1')
    })

    vi.mocked(globalThis.confirm).mockRestore()
  })

  it('handles hard delete user action', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users: [{
        id: 'u1', email: 'test@test.com', role: 'USER',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        deletionRequestedAt: null, lastActiveAt: null,
        questionsAnswered: 0, readinessScore: 0,
      }],
      totalPages: 1,
    })
    vi.mocked(adminApi.hardDeleteUser).mockResolvedValue(undefined as any)
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(adminApi.hardDeleteUser).toHaveBeenCalledWith('u1')
    })

    vi.mocked(globalThis.confirm).mockRestore()
  })

  it('handles role change', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users: [{
        id: 'u1', email: 'test@test.com', role: 'USER',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        deletionRequestedAt: null, lastActiveAt: null,
        questionsAnswered: 0, readinessScore: 0,
      }],
      totalPages: 1,
    })
    vi.mocked(adminApi.updateUserRole).mockResolvedValue(undefined as any)
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('test@test.com')).toBeInTheDocument()
    })

    const roleSelect = screen.getByDisplayValue('USER')
    fireEvent.change(roleSelect, { target: { value: 'ADMIN' } })
    await waitFor(() => {
      expect(adminApi.updateUserRole).toHaveBeenCalledWith('u1', 'ADMIN')
    })

    vi.mocked(globalThis.confirm).mockRestore()
  })

  it('handles export audit log CSV', async () => {
    const mockBlob = new Blob(['csv data'])
    vi.mocked(adminApi.exportAuditLogCsv).mockResolvedValue(mockBlob)

    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:url')
    const mockRevokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = mockCreateObjectURL
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Audit Log'))

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Export CSV'))
    await waitFor(() => {
      expect(adminApi.exportAuditLogCsv).toHaveBeenCalled()
    })
  })

  it('handles report status update', async () => {
    vi.mocked(adminApi.getReports).mockResolvedValue({
      reports: [{
        id: 'r1', userId: 'u1', questionTopic: 'Test', questionData: {},
        reportReason: 'Wrong', userNotes: null, status: 'PENDING',
        reviewNotes: null, reviewedAt: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      }],
      totalPages: 1,
    })
    vi.mocked(adminApi.updateReport).mockResolvedValue(undefined as any)

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fixed' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))
    await waitFor(() => {
      expect(adminApi.updateReport).toHaveBeenCalledWith('r1', 'FIXED', undefined)
    })
  })

  it('handles content cache refresh', async () => {
    vi.mocked(adminApi.getContentCacheStatus).mockResolvedValue([
      {
        source: 'fda', entryCount: 10, expiredCount: 0,
        lastIndexedAt: null, oldestEntry: null, newestEntry: null,
      },
    ])
    vi.mocked(adminApi.triggerCacheRefresh).mockResolvedValue(undefined as any)

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))

    await waitFor(() => {
      expect(screen.getByText('Refresh All Sources')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Refresh All Sources'))
    await waitFor(() => {
      expect(adminApi.triggerCacheRefresh).toHaveBeenCalled()
    })
  })

  it('cancels soft delete when confirm returns false', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users: [{
        id: 'u1', email: 'test@test.com', role: 'USER',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        deletionRequestedAt: null, lastActiveAt: null,
        questionsAnswered: 0, readinessScore: 0,
      }],
      totalPages: 1,
    })
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Soft Delete')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Soft Delete'))
    expect(adminApi.softDeleteUser).not.toHaveBeenCalled()

    vi.mocked(globalThis.confirm).mockRestore()
  })

  it('handles dismiss report with prompt', async () => {
    vi.mocked(adminApi.getReports).mockResolvedValue({
      reports: [{
        id: 'r1', userId: 'u1', questionTopic: 'Test', questionData: {},
        reportReason: 'Wrong', userNotes: null, status: 'PENDING',
        reviewNotes: null, reviewedAt: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      }],
      totalPages: 1,
    })
    vi.mocked(adminApi.updateReport).mockResolvedValue(undefined as any)
    vi.spyOn(globalThis, 'prompt').mockReturnValue('Not a real issue')

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => {
      expect(adminApi.updateReport).toHaveBeenCalledWith('r1', 'DISMISSED', 'Not a real issue')
    })

    vi.mocked(globalThis.prompt).mockRestore()
  })

  it('handles pagination in users panel', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], totalPages: 3 })

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => {
      expect(adminApi.listUsers).toHaveBeenCalledWith(undefined, 1)
    })
  })

  it('handles loadReports error gracefully', async () => {
    vi.mocked(adminApi.getReports).mockRejectedValue(new Error('network'))
    const { logger } = await import('../../services/logger')

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Failed to load reports', expect.any(Object))
    })
  })

  it('handles loadStatus error gracefully', async () => {
    vi.mocked(adminApi.getContentCacheStatus).mockRejectedValue(new Error('network'))
    const { logger } = await import('../../services/logger')

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Failed to load cache status', expect.any(Object))
    })
  })

  it('handles loadUsers error gracefully', async () => {
    vi.mocked(adminApi.listUsers).mockRejectedValue(new Error('network'))
    const { logger } = await import('../../services/logger')

    render(<AdminDashboard />)
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Failed to load users', expect.any(Object))
    })
  })

  it('handles audit log filter by event type', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Audit Log'))

    await waitFor(() => {
      expect(adminApi.getAuditLog).toHaveBeenCalled()
    })

    const eventSelect = screen.getByDisplayValue('All Events')
    fireEvent.change(eventSelect, { target: { value: 'LOGIN' } })
    await waitFor(() => {
      expect(adminApi.getAuditLog).toHaveBeenCalledWith({ eventType: 'LOGIN', page: 0 })
    })
  })

  it('handles refresh single source', async () => {
    vi.mocked(adminApi.getContentCacheStatus).mockResolvedValue([
      {
        source: 'fda', entryCount: 10, expiredCount: 0,
        lastIndexedAt: null, oldestEntry: null, newestEntry: null,
      },
    ])
    vi.mocked(adminApi.triggerCacheRefresh).mockResolvedValue(undefined as any)

    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Content'))

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument()
    })

    // Click individual refresh button (not "Refresh All Sources")
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => {
      expect(adminApi.triggerCacheRefresh).toHaveBeenCalledWith('fda')
    })
  })

  it('changes reports status filter', async () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByText('Reports'))

    await waitFor(() => {
      expect(adminApi.getReports).toHaveBeenCalledWith('PENDING', 0)
    })

    const statusSelect = screen.getByDisplayValue('Pending')
    fireEvent.change(statusSelect, { target: { value: 'REVIEWED' } })
    await waitFor(() => {
      expect(adminApi.getReports).toHaveBeenCalledWith('REVIEWED', 0)
    })
  })
})
