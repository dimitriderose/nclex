import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock window.location
const mockLocation = { href: '' }
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
})

import { adminApi } from '../../services/admin-api'

function mockOkResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data), blob: () => Promise.resolve(new Blob(['csv'])) }
}

function mock401Response() {
  return { ok: false, status: 401, json: () => Promise.resolve({}) }
}

function mock403Response() {
  return { ok: false, status: 403, json: () => Promise.resolve({}) }
}

function mockErrorResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error('not json')),
  }
}

describe('admin-api', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockLocation.href = ''
  })

  // ---- adminFetch error handling ----
  describe('adminFetch error handling', () => {
    it('redirects to /login on 401 and throws', async () => {
      mockFetch.mockResolvedValue(mock401Response())
      await expect(adminApi.listUsers()).rejects.toThrow('Authentication required')
      expect(mockLocation.href).toBe('/login')
    })

    it('throws admin access required on 403', async () => {
      mockFetch.mockResolvedValue(mock403Response())
      await expect(adminApi.listUsers()).rejects.toThrow('Admin access required')
    })

    it('throws error with message from response body on generic error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, { message: 'DB down' }))
      await expect(adminApi.listUsers()).rejects.toThrow('DB down')
    })

    it('throws fallback when JSON parse fails on generic error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500))
      await expect(adminApi.listUsers()).rejects.toThrow('Request failed')
    })

    it('throws fallback when body has no message on generic error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(422, {}))
      await expect(adminApi.listUsers()).rejects.toThrow('Request failed')
    })
  })

  // ---- listUsers ----
  describe('listUsers', () => {
    it('fetches users with default params', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ users: [] }))
      await adminApi.listUsers()
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/admin/users')
      expect(url).toContain('page=0')
      expect(url).toContain('size=25')
    })

    it('includes search param when provided', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ users: [] }))
      await adminApi.listUsers('john', 1, 10)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('search=john')
      expect(url).toContain('page=1')
      expect(url).toContain('size=10')
    })

    it('omits search param when undefined', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ users: [] }))
      await adminApi.listUsers(undefined, 2)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).not.toContain('search')
    })
  })

  // ---- getUser ----
  describe('getUser', () => {
    it('fetches single user', async () => {
      const user = { id: 'u1', email: 'a@b.com' }
      mockFetch.mockResolvedValue(mockOkResponse(user))
      const result = await adminApi.getUser('u1')
      expect(result).toEqual(user)
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/u1', expect.any(Object))
    })
  })

  // ---- updateUserRole ----
  describe('updateUserRole', () => {
    it('sends PATCH with role', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.updateUserRole('u1', 'admin')
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/u1/role', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      }))
    })
  })

  // ---- softDeleteUser ----
  describe('softDeleteUser', () => {
    it('sends POST to soft-delete endpoint', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.softDeleteUser('u1')
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/u1/soft-delete', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  // ---- hardDeleteUser ----
  describe('hardDeleteUser', () => {
    it('sends DELETE with confirm param', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.hardDeleteUser('u1')
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/users/u1?confirm=true', expect.objectContaining({
        method: 'DELETE',
      }))
    })
  })

  // ---- getAuditLog ----
  describe('getAuditLog', () => {
    it('builds query params from options', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ entries: [] }))
      await adminApi.getAuditLog({ eventType: 'LOGIN', userId: 'u1', from: '2024-01-01', to: '2024-12-31', page: 2 })
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('eventType=LOGIN')
      expect(url).toContain('userId=u1')
      expect(url).toContain('from=2024-01-01')
      expect(url).toContain('to=2024-12-31')
      expect(url).toContain('page=2')
    })

    it('uses default page 0 when no params', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ entries: [] }))
      await adminApi.getAuditLog()
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('page=0')
      expect(url).not.toContain('eventType')
    })
  })

  // ---- exportAuditLogCsv ----
  describe('exportAuditLogCsv', () => {
    it('returns blob from export endpoint', async () => {
      const blob = new Blob(['csv-data'])
      mockFetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
      const result = await adminApi.exportAuditLogCsv({ eventType: 'LOGIN' })
      expect(result).toBeInstanceOf(Blob)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('eventType=LOGIN')
    })

    it('works with no params', async () => {
      mockFetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([])) })
      await adminApi.exportAuditLogCsv()
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/api/admin/audit-log/export')
    })
  })

  // ---- getReports ----
  describe('getReports', () => {
    it('uses default status and page', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ reports: [] }))
      await adminApi.getReports()
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('status=PENDING')
      expect(url).toContain('page=0')
    })

    it('uses provided status and page', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ reports: [] }))
      await adminApi.getReports('RESOLVED', 3)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('status=RESOLVED')
      expect(url).toContain('page=3')
    })
  })

  // ---- updateReport ----
  describe('updateReport', () => {
    it('sends PATCH with status and reviewNotes', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.updateReport('r1', 'RESOLVED', 'Looks good')
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/reports/r1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED', reviewNotes: 'Looks good' }),
      }))
    })

    it('sends PATCH without reviewNotes', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.updateReport('r1', 'DISMISSED')
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/reports/r1', expect.objectContaining({
        body: JSON.stringify({ status: 'DISMISSED', reviewNotes: undefined }),
      }))
    })
  })

  // ---- getContentCacheStatus ----
  describe('getContentCacheStatus', () => {
    it('fetches cache status', async () => {
      const status = { totalEntries: 100, expired: 5 }
      mockFetch.mockResolvedValue(mockOkResponse(status))
      const result = await adminApi.getContentCacheStatus()
      expect(result).toEqual(status)
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/content-cache', expect.any(Object))
    })
  })

  // ---- triggerCacheRefresh ----
  describe('triggerCacheRefresh', () => {
    it('sends POST without source param', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.triggerCacheRefresh()
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/content-cache/refresh', expect.objectContaining({
        method: 'POST',
      }))
    })

    it('sends POST with encoded source param', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ ok: true }))
      await adminApi.triggerCacheRefresh('fda labels')
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('source=fda%20labels')
    })
  })

  // ---- getKpis ----
  describe('getKpis', () => {
    it('fetches KPI data', async () => {
      const kpis = { totalUsers: 500, activeToday: 50 }
      mockFetch.mockResolvedValue(mockOkResponse(kpis))
      const result = await adminApi.getKpis()
      expect(result).toEqual(kpis)
    })
  })

  // ---- submitReport ----
  describe('submitReport', () => {
    it('sends POST to /reports endpoint', async () => {
      const data = { questionTopic: 'pharm', questionData: { stem: 'Q1' }, reportReason: 'wrong answer' }
      mockFetch.mockResolvedValue(mockOkResponse({ id: 'r1' }))
      await adminApi.submitReport(data)
      expect(mockFetch).toHaveBeenCalledWith('/api/reports', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }))
    })

    it('sends POST with optional userNotes', async () => {
      const data = { questionTopic: 'pharm', questionData: {}, reportReason: 'error', userNotes: 'see line 5' }
      mockFetch.mockResolvedValue(mockOkResponse({ id: 'r2' }))
      const result = await adminApi.submitReport(data)
      expect(result).toEqual({ id: 'r2' })
    })
  })
})
