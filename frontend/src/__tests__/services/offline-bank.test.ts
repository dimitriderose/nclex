import { describe, it, expect, vi, beforeEach } from 'vitest'
import { offlineBank } from '../../services/offline-bank'
import type { GeneratedQuestion } from '../../types/content'

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
  })

  // ---- getBank ----
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

  // ---- setBank ----
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

  // ---- getMeta ----
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

  // ---- shouldRegenerateBank ----
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

    it('returns true when bank is exactly at threshold boundary (49)', () => {
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

    it('returns true when bank is too old (> 7 days)', () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      const meta = {
        generatedAt: oldDate,
        count: 100,
        topics: ['pharm'],
        version: 1,
      }
      localStorage.setItem('nclex:offline_bank_meta', JSON.stringify(meta))
      expect(offlineBank.shouldRegenerateBank()).toBe(true)
    })

    it('returns false when bank is within 7 days', () => {
      const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const meta = {
        generatedAt: recentDate,
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

  // ---- getRandomQuestion ----
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

  // ---- removeQuestion ----
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

  // ---- getBankSize ----
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

  // ---- clearBank ----
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
})
