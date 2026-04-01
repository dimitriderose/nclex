export interface AdminUserDto {
  id: string
  email: string
  role: string
  createdAt: string
  updatedAt: string
  deletionRequestedAt: string | null
  lastActiveAt: string | null
  questionsAnswered: number
  readinessScore: number
}

export interface AuditLogEntry {
  id: string
  eventType: string
  userId: string | null
  actorId: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

export interface QuestionReportDto {
  id: string
  userId: string
  questionTopic: string
  questionData: Record<string, unknown>
  reportReason: string
  userNotes: string | null
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'FIXED'
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ContentCacheStatusDto {
  source: string
  entryCount: number
  expiredCount: number
  lastIndexedAt: string | null
  oldestEntry: string | null
  newestEntry: string | null
}

export interface KpiDto {
  totalUsers: number
  activeUsersToday: number
  questionsAnsweredToday: number
  claudeApiCallsToday: number
  errorCountToday: number
  rateLimitHitsToday: number
  signupsThisWeek: number
  avgReadinessScore: number
}
