import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { questionService } from '../../services/question-service'

function mockOkResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function mockErrorResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error('not json')),
  }
}

describe('question-service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  // ---- generate ----
  describe('generate', () => {
    it('sends POST with options and returns generated question', async () => {
      const question = { id: 'q1', stem: 'What is...', type: 'mc' }
      mockFetch.mockResolvedValue(mockOkResponse(question))

      const result = await questionService.generate({ topic: 'pharmacology' })

      expect(result).toEqual(question)
      expect(mockFetch).toHaveBeenCalledWith('/api/questions/generate', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          topic: 'pharmacology',
          questionType: 'mc',
          difficulty: 'medium',
          ncjmmStep: undefined,
          context: undefined,
        }),
      }))
    })

    it('uses provided optional parameters', async () => {
      mockFetch.mockResolvedValue(mockOkResponse({ id: 'q1' }))

      await questionService.generate({
        topic: 'fundamentals',
        questionType: 'sata',
        difficulty: 'hard',
        ncjmmStep: 'analyze_cues',
        context: { key: 'val' },
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/questions/generate', expect.objectContaining({
        body: JSON.stringify({
          topic: 'fundamentals',
          questionType: 'sata',
          difficulty: 'hard',
          ncjmmStep: 'analyze_cues',
          context: { key: 'val' },
        }),
      }))
    })

    it('throws on server error with message', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, { message: 'Generation failed' }))
      await expect(questionService.generate({ topic: 'pharm' })).rejects.toThrow('Generation failed')
    })

    it('throws fallback when JSON parse fails', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500))
      await expect(questionService.generate({ topic: 'pharm' })).rejects.toThrow('Request failed')
    })

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      await expect(questionService.generate({ topic: 'pharm' })).rejects.toThrow('Network error')
    })
  })

  // ---- generateBatch ----
  describe('generateBatch', () => {
    it('sends POST with batch options and returns array', async () => {
      const questions = [{ id: 'q1' }, { id: 'q2' }]
      mockFetch.mockResolvedValue(mockOkResponse(questions))

      const result = await questionService.generateBatch({ topics: ['pharm', 'fundamentals'] })

      expect(result).toEqual(questions)
      expect(mockFetch).toHaveBeenCalledWith('/api/questions/generate/batch', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          topics: ['pharm', 'fundamentals'],
          count: 5,
          questionTypes: ['mc'],
          difficulty: 'medium',
        }),
      }))
    })

    it('uses provided optional parameters', async () => {
      mockFetch.mockResolvedValue(mockOkResponse([]))

      await questionService.generateBatch({
        topics: ['pharm'],
        count: 10,
        questionTypes: ['sata', 'dosage'],
        difficulty: 'hard',
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/questions/generate/batch', expect.objectContaining({
        body: JSON.stringify({
          topics: ['pharm'],
          count: 10,
          questionTypes: ['sata', 'dosage'],
          difficulty: 'hard',
        }),
      }))
    })

    it('throws on error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(429, { message: 'Rate limited' }))
      await expect(questionService.generateBatch({ topics: ['pharm'] })).rejects.toThrow('Rate limited')
    })
  })

  // ---- scoreSATA ----
  describe('scoreSATA', () => {
    const options = [
      { id: 'a', isCorrect: true },
      { id: 'b', isCorrect: true },
      { id: 'c', isCorrect: false },
      { id: 'd', isCorrect: false },
    ]

    it('scores all correct (selected correct + not selected incorrect)', () => {
      // Selected a, b (both correct), not selected c, d (both incorrect)
      const score = questionService.scoreSATA(['a', 'b'], options)
      expect(score).toBe(1.0) // 4/4
    })

    it('scores all wrong (selected incorrect + not selected correct)', () => {
      // Selected c, d (both incorrect), not selected a, b (both correct)
      const score = questionService.scoreSATA(['c', 'd'], options)
      expect(score).toBe(0.0) // 0/4
    })

    it('scores partial credit', () => {
      // Selected a (correct), not selected b (wrong - should be selected), c not selected (correct), d not selected (correct)
      const score = questionService.scoreSATA(['a'], options)
      expect(score).toBe(0.75) // 3/4: a correct, b missed, c correct non-select, d correct non-select
    })

    it('scores empty selection', () => {
      // No selections: a not selected (wrong), b not selected (wrong), c not selected (correct), d not selected (correct)
      const score = questionService.scoreSATA([], options)
      expect(score).toBe(0.5) // 2/4
    })

    it('scores selecting everything', () => {
      // All selected: a (correct), b (correct), c (wrong select), d (wrong select)
      const score = questionService.scoreSATA(['a', 'b', 'c', 'd'], options)
      expect(score).toBe(0.5) // 2/4
    })

    it('handles single-option set', () => {
      const singleOption = [{ id: 'a', isCorrect: true }]
      expect(questionService.scoreSATA(['a'], singleOption)).toBe(1.0)
      expect(questionService.scoreSATA([], singleOption)).toBe(0.0)
    })
  })

  // ---- scoreDosage ----
  describe('scoreDosage', () => {
    it('returns true when answer is within default tolerance (0.1)', () => {
      expect(questionService.scoreDosage(5.05, 5.0)).toBe(true)
    })

    it('returns true when answer exactly matches', () => {
      expect(questionService.scoreDosage(10, 10)).toBe(true)
    })

    it('returns true when answer is at tolerance boundary', () => {
      expect(questionService.scoreDosage(5.1, 5.0)).toBe(true)
    })

    it('returns false when answer is outside default tolerance', () => {
      expect(questionService.scoreDosage(5.2, 5.0)).toBe(false)
    })

    it('uses custom tolerance when provided', () => {
      expect(questionService.scoreDosage(5.5, 5.0, 1.0)).toBe(true)
      expect(questionService.scoreDosage(6.1, 5.0, 1.0)).toBe(false)
    })

    it('handles negative difference', () => {
      expect(questionService.scoreDosage(4.95, 5.0)).toBe(true)
      expect(questionService.scoreDosage(4.8, 5.0)).toBe(false)
    })

    it('handles zero tolerance (falsy 0 falls back to default 0.1)', () => {
      // tolerance=0 is falsy so `|| 0.1` kicks in, making tolerance 0.1
      expect(questionService.scoreDosage(5.0, 5.0, 0)).toBe(true)
      expect(questionService.scoreDosage(5.05, 5.0, 0)).toBe(true) // within 0.1
      expect(questionService.scoreDosage(5.2, 5.0, 0)).toBe(false) // outside 0.1
    })
  })

  // ---- scoreMC ----
  describe('scoreMC', () => {
    const options = [
      { id: 'a', isCorrect: false },
      { id: 'b', isCorrect: true },
      { id: 'c', isCorrect: false },
    ]

    it('returns true when correct option is selected', () => {
      expect(questionService.scoreMC('b', options)).toBe(true)
    })

    it('returns false when wrong option is selected', () => {
      expect(questionService.scoreMC('a', options)).toBe(false)
    })

    it('returns false when selected option does not exist', () => {
      expect(questionService.scoreMC('z', options)).toBe(false)
    })

    it('returns false for empty string selection', () => {
      expect(questionService.scoreMC('', options)).toBe(false)
    })

    it('handles options where none are correct', () => {
      const noCorrect = [
        { id: 'a', isCorrect: false },
        { id: 'b', isCorrect: false },
      ]
      expect(questionService.scoreMC('a', noCorrect)).toBe(false)
    })
  })
})
