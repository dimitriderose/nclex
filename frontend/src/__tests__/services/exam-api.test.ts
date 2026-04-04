import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { examApi } from '../../services/exam-api'

function mockOkResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  }
}

function mockErrorResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error('not json')),
  }
}

describe('exam-api', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  // ---- authedFetch error handling ----
  describe('authedFetch error handling', () => {
    it('throws error with message from response body', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, { message: 'Invalid session' }))
      await expect(examApi.startExam()).rejects.toThrow('Invalid session')
    })

    it('throws fallback error when JSON parse fails', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500))
      await expect(examApi.startExam()).rejects.toThrow('Request failed')
    })

    it('throws fallback when body has no message field', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, {}))
      await expect(examApi.startExam()).rejects.toThrow('Request failed')
    })

    it('sends credentials and Content-Type header', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({}))
      await examApi.startExam()
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/start', expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }))
    })
  })

  // ---- startExam ----
  describe('startExam', () => {
    it('sends POST to /api/exam/start and returns parsed response', async () => {
      const data = { sessionId: 's1', status: 'active', timeLimitMinutes: 60 }
      mockFetch.mockResolvedValue(mockOkResponse(data))
      const result = await examApi.startExam()
      expect(result).toEqual(data)
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/start', expect.objectContaining({ method: 'POST' }))
    })

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      await expect(examApi.startExam()).rejects.toThrow('Network error')
    })
  })

  // ---- submitAnswer ----
  describe('submitAnswer', () => {
    it('sends POST with answer data and returns response', async () => {
      const answerData = { correct: true, questionsAnswered: 5, currentDifficulty: 3, examContinues: true }
      mockFetch.mockResolvedValue(mockOkResponse(answerData))
      const result = await examApi.submitAnswer('s1', 'q1', 'A', 30)
      expect(result).toEqual(answerData)
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/s1/answer', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ questionId: 'q1', selectedAnswer: 'A', timeSpentSeconds: 30 }),
      }))
    })

    it('throws on server error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, { message: 'Server error' }))
      await expect(examApi.submitAnswer('s1', 'q1', 'A', 30)).rejects.toThrow('Server error')
    })
  })

  // ---- finishExam ----
  describe('finishExam', () => {
    it('sends POST to finish endpoint and returns results', async () => {
      const results = { sessionId: 's1', status: 'completed', passPrediction: true }
      mockFetch.mockResolvedValue(mockOkResponse(results))
      const result = await examApi.finishExam('s1')
      expect(result).toEqual(results)
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/s1/finish', expect.objectContaining({ method: 'POST' }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, { message: 'Session not found' }))
      await expect(examApi.finishExam('s1')).rejects.toThrow('Session not found')
    })
  })

  // ---- getExamState ----
  describe('getExamState', () => {
    it('sends GET request and returns exam state', async () => {
      const state = { sessionId: 's1', status: 'active' }
      mockFetch.mockResolvedValue(mockOkResponse(state))
      const result = await examApi.getExamState('s1')
      expect(result).toEqual(state)
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/s1', expect.objectContaining({
        credentials: 'include',
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(403, { message: 'Forbidden' }))
      await expect(examApi.getExamState('s1')).rejects.toThrow('Forbidden')
    })
  })

  // ---- getExamHistory ----
  describe('getExamHistory', () => {
    it('sends GET request and returns history array', async () => {
      const history = [{ sessionId: 's1', status: 'completed' }]
      mockFetch.mockResolvedValue(mockOkResponse(history))
      const result = await examApi.getExamHistory()
      expect(result).toEqual(history)
      expect(mockFetch).toHaveBeenCalledWith('/api/exam/history', expect.objectContaining({
        credentials: 'include',
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(401))
      await expect(examApi.getExamHistory()).rejects.toThrow('Request failed')
    })
  })
})
