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
})
