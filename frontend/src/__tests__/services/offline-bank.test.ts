import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/question-service', () => ({
  questionService: {
    generateBatch: vi.fn(),
  },
}))

import { offlineBank } from '../../services/offline-bank'
import { questionService } from '../../services/question-service'
import type { GeneratedQuestion } from '../../types/content'

const BANK_TOPICS = [
  'Pharmacological Therapies', 'Management of Care', 'Safety and Infection Control',
  'Physiological Adaptation', 'Reduction of Risk Potential', 'Basic Care and Comfort',
  'Health Promotion and Maintenance', 'Psychosocial Integrity',
]
const POPULATE_BATCH_SIZE = 20
const BANK_SIZE = 100

function makeQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    id: overrides.id ?? 'q1',
    type: 'mc',
    stem: 'Test question',
    options: [
      { id: 'a', text: 'Option A', isCorrect: true },
      { id: 'b', text: 'Option B', isCorrect: false },
    ],
    rationale: 'Because A',
    ncjmmStep: 'recognize_cues',
    ncjmmValidated: true,
    topic: overrides.topic ?? 'pharmacology',
    difficulty: 'medium',
    source: 'test',
    sourceKey: 'test-key',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('offline-bank', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(questionService.generateBatch).mockReset()
  })

  describe('getBank', () => {
    it('returns empty array when no bank stored', () => {
      expect(offlineBank.getBank()).toEqual([])
    })

    it('returns parsed questions from localStorage', () => {
      const questions = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))
      const result = offlineBank.getBank()
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('q1')
    })

    it('returns empty array on corrupt JSON', () => {
      localStorage.setItem('nclex:offline_bank', '{not-valid-json')
      expect(offlineBank.getBank()).toEqual([])
    })
  })

  describe('setBank', () => {
    it('stores questions and updates meta', () => {
      const questions = [
        makeQuestion({ id: 'q1', topic: 'pharmacology' }),
        makeQuestion({ id: 'q2', topic: 'fundamentals' }),
      ]
      offlineBank.setBank(questions)

      const stored = JSON.parse(localStorage.getItem('nclex:offline_bank')!)
      expect(stored).toHaveLength(2)

      const meta = JSON.parse(localStorage.getItem('nclex:offline_bank_meta')!)
      expect(meta.count).toBe(2)
      expect(meta.topics).toContain('pharmacology')
      expect(meta.topics).toContain('fundamentals')
      expect(meta.version).toBe(1)
      expect(meta.generatedAt).toBeTruthy()
    })

    it('handles quota exceeded gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })

      // Should not throw
      expect(() => offlineBank.setBank([makeQuestion()])).not.toThrow()
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
      vi.mocked(Storage.prototype.setItem).mockRestore()
    })
  })

  describe('getMeta', () => {
    it('returns null when no meta stored', () => {
      expect(offlineBank.getMeta()).toBeNull()
    })

    it('returns parsed meta from localStorage', () => {
      const meta = { generatedAt: '2024-01-01T00:00:00Z', count: 50, topics: ['pharm'], version: 1 }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.getMeta()).toEqual(meta)
    })

    it('returns null on corrupt JSON', () => {
      localStorage.setItem('nclex:offline_bank_meta', 'bad-json')
      expect(offlineBank.getMeta()).toBeNull()
    })
  })

  describe('shouldRegenerateBank', () => {
    it('returns true when meta is null (no bank)', () => {
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns true when bank is too small (< 50% of 100)', () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: 30,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns true when bank size is just below the regeneration threshold', () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: 49,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns false when bank is at 50 (threshold)', () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: 50,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(false)
    })

    it('returns true when bank is too old (> 24 hours)', () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      const meta = {
        generatedAt: oldDate,
        count: 100,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns false when bank is within 24 hours', () => {
      const recentDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      const meta = {
        generatedAt: recentDate,
        count: 100,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(false)
    })

    it('returns true when bank age is just past the staleness window', () => {
      const justOverDate = new Date(Date.now() - (24 * 60 * 60 * 1000 + 60 * 1000)).toISOString()
      const meta = {
        generatedAt: justOverDate,
        count: 100,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns false when bank age is just within the staleness window', () => {
      const justUnderDate = new Date(Date.now() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toISOString()
      const meta = {
        generatedAt: justUnderDate,
        count: 100,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(false)
    })

    it('returns true when version is less than 1', () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: 100,
        topics: ['pharm'],
        version: 0,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns false for a fully valid bank', () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: 100,
        topics: ['pharm', 'fundamentals'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(false)
    })
  })

  describe('getRandomQuestion', () => {
    it('returns null when bank is empty', () => {
      expect(offlineBank.getRandomQuestion()).toBeNull()
    })

    it('returns a question from the bank', () => {
      const questions = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))
      const result = offlineBank.getRandomQuestion()
      expect(result).not.toBeNull()
      expect(['q1', 'q2']).toContain(result!.id)
    })

    it('filters by topic (case-insensitive partial match)', () => {
      const questions = [
        makeQuestion({ id: 'q1', topic: 'Pharmacology' }),
        makeQuestion({ id: 'q2', topic: 'Fundamentals' }),
        makeQuestion({ id: 'q3', topic: 'Advanced Pharmacology' }),
      ]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))

      const result = offlineBank.getRandomQuestion('pharm')
      expect(result).not.toBeNull()
      expect(['q1', 'q3']).toContain(result!.id)
    })

    it('returns null when topic filter matches nothing', () => {
      const questions = [makeQuestion({ id: 'q1', topic: 'Pharmacology' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))
      expect(offlineBank.getRandomQuestion('nonexistent')).toBeNull()
    })

    it('returns the only question when bank has one item', () => {
      const questions = [makeQuestion({ id: 'q1' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))
      const result = offlineBank.getRandomQuestion()
      expect(result!.id).toBe('q1')
    })
  })

  describe('removeQuestion', () => {
    it('removes question by id and updates bank', () => {
      const questions = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))

      offlineBank.removeQuestion('q1')

      const remaining = offlineBank.getBank()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('q2')
    })

    it('does nothing if question id not found', () => {
      const questions = [makeQuestion({ id: 'q1' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))

      offlineBank.removeQuestion('nonexistent')
      expect(offlineBank.getBank()).toHaveLength(1)
    })
  })

  describe('getBankSize', () => {
    it('returns 0 for empty bank', () => {
      expect(offlineBank.getBankSize()).toBe(0)
    })

    it('returns correct count', () => {
      const questions = [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })]
      localStorage.setItem('nclex:offline_bank', JSON.stringify(questions))
      expect(offlineBank.getBankSize()).toBe(2)
    })
  })

  describe('clearBank', () => {
    it('removes both bank and meta from localStorage', () => {
      localStorage.setItem('nclex:offline_bank', '[]')
      localStorage.setItem('nclex:offline_bank_meta', '{}')

      offlineBank.clearBank()

      expect(localStorage.getItem('nclex:offline_bank')).toBeNull()
      expect(localStorage.getItem('nclex:offline_bank_meta')).toBeNull()
    })

    it('does not throw when keys do not exist', () => {
      expect(() => offlineBank.clearBank()).not.toThrow()
    })
  })

  describe('populateBank', () => {
    it('chunks requests at POPULATE_BATCH_SIZE, round-robins topics, and persists the concatenation via setBank', async () => {
      vi.mocked(questionService.generateBatch).mockImplementation(async ({ topics, count }) => {
        return Array.from({ length: count ?? 0 }, (_, i) =>
          makeQuestion({ id: `${topics?.[0] ?? 'unknown'}-${i}`, topic: topics?.[0] })
        )
      })

      const result = await offlineBank.populateBank()

      const calls = vi.mocked(questionService.generateBatch).mock.calls
      // BANK_SIZE (100) / POPULATE_BATCH_SIZE (20) => 5 chunked calls.
      expect(calls.length).toBeGreaterThanOrEqual(5)

      let totalRequested = 0
      let topicCursor = 0
      for (const [options] of calls) {
        expect(options.count).toBeLessThanOrEqual(POPULATE_BATCH_SIZE)
        expect(options.difficulty).toBe('medium')
        totalRequested += options.count ?? 0

        // Topics cycle through BANK_TOPICS round-robin starting where the previous
        // call's cursor left off.
        const expectedTopics = Array.from(
          { length: Math.min(options.count ?? 0, BANK_TOPICS.length) },
          (_, i) => BANK_TOPICS[(topicCursor + i) % BANK_TOPICS.length]
        )
        expect(options.topics).toEqual(expectedTopics)
        topicCursor += expectedTopics.length
      }
      expect(totalRequested).toBe(BANK_SIZE)

      const stored = JSON.parse(localStorage.getItem('nclex:offline_bank')!)
      expect(stored).toHaveLength(BANK_SIZE)
      expect(result).toHaveLength(BANK_SIZE)

      const meta = JSON.parse(localStorage.getItem('nclex:offline_bank_meta')!)
      expect(meta.count).toBe(BANK_SIZE)
    })

    it('is resilient to a partial failure: one chunk rejects, others succeed, setBank called with the successful subset', async () => {
      let callIndex = 0
      vi.mocked(questionService.generateBatch).mockImplementation(async ({ topics, count }) => {
        const i = callIndex++
        if (i === 1) {
          throw new Error('chunk failed')
        }
        return Array.from({ length: count ?? 0 }, (_, j) =>
          makeQuestion({ id: `chunk${i}-${j}`, topic: topics?.[0] })
        )
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await offlineBank.populateBank()

      const calls = vi.mocked(questionService.generateBatch).mock.calls
      expect(calls.length).toBeGreaterThanOrEqual(5)

      // The failed chunk's questions are absent — total is less than BANK_SIZE but
      // setBank is still called with whatever succeeded.
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(BANK_SIZE)
      expect(result.some((q) => q.id.startsWith('chunk1-'))).toBe(false)

      const stored = JSON.parse(localStorage.getItem('nclex:offline_bank')!)
      expect(stored).toEqual(result)

      const meta = JSON.parse(localStorage.getItem('nclex:offline_bank_meta')!)
      expect(meta.count).toBe(result.length)

      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('does not call setBank when every chunk fails', async () => {
      vi.mocked(questionService.generateBatch).mockRejectedValue(new Error('all chunks failed'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await offlineBank.populateBank()

      expect(result).toEqual([])
      expect(localStorage.getItem('nclex:offline_bank')).toBeNull()
      expect(localStorage.getItem('nclex:offline_bank_meta')).toBeNull()

      warnSpy.mockRestore()
    })
  })

  describe('maybeRegenerateBank', () => {
    it('calls populateBank (and persists a new bank) when the bank is stale', async () => {
      // No meta stored => shouldRegenerateBank() is true.
      vi.mocked(questionService.generateBatch).mockImplementation(async ({ count }) =>
        Array.from({ length: count ?? 0 }, (_, i) => makeQuestion({ id: `regen-${i}` }))
      )

      const didRegenerate = await offlineBank.maybeRegenerateBank()

      expect(didRegenerate).toBe(true)
      expect(questionService.generateBatch).toHaveBeenCalled()
      expect(offlineBank.getBankSize()).toBeGreaterThan(0)
    })

    it('is a no-op when the bank is fresh', async () => {
      const meta = {
        generatedAt: new Date().toISOString(),
        count: BANK_SIZE,
        topics: BANK_TOPICS,
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      localStorage.setItem('nclex:offline_bank', JSON.stringify(
        Array.from({ length: BANK_SIZE }, (_, i) => makeQuestion({ id: `existing-${i}` }))
      ))

      const didRegenerate = await offlineBank.maybeRegenerateBank()

      expect(didRegenerate).toBe(false)
      expect(questionService.generateBatch).not.toHaveBeenCalled()
    })

    it('returns false when stale but populateBank yields nothing', async () => {
      vi.mocked(questionService.generateBatch).mockRejectedValue(new Error('failed'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const didRegenerate = await offlineBank.maybeRegenerateBank()

      expect(didRegenerate).toBe(false)
      warnSpy.mockRestore()
    })
  })
})
