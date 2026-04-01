const BASE_URL = '/api'

async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (response.status === 401) {
    window.location.href = '/login'
    throw new Error('Authentication required')
  }

  if (response.status === 403) {
    throw new Error('Admin access required')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(body.message || 'Request failed')
  }

  return response
}

export const adminApi = {
  // Users
  async listUsers(search?: string, page = 0, size = 25) {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) params.set('search', search)
    const res = await adminFetch(`/admin/users?${params}`)
    return res.json()
  },

  async getUser(userId: string) {
    const res = await adminFetch(`/admin/users/${userId}`)
    return res.json()
  },

  async updateUserRole(userId: string, role: string) {
    const res = await adminFetch(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    return res.json()
  },

  async softDeleteUser(userId: string) {
    const res = await adminFetch(`/admin/users/${userId}/soft-delete`, { method: 'POST' })
    return res.json()
  },

  async hardDeleteUser(userId: string) {
    const res = await adminFetch(`/admin/users/${userId}?confirm=true`, { method: 'DELETE' })
    return res.json()
  },

  // Audit Log
  async getAuditLog(params: { eventType?: string; userId?: string; from?: string; to?: string; page?: number } = {}) {
    const sp = new URLSearchParams()
    if (params.eventType) sp.set('eventType', params.eventType)
    if (params.userId) sp.set('userId', params.userId)
    if (params.from) sp.set('from', params.from)
    if (params.to) sp.set('to', params.to)
    sp.set('page', String(params.page ?? 0))
    const res = await adminFetch(`/admin/audit-log?${sp}`)
    return res.json()
  },

  async exportAuditLogCsv(params: { eventType?: string; userId?: string; from?: string; to?: string } = {}) {
    const sp = new URLSearchParams()
    if (params.eventType) sp.set('eventType', params.eventType)
    if (params.userId) sp.set('userId', params.userId)
    if (params.from) sp.set('from', params.from)
    if (params.to) sp.set('to', params.to)
    const res = await adminFetch(`/admin/audit-log/export?${sp}`)
    return res.blob()
  },

  // Reports
  async getReports(status = 'PENDING', page = 0) {
    const res = await adminFetch(`/admin/reports?status=${status}&page=${page}`)
    return res.json()
  },

  async updateReport(reportId: string, status: string, reviewNotes?: string) {
    const res = await adminFetch(`/admin/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reviewNotes }),
    })
    return res.json()
  },

  // Content Cache
  async getContentCacheStatus() {
    const res = await adminFetch('/admin/content-cache')
    return res.json()
  },

  async triggerCacheRefresh(source?: string) {
    const params = source ? `?source=${encodeURIComponent(source)}` : ''
    const res = await adminFetch(`/admin/content-cache/refresh${params}`, { method: 'POST' })
    return res.json()
  },

  // KPIs
  async getKpis() {
    const res = await adminFetch('/admin/kpis')
    return res.json()
  },

  // Question reports (user-facing)
  async submitReport(data: { questionTopic: string; questionData: Record<string, unknown>; reportReason: string; userNotes?: string }) {
    const res = await adminFetch('/reports', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res.json()
  },
}
