import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../services/admin-api'
import { logger } from '../services/logger'
import type {
  AdminUserDto, AuditLogEntry, QuestionReportDto,
  ContentCacheStatusDto, KpiDto
} from '../types/admin'
import '../styles/AdminDashboard.css'

type Tab = 'users' | 'audit' | 'reports' | 'content' | 'kpis'

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'users', label: 'Users' },
    { key: 'audit', label: 'Audit Log' },
    { key: 'reports', label: 'Reports' },
    { key: 'content', label: 'Content' },
    { key: 'kpis', label: 'KPIs' },
  ]

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      <div className="admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`admin-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="admin-panel">
        {activeTab === 'users' && <UsersPanel />}
        {activeTab === 'audit' && <AuditLogPanel />}
        {activeTab === 'reports' && <ReportsPanel />}
        {activeTab === 'content' && <ContentCachePanel />}
        {activeTab === 'kpis' && <KpiPanel />}
      </div>
    </div>
  )
}

// ── Users Panel ──────────────────────────────────────────────

function UsersPanel() {
  const [users, setUsers] = useState<AdminUserDto[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.listUsers(search || undefined, page)
      setUsers(data.users)
      setTotalPages(data.totalPages)
    } catch (err) {
      logger.error('Failed to load users', { error: String(err) })
    } finally {
      setLoading(false)
    }
  }, [search, page])

  useEffect(() => { loadUsers() }, [loadUsers])

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!confirm(`Change user role to ${newRole}?`)) return
    await adminApi.updateUserRole(userId, newRole)
    loadUsers()
  }

  const handleSoftDelete = async (userId: string) => {
    if (!confirm('Soft delete this user? They will be marked for deletion.')) return
    await adminApi.softDeleteUser(userId)
    loadUsers()
  }

  const handleHardDelete = async (userId: string, email: string) => {
    if (!confirm(`PERMANENTLY delete ${email} and all their data? This cannot be undone.`)) return
    await adminApi.hardDeleteUser(userId)
    loadUsers()
  }

  return (
    <div>
      <div className="admin-toolbar">
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          className="admin-search"
        />
        <span className="admin-count">{loading ? 'Loading...' : `Page ${page + 1} of ${totalPages || 1}`}</span>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Questions</th>
            <th>Readiness</th>
            <th>Last Active</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={user.deletionRequestedAt ? 'row-deleted' : ''}>
              <td>{user.email}</td>
              <td>
                <select
                  value={user.role}
                  onChange={(e) => handleRoleChange(user.id, e.target.value)}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </td>
              <td>{user.questionsAnswered}</td>
              <td>{user.readinessScore.toFixed(1)}</td>
              <td>{user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleDateString() : 'Never'}</td>
              <td>{new Date(user.createdAt).toLocaleDateString()}</td>
              <td className="admin-actions">
                {!user.deletionRequestedAt && (
                  <button className="btn-warn" onClick={() => handleSoftDelete(user.id)}>Soft Delete</button>
                )}
                <button className="btn-danger" onClick={() => handleHardDelete(user.id, user.email)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-pagination">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  )
}

// ── Audit Log Panel ──────────────────────────────────────────

function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [eventType, setEventType] = useState('')
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.getAuditLog({ eventType: eventType || undefined, page })
      setLogs(data.logs)
      setTotalPages(data.totalPages)
    } catch (err) {
      logger.error('Failed to load audit log', { error: String(err) })
    } finally {
      setLoading(false)
    }
  }, [eventType, page])

  useEffect(() => { loadLogs() }, [loadLogs])

  const handleExport = async () => {
    const blob = await adminApi.exportAuditLogCsv({ eventType: eventType || undefined })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit_log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="admin-toolbar">
        <select value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(0) }}>
          <option value="">All Events</option>
          <option value="LOGIN">Login</option>
          <option value="REGISTER">Register</option>
          <option value="LOGOUT">Logout</option>
          <option value="CLAUDE_CHAT">Claude Chat</option>
          <option value="ERROR">Error</option>
          <option value="ADMIN_ROLE_CHANGE">Role Change</option>
          <option value="ADMIN_SOFT_DELETE">Soft Delete</option>
          <option value="ADMIN_HARD_DELETE">Hard Delete</option>
          <option value="VALIDATION_ERROR">Validation Error</option>
          <option value="AUTH_FAILURE">Auth Failure</option>
          <option value="EXTERNAL_SERVICE_ERROR">External Service Error</option>
          <option value="CLIENT_ERROR">Client Error</option>
          <option value="RATE_LIMIT_HIT">Rate Limit Hit</option>
          <option value="NOT_FOUND_ERROR">Not Found Error</option>
        </select>
        <button className="btn-primary" onClick={handleExport}>Export CSV</button>
        <span className="admin-count">{loading ? 'Loading...' : `Page ${page + 1} of ${totalPages || 1}`}</span>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>User ID</th>
            <th>Actor ID</th>
            <th>IP</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.createdAt).toLocaleString()}</td>
              <td><span className={`badge badge-${log.eventType.toLowerCase()}`}>{log.eventType}</span></td>
              <td className="uuid-cell">{log.userId?.substring(0, 8) || '-'}</td>
              <td className="uuid-cell">{log.actorId?.substring(0, 8) || '-'}</td>
              <td>{log.ipAddress || '-'}</td>
              <td className="meta-cell">{JSON.stringify(log.metadata).substring(0, 80)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-pagination">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  )
}

// ── Reports Panel ────────────────────────────────────────────

function ReportsPanel() {
  const [reports, setReports] = useState<QuestionReportDto[]>([])
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  const loadReports = useCallback(async () => {
    try {
      const data = await adminApi.getReports(status, page)
      setReports(data.reports)
      setTotalPages(data.totalPages)
    } catch (err) {
      logger.error('Failed to load reports', { error: String(err) })
    }
  }, [status, page])

  useEffect(() => { loadReports() }, [loadReports])

  const handleUpdate = async (reportId: string, newStatus: string) => {
    const notes = newStatus === 'DISMISSED' ? prompt('Dismissal reason (optional):') : null
    await adminApi.updateReport(reportId, newStatus, notes || undefined)
    loadReports()
  }

  return (
    <div>
      <div className="admin-toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="PENDING">Pending</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="FIXED">Fixed</option>
        </select>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Topic</th>
            <th>Reason</th>
            <th>User Notes</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
              <td>{r.questionTopic}</td>
              <td>{r.reportReason}</td>
              <td>{r.userNotes || '-'}</td>
              <td><span className={`badge badge-${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td className="admin-actions">
                {r.status === 'PENDING' && (
                  <>
                    <button className="btn-primary" onClick={() => handleUpdate(r.id, 'REVIEWED')}>Reviewed</button>
                    <button className="btn-warn" onClick={() => handleUpdate(r.id, 'DISMISSED')}>Dismiss</button>
                    <button className="btn-success" onClick={() => handleUpdate(r.id, 'FIXED')}>Fixed</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-pagination">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  )
}

// ── Content Cache Panel ──────────────────────────────────────

function ContentCachePanel() {
  const [cacheStatus, setCacheStatus] = useState<ContentCacheStatusDto[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const data = await adminApi.getContentCacheStatus()
      setCacheStatus(data)
    } catch (err) {
      logger.error('Failed to load cache status', { error: String(err) })
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const handleRefresh = async (source?: string) => {
    setRefreshing(true)
    try {
      await adminApi.triggerCacheRefresh(source)
      setTimeout(loadStatus, 2000)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <div className="admin-toolbar">
        <button
          className="btn-primary"
          onClick={() => handleRefresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh All Sources'}
        </button>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Entries</th>
            <th>Expired</th>
            <th>Last Indexed</th>
            <th>Oldest</th>
            <th>Newest</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cacheStatus.map((cs) => (
            <tr key={cs.source}>
              <td>{cs.source}</td>
              <td>{cs.entryCount}</td>
              <td className={cs.expiredCount > 0 ? 'text-warn' : ''}>{cs.expiredCount}</td>
              <td>{cs.lastIndexedAt ? new Date(cs.lastIndexedAt).toLocaleString() : 'Never'}</td>
              <td>{cs.oldestEntry ? new Date(cs.oldestEntry).toLocaleDateString() : '-'}</td>
              <td>{cs.newestEntry ? new Date(cs.newestEntry).toLocaleDateString() : '-'}</td>
              <td>
                <button className="btn-sm" onClick={() => handleRefresh(cs.source)} disabled={refreshing}>
                  Refresh
                </button>
              </td>
            </tr>
          ))}
          {cacheStatus.length === 0 && (
            <tr><td colSpan={7} className="empty-cell">No cached content sources found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── KPI Panel ────────────────────────────────────────────────

function KpiPanel() {
  const [kpis, setKpis] = useState<KpiDto | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getKpis()
      .then(setKpis)
      .catch((err) => logger.error('Failed to load KPIs', { error: String(err) }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading KPIs...</div>
  if (!kpis) return <div className="admin-error">Failed to load KPIs</div>

  const cards = [
    { label: 'Total Users', value: kpis.totalUsers, icon: 'users' },
    { label: 'Active Today', value: kpis.activeUsersToday, icon: 'activity' },
    { label: 'Questions Today', value: kpis.questionsAnsweredToday, icon: 'check' },
    { label: 'Claude Calls Today', value: kpis.claudeApiCallsToday, icon: 'cpu' },
    { label: 'Errors Today', value: kpis.errorCountToday, icon: 'alert', warn: kpis.errorCountToday > 0 },
    { label: 'Rate Limits Today', value: kpis.rateLimitHitsToday, icon: 'shield', warn: kpis.rateLimitHitsToday > 0 },
    { label: 'Signups This Week', value: kpis.signupsThisWeek, icon: 'plus' },
    { label: 'Avg Readiness', value: kpis.avgReadinessScore.toFixed(1), icon: 'target' },
    { label: 'Client Errors Today', value: kpis.clientErrorsToday, icon: 'alert', warn: kpis.clientErrorsToday > 0 },
    { label: 'Auth Failures Today', value: kpis.authFailuresToday, icon: 'alert', warn: kpis.authFailuresToday > 0 },
    { label: 'External Svc Errors', value: kpis.externalServiceErrorsToday, icon: 'alert', warn: kpis.externalServiceErrorsToday > 0 },
  ]

  return (
    <div className="kpi-grid">
      {cards.map((card) => (
        <div key={card.label} className={`kpi-card${card.warn ? ' kpi-warn' : ''}`}>
          <div className="kpi-value">{card.value}</div>
          <div className="kpi-label">{card.label}</div>
        </div>
      ))}
    </div>
  )
}
