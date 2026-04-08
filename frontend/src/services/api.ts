import type {
  AuthResponse,
  UserStats,
  FlaggedQuestion,
  FlagCategory,
  ClaudeMessage,
  ContentCache,
  ReadingPosition,
  BookmarkDTO,
  BookmarkSyncItem,
  HighlightDTO,
  HighlightSyncItem,
} from '../types'

const BASE_URL = '/api'

class ApiError extends Error {
  status: number
  requestId?: string

  constructor(message: string, status: number, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options)
      if (response.status >= 500 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000))
        continue
      }
      return response
    } catch (err) {
      if (err instanceof TypeError && attempt < maxAttempts) {
        // Network error - retry
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000))
        continue
      }
      throw err
    }
  }
  // Should not reach here, but satisfy TypeScript
  return fetch(url, options)
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetchWithRetry(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (response.status === 401) {
    // Redirect to login on 401
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new ApiError('Authentication required', 401)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new ApiError(body.message || 'Request failed', response.status, body.requestId)
  }

  return response
}

export const api = {
  // Auth
  async register(email: string, password: string): Promise<AuthResponse> {
    const res = await authedFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return res.json()
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await authedFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return res.json()
  },

  async logout(): Promise<AuthResponse> {
    const res = await authedFetch('/auth/logout', { method: 'POST' })
    return res.json()
  },

  async getMe(): Promise<Record<string, unknown>> {
    const res = await authedFetch('/auth/me')
    return res.json()
  },

  // Stats
  async getStats(): Promise<UserStats> {
    const res = await authedFetch('/stats')
    return res.json()
  },

  async updateStats(data: Partial<UserStats>): Promise<UserStats> {
    const res = await authedFetch('/stats', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    return res.json()
  },

  async updateStreak(streak: number): Promise<UserStats> {
    const res = await authedFetch('/stats/streak', {
      method: 'PATCH',
      body: JSON.stringify({ streak }),
    })
    return res.json()
  },

  async appendHistory(entry: Record<string, unknown>): Promise<UserStats> {
    const res = await authedFetch('/stats/history', {
      method: 'PATCH',
      body: JSON.stringify(entry),
    })
    return res.json()
  },

  // Flagged questions
  async getFlags(params?: { category?: FlagCategory; topic?: string }): Promise<FlaggedQuestion[]> {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.topic) searchParams.set('topic', params.topic)
    const query = searchParams.toString()
    const res = await authedFetch(`/flags${query ? `?${query}` : ''}`)
    return res.json()
  },

  async createFlag(data: {
    topic: string
    question: Record<string, unknown>
    category: FlagCategory
    notes?: string
  }): Promise<FlaggedQuestion> {
    const res = await authedFetch('/flags', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res.json()
  },

  async updateFlag(id: string, data: { category?: FlagCategory; notes?: string }): Promise<FlaggedQuestion> {
    const res = await authedFetch(`/flags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    return res.json()
  },

  async deleteFlag(id: string): Promise<void> {
    await authedFetch(`/flags/${id}`, { method: 'DELETE' })
  },

  // Claude chat
  async chatWithClaude(messages: ClaudeMessage[]): Promise<Record<string, unknown>> {
    const res = await authedFetch('/claude/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    })
    return res.json()
  },

  // Content cache
  async getCachedContent(key: string): Promise<ContentCache> {
    const res = await authedFetch(`/cache?key=${encodeURIComponent(key)}`)
    return res.json()
  },

  async setCachedContent(data: {
    contentKey: string
    source: string
    data: Record<string, unknown>
    ttlDays?: number
  }): Promise<ContentCache> {
    const res = await authedFetch('/cache', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    return res.json()
  },

  // Reading positions
  async getReadingPositions(): Promise<ReadingPosition[]> {
    const res = await authedFetch('/reading-positions')
    return res.json()
  },

  async getReadingPosition(contentKey: string): Promise<ReadingPosition | null> {
    const res = await authedFetch(`/reading-positions/${encodeURIComponent(contentKey)}`)
    return res.json()
  },

  async setReadingPosition(contentKey: string, position: Record<string, unknown>): Promise<ReadingPosition> {
    const res = await authedFetch('/reading-positions', {
      method: 'PUT',
      body: JSON.stringify({ contentKey, position }),
    })
    return res.json()
  },

  // Annotations - Bookmarks
  async getBookmarks(contentKey?: string): Promise<BookmarkDTO[]> {
    const url = contentKey
      ? `/annotations/bookmarks?contentKey=${encodeURIComponent(contentKey)}`
      : '/annotations/bookmarks'
    const res = await authedFetch(url)
    return res.json()
  },

  async syncBookmarks(items: BookmarkSyncItem[]): Promise<{ bookmarks: BookmarkDTO[]; serverTime: string }> {
    const res = await authedFetch('/annotations/bookmarks/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    return res.json()
  },

  // Annotations - Highlights
  async getHighlights(contentKey?: string): Promise<HighlightDTO[]> {
    const url = contentKey
      ? `/annotations/highlights?contentKey=${encodeURIComponent(contentKey)}`
      : '/annotations/highlights'
    const res = await authedFetch(url)
    return res.json()
  },

  async syncHighlights(items: HighlightSyncItem[]): Promise<{ highlights: HighlightDTO[]; serverTime: string }> {
    const res = await authedFetch('/annotations/highlights/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    return res.json()
  },

  // Delta sync
  async getAnnotationChanges(since: string): Promise<{ bookmarks: BookmarkDTO[]; highlights: HighlightDTO[]; serverTime: string }> {
    const res = await authedFetch(`/annotations/changes?since=${encodeURIComponent(since)}`)
    return res.json()
  },
}
