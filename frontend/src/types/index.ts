// Auth types
export interface AuthUser {
  authenticated: true
  userId: string
  email: string
  role: string
}

export interface AuthResponse {
  message: string
  email?: string
}

// Stats types
export interface UserStats {
  id: string
  userId: string
  topicScores: Record<string, number>
  history: HistoryEntry[]
  streak: number
  readinessScore: number
  ncjmmScores: Record<string, number>
  lastActiveAt: string | null
  createdAt: string
  updatedAt: string
}

export interface HistoryEntry {
  topic: string
  correct: boolean
  timestamp: string
  [key: string]: unknown
}

// Flagged questions
export type FlagCategory = 'REVIEW' | 'WRONG' | 'BOOKMARK' | 'HARD'

export interface FlaggedQuestion {
  id: string
  userId: string
  topic: string
  question: Record<string, unknown>
  category: FlagCategory
  notes: string | null
  createdAt: string
  updatedAt: string
}

// Claude chat
export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ClaudeRequest {
  messages: ClaudeMessage[]
}

// Content cache
export interface ContentCache {
  id: string
  contentKey: string
  source: string
  data: Record<string, unknown>
  ttlDays: number
  expiresAt: string
  createdAt: string
  updatedAt: string
}

// Reading position
export interface ReadingPosition {
  id: string
  userId: string
  contentKey: string
  position: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// Annotation DTOs
export interface BookmarkDTO {
  id: string
  clientId: string
  contentKey: string
  page: number
  label: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface HighlightDTO {
  id: string
  clientId: string
  contentKey: string
  color: string
  text: string
  note: string | null
  startXpath: string
  startOffset: number
  endXpath: string
  endOffset: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BookmarkSyncItem {
  clientId: string
  contentKey: string
  page: number
  label: string
  action: 'upsert' | 'delete'
}

export interface HighlightSyncItem {
  clientId: string
  contentKey: string
  color: string
  text: string
  note: string
  startXpath: string
  startOffset: number
  endXpath: string
  endOffset: number
  action: 'upsert' | 'delete'
}

// API error
export interface ApiError {
  error: string
  message: string
  requestId: string
}
