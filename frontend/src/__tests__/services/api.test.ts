import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { api } from '../../services/api'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('api service', () => {
  // ── Auth ──────────────────────────────────────────────────────

  describe('register', () => {
    it('calls POST /api/auth/register and returns response', async () => {
      const result = await api.register('test@example.com', 'password123')
      expect(result).toEqual({ message: 'Registration successful', email: 'test@example.com' })
    })
  })

  describe('login', () => {
    it('calls POST /api/auth/login and returns response', async () => {
      const result = await api.login('test@example.com', 'password123')
      expect(result).toEqual({ message: 'Login successful', email: 'test@example.com' })
    })
  })

  describe('logout', () => {
    it('calls POST /api/auth/logout and returns response', async () => {
      const result = await api.logout()
      expect(result).toEqual({ message: 'Logged out successfully' })
    })
  })

  describe('getMe', () => {
    it('calls GET /api/auth/me and returns user data', async () => {
      const result = await api.getMe()
      expect(result).toEqual({ authenticated: true, userId: '123', email: 'test@example.com', role: 'USER' })
    })
  })

  // ── 401 redirect ──────────────────────────────────────────────

  describe('401 handling', () => {
    it('redirects to /login on 401 response', async () => {
      server.use(
        http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 }))
      )

      // Mock window.location
      const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')
      const mockLocation = { ...window.location, href: 'http://localhost/dashboard', pathname: '/dashboard' }
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
        configurable: true,
      })

      await expect(api.getMe()).rejects.toThrow('Authentication required')
      expect(mockLocation.href).toBe('/login')

      // Restore
      if (locationDescriptor) {
        Object.defineProperty(window, 'location', locationDescriptor)
      }
    })

    it('does not redirect if already on /login', async () => {
      server.use(
        http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 }))
      )

      const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')
      const mockLocation = { ...window.location, href: 'http://localhost/login', pathname: '/login' }
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
        configurable: true,
      })

      await expect(api.getMe()).rejects.toThrow('Authentication required')
      // href should NOT have been reassigned
      expect(mockLocation.href).toBe('http://localhost/login')

      if (locationDescriptor) {
        Object.defineProperty(window, 'location', locationDescriptor)
      }
    })
  })

  // ── Non-OK response throws ApiError ───────────────────────────

  describe('error handling', () => {
    it('throws ApiError with message and requestId from response body', async () => {
      server.use(
        http.get('/api/stats', () =>
          HttpResponse.json(
            { message: 'Forbidden access', requestId: 'req-abc-123' },
            { status: 403 }
          )
        )
      )

      try {
        await api.getStats()
        expect.unreachable('should have thrown')
      } catch (err: unknown) {
        const error = err as Error & { status: number; requestId?: string }
        expect(error.message).toBe('Forbidden access')
        expect(error.status).toBe(403)
        expect(error.requestId).toBe('req-abc-123')
      }
    })

    it('uses fallback message when JSON parsing fails', async () => {
      server.use(
        http.get('/api/stats', () =>
          new HttpResponse('not json', { status: 500, headers: { 'Content-Type': 'text/plain' } })
        )
      )

      try {
        await api.getStats()
        expect.unreachable('should have thrown')
      } catch (err: unknown) {
        const error = err as Error & { status: number }
        expect(error.message).toBe('Request failed')
        expect(error.status).toBe(500)
      }
    })

    it('uses fallback when body has no message field', async () => {
      server.use(
        http.get('/api/stats', () =>
          HttpResponse.json({ other: 'field' }, { status: 400 })
        )
      )

      try {
        await api.getStats()
        expect.unreachable('should have thrown')
      } catch (err: unknown) {
        const error = err as Error
        expect(error.message).toBe('Request failed')
      }
    })
  })

  // ── Stats ─────────────────────────────────────────────────────

  describe('getStats', () => {
    it('calls GET /api/stats and returns stats', async () => {
      const result = await api.getStats()
      expect(result).toHaveProperty('streak', 5)
      expect(result).toHaveProperty('readinessScore', 75.0)
    })
  })

  describe('updateStats', () => {
    it('calls PUT /api/stats with data', async () => {
      const result = await api.updateStats({ streak: 10 })
      expect(result).toHaveProperty('streak')
    })
  })

  describe('updateStreak', () => {
    it('calls PATCH /api/stats/streak', async () => {
      const result = await api.updateStreak(6)
      expect(result).toHaveProperty('streak', 6)
    })
  })

  describe('appendHistory', () => {
    it('calls PATCH /api/stats/history', async () => {
      const result = await api.appendHistory({ topic: 'test', correct: true })
      expect(result).toHaveProperty('history')
    })
  })

  // ── Flags ─────────────────────────────────────────────────────

  describe('getFlags', () => {
    it('calls GET /api/flags without params', async () => {
      const result = await api.getFlags()
      expect(Array.isArray(result)).toBe(true)
    })

    it('calls GET /api/flags with category and topic', async () => {
      const result = await api.getFlags({ category: 'REVIEW', topic: 'pharma' })
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('createFlag', () => {
    it('calls POST /api/flags', async () => {
      const result = await api.createFlag({ topic: 'test', question: {}, category: 'REVIEW' })
      expect(result).toHaveProperty('id', '1')
    })
  })

  describe('updateFlag', () => {
    it('calls PUT /api/flags/:id', async () => {
      const result = await api.updateFlag('1', { category: 'HARD' })
      expect(result).toHaveProperty('category', 'HARD')
    })
  })

  describe('deleteFlag', () => {
    it('calls DELETE /api/flags/:id', async () => {
      await expect(api.deleteFlag('1')).resolves.toBeUndefined()
    })
  })

  // ── Claude chat ───────────────────────────────────────────────

  describe('chatWithClaude', () => {
    it('calls POST /api/claude/chat', async () => {
      const result = await api.chatWithClaude([{ role: 'user', content: 'hello' }])
      expect(result).toHaveProperty('content')
    })
  })

  // ── Content cache ─────────────────────────────────────────────

  describe('getCachedContent', () => {
    it('calls GET /api/cache with key', async () => {
      const result = await api.getCachedContent('test-key')
      expect(result).toHaveProperty('contentKey', 'test')
    })
  })

  describe('setCachedContent', () => {
    it('calls PUT /api/cache', async () => {
      const result = await api.setCachedContent({ contentKey: 'test', source: 'api', data: {} })
      expect(result).toHaveProperty('contentKey')
    })
  })

  // ── Reading positions ─────────────────────────────────────────

  describe('getReadingPositions', () => {
    it('returns array', async () => {
      const result = await api.getReadingPositions()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getReadingPosition', () => {
    it('returns position or null', async () => {
      const result = await api.getReadingPosition('test-key')
      // Handler returns null
      expect(result).toBeNull()
    })
  })

  describe('setReadingPosition', () => {
    it('calls PUT /api/reading-positions', async () => {
      const result = await api.setReadingPosition('test-key', { page: 5 })
      expect(result).toHaveProperty('contentKey')
    })
  })
})
