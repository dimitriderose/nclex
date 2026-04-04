import { describe, it, expect, beforeEach } from 'vitest'
import { calculateSM2, createInitialSM2, spacedRepetitionService } from '../../services/spaced-repetition'
import type { SM2Data } from '../../types/content'
import type { FlaggedQuestion } from '../../types'

const SM2_STORAGE_KEY = 'nclex:sm2_data'

function makeFlaggedQuestion(id: string): FlaggedQuestion {
  return {
    id,
    userId: 'user-1',
    topic: 'Pharmacology',
    question: {},
    category: 'REVIEW',
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('calculateSM2', () => {
  it('sets interval to 1 and increments repetitions on first correct answer (grade >= 3)', () => {
    const initial = createInitialSM2()
    const result = calculateSM2(initial, 4)
    expect(result.interval).toBe(1)
    expect(result.repetitions).toBe(1)
    expect(result.lastGrade).toBe(4)
  })

  it('sets interval to 6 on second correct answer', () => {
    const after1 = calculateSM2(createInitialSM2(), 4)
    const after2 = calculateSM2(after1, 4)
    expect(after2.interval).toBe(6)
    expect(after2.repetitions).toBe(2)
  })

  it('multiplies interval by easeFactor on third+ correct answer', () => {
    let state = createInitialSM2()
    state = calculateSM2(state, 5) // rep 0 -> interval 1
    state = calculateSM2(state, 5) // rep 1 -> interval 6
    const before = { ...state }
    state = calculateSM2(state, 5) // rep 2 -> interval = round(6 * EF)
    expect(state.interval).toBe(Math.round(before.interval * before.easeFactor))
    expect(state.repetitions).toBe(3)
  })

  it('resets repetitions and interval on incorrect answer (grade < 3)', () => {
    let state = createInitialSM2()
    state = calculateSM2(state, 5)
    state = calculateSM2(state, 5)
    const result = calculateSM2(state, 2)
    expect(result.repetitions).toBe(0)
    expect(result.interval).toBe(1)
  })

  it('clamps grade to 0-5 range', () => {
    const initial = createInitialSM2()
    const highGrade = calculateSM2(initial, 10)
    expect(highGrade.lastGrade).toBe(5)

    const lowGrade = calculateSM2(initial, -3)
    expect(lowGrade.lastGrade).toBe(0)
  })

  it('never lets easeFactor drop below 1.3', () => {
    let state = createInitialSM2()
    for (let i = 0; i < 20; i++) {
      state = calculateSM2(state, 0)
    }
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('increases easeFactor for perfect answers', () => {
    const initial = createInitialSM2()
    const result = calculateSM2(initial, 5)
    expect(result.easeFactor).toBeGreaterThan(initial.easeFactor)
  })

  it('decreases easeFactor for low-grade correct answers', () => {
    const initial = createInitialSM2()
    const result = calculateSM2(initial, 3)
    expect(result.easeFactor).toBeLessThan(initial.easeFactor)
  })

  it('sets nextReviewDate to future date', () => {
    const initial = createInitialSM2()
    const result = calculateSM2(initial, 4)
    expect(new Date(result.nextReviewDate).getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  it('sets lastReviewDate to approximately now', () => {
    const before = Date.now()
    const result = calculateSM2(createInitialSM2(), 3)
    const after = Date.now()
    const reviewTime = new Date(result.lastReviewDate).getTime()
    expect(reviewTime).toBeGreaterThanOrEqual(before)
    expect(reviewTime).toBeLessThanOrEqual(after)
  })

  it('handles grade exactly 3 as correct', () => {
    const initial = createInitialSM2()
    const result = calculateSM2(initial, 3)
    expect(result.repetitions).toBe(1)
    expect(result.interval).toBe(1)
  })

  it('handles grade exactly 2 as incorrect', () => {
    const initial = { ...createInitialSM2(), repetitions: 2, interval: 6 }
    const result = calculateSM2(initial, 2)
    expect(result.repetitions).toBe(0)
    expect(result.interval).toBe(1)
  })
})

describe('createInitialSM2', () => {
  it('returns default SM2 data', () => {
    const initial = createInitialSM2()
    expect(initial.easeFactor).toBe(2.5)
    expect(initial.interval).toBe(0)
    expect(initial.repetitions).toBe(0)
    expect(initial.lastGrade).toBe(0)
    expect(initial.nextReviewDate).toBeDefined()
    expect(initial.lastReviewDate).toBeDefined()
  })
})

describe('spacedRepetitionService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getAllSM2Data', () => {
    it('returns empty object when nothing stored', () => {
      expect(spacedRepetitionService.getAllSM2Data()).toEqual({})
    })

    it('returns parsed data from localStorage', () => {
      const data = { 'flag-1': createInitialSM2() }
      localStorage.setItem(SM2_STORAGE_KEY, JSON.stringify(data))
      expect(spacedRepetitionService.getAllSM2Data()).toEqual(data)
    })

    it('returns empty object for invalid JSON', () => {
      localStorage.setItem(SM2_STORAGE_KEY, 'broken{')
      expect(spacedRepetitionService.getAllSM2Data()).toEqual({})
    })
  })

  describe('getSM2Data', () => {
    it('returns initial SM2 data when flag has no stored data', () => {
      const data = spacedRepetitionService.getSM2Data('nonexistent')
      expect(data.easeFactor).toBe(2.5)
      expect(data.interval).toBe(0)
      expect(data.repetitions).toBe(0)
    })

    it('returns stored data for existing flag', () => {
      const custom: SM2Data = {
        easeFactor: 1.8,
        interval: 6,
        repetitions: 2,
        nextReviewDate: '2026-02-01T00:00:00Z',
        lastReviewDate: '2026-01-25T00:00:00Z',
        lastGrade: 4,
      }
      localStorage.setItem(SM2_STORAGE_KEY, JSON.stringify({ 'flag-1': custom }))
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(custom)
    })
  })

  describe('saveSM2Data', () => {
    it('persists SM2 data for a flag', () => {
      const data = createInitialSM2()
      spacedRepetitionService.saveSM2Data('flag-1', data)
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(data)
    })

    it('preserves other flags when saving', () => {
      const data1 = createInitialSM2()
      const data2 = { ...createInitialSM2(), easeFactor: 1.5 }
      spacedRepetitionService.saveSM2Data('flag-1', data1)
      spacedRepetitionService.saveSM2Data('flag-2', data2)
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(data1)
      expect(spacedRepetitionService.getSM2Data('flag-2')).toEqual(data2)
    })
  })

  describe('reviewQuestion', () => {
    it('updates and persists SM2 data for the flag', () => {
      const result = spacedRepetitionService.reviewQuestion('flag-1', 4)
      expect(result.repetitions).toBe(1)
      expect(result.interval).toBe(1)
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(result)
    })

    it('applies SM2 algorithm correctly for incorrect answers', () => {
      spacedRepetitionService.reviewQuestion('flag-1', 5)
      spacedRepetitionService.reviewQuestion('flag-1', 5)
      const result = spacedRepetitionService.reviewQuestion('flag-1', 1)
      expect(result.repetitions).toBe(0)
      expect(result.interval).toBe(1)
    })
  })

  describe('getDueItems', () => {
    it('returns items sorted with due items first', () => {
      const flags = [makeFlaggedQuestion('a'), makeFlaggedQuestion('b')]

      spacedRepetitionService.saveSM2Data('a', {
        ...createInitialSM2(),
        nextReviewDate: '2020-01-01T00:00:00Z',
      })
      spacedRepetitionService.saveSM2Data('b', {
        ...createInitialSM2(),
        nextReviewDate: '2099-01-01T00:00:00Z',
      })

      const items = spacedRepetitionService.getDueItems(flags)
      expect(items).toHaveLength(2)
      expect(items[0].flagId).toBe('a')
      expect(items[0].dueToday).toBe(true)
      expect(items[1].flagId).toBe('b')
      expect(items[1].dueToday).toBe(false)
    })

    it('sorts due items by oldest nextReviewDate first', () => {
      const flags = [makeFlaggedQuestion('x'), makeFlaggedQuestion('y')]

      spacedRepetitionService.saveSM2Data('x', {
        ...createInitialSM2(),
        nextReviewDate: '2020-06-01T00:00:00Z',
      })
      spacedRepetitionService.saveSM2Data('y', {
        ...createInitialSM2(),
        nextReviewDate: '2020-01-01T00:00:00Z',
      })

      const items = spacedRepetitionService.getDueItems(flags)
      expect(items[0].flagId).toBe('y')
      expect(items[1].flagId).toBe('x')
    })

    it('sorts non-due items by easeFactor ascending (hardest first)', () => {
      const flags = [makeFlaggedQuestion('easy'), makeFlaggedQuestion('hard')]

      spacedRepetitionService.saveSM2Data('easy', {
        ...createInitialSM2(),
        nextReviewDate: '2099-01-01T00:00:00Z',
        easeFactor: 2.5,
      })
      spacedRepetitionService.saveSM2Data('hard', {
        ...createInitialSM2(),
        nextReviewDate: '2099-01-01T00:00:00Z',
        easeFactor: 1.3,
      })

      const items = spacedRepetitionService.getDueItems(flags)
      expect(items[0].flagId).toBe('hard')
      expect(items[1].flagId).toBe('easy')
    })

    it('returns empty array for empty flags', () => {
      expect(spacedRepetitionService.getDueItems([])).toEqual([])
    })
  })

  describe('getDueCount', () => {
    it('returns count of items due today', () => {
      const flags = [makeFlaggedQuestion('a'), makeFlaggedQuestion('b'), makeFlaggedQuestion('c')]

      spacedRepetitionService.saveSM2Data('a', {
        ...createInitialSM2(),
        nextReviewDate: '2020-01-01T00:00:00Z',
      })
      spacedRepetitionService.saveSM2Data('b', {
        ...createInitialSM2(),
        nextReviewDate: '2099-01-01T00:00:00Z',
      })
      // 'c' has no stored data, initial SM2 has nextReviewDate = now, so it is due

      expect(spacedRepetitionService.getDueCount(flags)).toBe(2)
    })

    it('returns 0 for empty flags', () => {
      expect(spacedRepetitionService.getDueCount([])).toBe(0)
    })
  })

  describe('clearAll', () => {
    it('removes all SM2 data from localStorage', () => {
      spacedRepetitionService.saveSM2Data('flag-1', createInitialSM2())
      spacedRepetitionService.clearAll()
      expect(localStorage.getItem(SM2_STORAGE_KEY)).toBeNull()
      expect(spacedRepetitionService.getAllSM2Data()).toEqual({})
    })
  })
})
