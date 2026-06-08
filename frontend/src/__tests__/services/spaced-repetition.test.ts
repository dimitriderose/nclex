import { describe, it, expect, beforeEach, vi } from 'vitest'
import { calculateSM2, createInitialSM2, spacedRepetitionService } from '../../services/spaced-repetition'
import type { SM2Data } from '../../types/content'
import type { FlaggedQuestion } from '../../types'

// spacedRepetitionService now syncs through to the backend (Phase 4: durable SM-2 —
// localStorage is an offline-first cache layered on top, not the sole store). Mock the
// API boundary so these tests stay hermetic; sync is fire-and-forget/best-effort from the
// service's perspective, so a resolved stub is enough to verify the localStorage contract.
vi.mock('../../services/api', () => ({
  api: {
    updateFlagReview: vi.fn().mockResolvedValue({}),
  },
}))

import { api } from '../../services/api'

const SM2_STORAGE_KEY = 'nclex:sm2_data'
const RECONCILED_KEY = 'nclex:sm2_reconciled'

function makeFlaggedQuestion(id: string, overrides: Partial<FlaggedQuestion> = {}): FlaggedQuestion {
  return {
    id,
    userId: 'user-1',
    topic: 'Pharmacology',
    question: {},
    category: 'REVIEW',
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
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
    vi.mocked(api.updateFlagReview).mockReset()
    vi.mocked(api.updateFlagReview).mockResolvedValue({} as never)
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

    it('writes through to both localStorage (synchronously) and the backend (pushReviewState)', async () => {
      const result = spacedRepetitionService.reviewQuestion('flag-1', 4)

      // localStorage cache write happens synchronously, before the async push resolves
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(result)

      await vi.waitFor(() => {
        expect(api.updateFlagReview).toHaveBeenCalledTimes(1)
      })
      expect(api.updateFlagReview).toHaveBeenCalledWith('flag-1', {
        easinessFactor: result.easeFactor,
        repetitionCount: result.repetitions,
        intervalDays: result.interval,
        nextReviewDate: result.nextReviewDate,
        lastReviewedAt: result.lastReviewDate,
      })
    })

    it('catches/logs a rejected push without throwing', async () => {
      vi.mocked(api.updateFlagReview).mockRejectedValueOnce(new Error('network down'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(() => spacedRepetitionService.reviewQuestion('flag-1', 4)).not.toThrow()

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalled()
      })
      expect(warnSpy.mock.calls[0][0]).toMatch(/Failed to sync review state to backend/)

      warnSpy.mockRestore()
    })
  })

  describe('resolveSM2Data', () => {
    it('prefers backend-derived values when the flag has backend progress (repetitionCount > 0)', () => {
      const flag = makeFlaggedQuestion('flag-1', {
        easinessFactor: 1.9,
        repetitionCount: 3,
        intervalDays: 12,
        nextReviewDate: '2026-05-01T00:00:00Z',
        lastReviewedAt: '2026-04-20T00:00:00Z',
      })
      // Seed a *different* localStorage cache value to prove backend wins
      spacedRepetitionService.saveSM2Data('flag-1', { ...createInitialSM2(), easeFactor: 2.5, repetitions: 0 })

      const resolved = spacedRepetitionService.resolveSM2Data(flag)
      expect(resolved.easeFactor).toBe(1.9)
      expect(resolved.repetitions).toBe(3)
      expect(resolved.interval).toBe(12)
      expect(resolved.nextReviewDate).toBe('2026-05-01T00:00:00Z')
      expect(resolved.lastReviewDate).toBe('2026-04-20T00:00:00Z')
    })

    it('prefers backend-derived values when the flag has lastReviewedAt set (even with repetitionCount 0)', () => {
      const flag = makeFlaggedQuestion('flag-1', {
        easinessFactor: 2.1,
        repetitionCount: 0,
        intervalDays: 1,
        nextReviewDate: '2026-05-02T00:00:00Z',
        lastReviewedAt: '2026-04-21T00:00:00Z',
      })

      const resolved = spacedRepetitionService.resolveSM2Data(flag)
      expect(resolved.easeFactor).toBe(2.1)
      expect(resolved.lastReviewDate).toBe('2026-04-21T00:00:00Z')
    })

    it('falls back to the localStorage cache when the flag carries only column defaults', () => {
      const flag = makeFlaggedQuestion('flag-1', {
        easinessFactor: 2.5,
        repetitionCount: 0,
        intervalDays: 0,
        nextReviewDate: null,
        lastReviewedAt: null,
      })
      const cached = { ...createInitialSM2(), easeFactor: 1.7, repetitions: 4, interval: 20 }
      spacedRepetitionService.saveSM2Data('flag-1', cached)

      const resolved = spacedRepetitionService.resolveSM2Data(flag)
      expect(resolved).toEqual(cached)
    })

    it('falls back to a fresh initial SM2 when there is neither backend progress nor a cache entry', () => {
      const flag = makeFlaggedQuestion('flag-1')
      const resolved = spacedRepetitionService.resolveSM2Data(flag)
      expect(resolved.easeFactor).toBe(2.5)
      expect(resolved.repetitions).toBe(0)
      expect(resolved.interval).toBe(0)
    })
  })

  describe('pushReviewState', () => {
    it('calls api.updateFlagReview with the SM2Data fields mapped 1:1 to the backend payload shape', async () => {
      const sm2: SM2Data = {
        easeFactor: 2.3,
        interval: 6,
        repetitions: 2,
        nextReviewDate: '2026-06-10T00:00:00Z',
        lastReviewDate: '2026-06-04T00:00:00Z',
        lastGrade: 4,
      }

      await spacedRepetitionService.pushReviewState('flag-9', sm2)

      expect(api.updateFlagReview).toHaveBeenCalledWith('flag-9', {
        easinessFactor: sm2.easeFactor,
        repetitionCount: sm2.repetitions,
        intervalDays: sm2.interval,
        nextReviewDate: sm2.nextReviewDate,
        lastReviewedAt: sm2.lastReviewDate,
      })
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

  describe('reconcileWithBackend', () => {
    it('does nothing (and does not push) once RECONCILED_KEY is already set', async () => {
      localStorage.setItem(RECONCILED_KEY, '2026-01-01T00:00:00Z')
      spacedRepetitionService.saveSM2Data('flag-1', createInitialSM2())
      const flags = [makeFlaggedQuestion('flag-1')]

      await spacedRepetitionService.reconcileWithBackend(flags)

      expect(api.updateFlagReview).not.toHaveBeenCalled()
    })

    it('pushes and re-keys a local entry that directly matches an existing flag', async () => {
      const sm2 = { ...createInitialSM2(), easeFactor: 1.9, repetitions: 2 }
      spacedRepetitionService.saveSM2Data('flag-1', sm2)
      const flag = makeFlaggedQuestion('flag-1') // no backend progress (defaults)

      await spacedRepetitionService.reconcileWithBackend([flag])

      expect(api.updateFlagReview).toHaveBeenCalledTimes(1)
      expect(api.updateFlagReview).toHaveBeenCalledWith('flag-1', expect.objectContaining({
        easinessFactor: sm2.easeFactor,
        repetitionCount: sm2.repetitions,
      }))
      // re-keyed (same id here, but verifies the cache write happened)
      expect(spacedRepetitionService.getSM2Data('flag-1')).toEqual(sm2)
    })

    it('sets RECONCILED_KEY after pushing a directly-matched local entry', async () => {
      const sm2 = { ...createInitialSM2(), easeFactor: 1.9, repetitions: 2 }
      spacedRepetitionService.saveSM2Data('flag-1', sm2)
      const flag = makeFlaggedQuestion('flag-1') // no backend progress (defaults)

      await spacedRepetitionService.reconcileWithBackend([flag])

      expect(localStorage.getItem(RECONCILED_KEY)).not.toBeNull()
    })

    it('does not re-push a local entry whose matching flag already has backend progress', async () => {
      const sm2 = createInitialSM2()
      spacedRepetitionService.saveSM2Data('flag-1', sm2)
      const flag = makeFlaggedQuestion('flag-1', { repetitionCount: 5, lastReviewedAt: '2026-03-01T00:00:00Z' })

      await spacedRepetitionService.reconcileWithBackend([flag])

      expect(api.updateFlagReview).not.toHaveBeenCalled()
      expect(localStorage.getItem(RECONCILED_KEY)).not.toBeNull()
    })

    it('pairs an orphaned local entry with the single legacy candidate', async () => {
      const sm2 = { ...createInitialSM2(), easeFactor: 2.1, repetitions: 1 }
      spacedRepetitionService.saveSM2Data('stale-id', sm2) // no flag has this id -> orphan
      const legacyCandidate = makeFlaggedQuestion('legacy-1', { questionId: null })

      await spacedRepetitionService.reconcileWithBackend([legacyCandidate])

      expect(api.updateFlagReview).toHaveBeenCalledTimes(1)
      expect(api.updateFlagReview).toHaveBeenCalledWith('legacy-1', expect.objectContaining({
        easinessFactor: sm2.easeFactor,
        repetitionCount: sm2.repetitions,
      }))
      // Re-keyed to the resolved flag id
      expect(spacedRepetitionService.getSM2Data('legacy-1')).toEqual(sm2)
      expect(localStorage.getItem(RECONCILED_KEY)).not.toBeNull()
    })

    it('does not pair when there are multiple orphans', async () => {
      spacedRepetitionService.saveSM2Data('stale-1', createInitialSM2())
      spacedRepetitionService.saveSM2Data('stale-2', createInitialSM2())
      const legacyCandidate = makeFlaggedQuestion('legacy-1', { questionId: null })

      await spacedRepetitionService.reconcileWithBackend([legacyCandidate])

      expect(api.updateFlagReview).not.toHaveBeenCalled()
      // Entries remain localStorage-only, untouched
      expect(spacedRepetitionService.getSM2Data('stale-1')).toBeDefined()
      expect(spacedRepetitionService.getSM2Data('stale-2')).toBeDefined()
    })

    it('does not pair when there are multiple legacy candidates', async () => {
      spacedRepetitionService.saveSM2Data('stale-id', createInitialSM2())
      const candidates = [
        makeFlaggedQuestion('legacy-1', { questionId: null }),
        makeFlaggedQuestion('legacy-2', { questionId: null }),
      ]

      await spacedRepetitionService.reconcileWithBackend(candidates)

      expect(api.updateFlagReview).not.toHaveBeenCalled()
    })

    describe('idempotency — partial failure must not latch RECONCILED_KEY', () => {
      // Regression coverage for a bug where a failed mid-loop push permanently latched
      // RECONCILED_KEY, stranding the unsynced entry as localStorage-only forever. The gate
      // may only latch once every pending push has succeeded, and a retried run must not
      // double-push entries that already made it through (hasBackendProgress skips those).

      it('does not latch RECONCILED_KEY when a push fails mid-reconciliation', async () => {
        const sm2A = { ...createInitialSM2(), easeFactor: 1.8, repetitions: 1 }
        const sm2B = { ...createInitialSM2(), easeFactor: 2.2, repetitions: 2 }
        spacedRepetitionService.saveSM2Data('flag-a', sm2A)
        spacedRepetitionService.saveSM2Data('flag-b', sm2B)

        const flagA = makeFlaggedQuestion('flag-a')
        const flagB = makeFlaggedQuestion('flag-b')

        // flag-a push succeeds, flag-b push fails
        vi.mocked(api.updateFlagReview).mockImplementation(async (id: string) => {
          if (id === 'flag-b') throw new Error('network blip')
          return {} as never
        })
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await spacedRepetitionService.reconcileWithBackend([flagA, flagB])

        expect(localStorage.getItem(RECONCILED_KEY)).toBeNull()
        expect(api.updateFlagReview).toHaveBeenCalledTimes(2)
        expect(api.updateFlagReview).toHaveBeenCalledWith('flag-a', expect.objectContaining({ repetitionCount: sm2A.repetitions }))
        expect(api.updateFlagReview).toHaveBeenCalledWith('flag-b', expect.objectContaining({ repetitionCount: sm2B.repetitions }))

        warnSpy.mockRestore()
      })

      it('latches RECONCILED_KEY on retry once all pushes succeed', async () => {
        const sm2A = { ...createInitialSM2(), easeFactor: 1.8, repetitions: 1 }
        const sm2B = { ...createInitialSM2(), easeFactor: 2.2, repetitions: 2 }
        spacedRepetitionService.saveSM2Data('flag-a', sm2A)
        spacedRepetitionService.saveSM2Data('flag-b', sm2B)

        const flagA = makeFlaggedQuestion('flag-a')
        const flagB = makeFlaggedQuestion('flag-b')

        // First pass: flag-a push succeeds, flag-b push fails — gate stays unlatched.
        vi.mocked(api.updateFlagReview).mockImplementation(async (id: string) => {
          if (id === 'flag-b') throw new Error('network blip')
          return {} as never
        })
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await spacedRepetitionService.reconcileWithBackend([flagA, flagB])
        expect(localStorage.getItem(RECONCILED_KEY)).toBeNull()

        // Retry: both entries now push successfully.
        vi.mocked(api.updateFlagReview).mockClear()
        vi.mocked(api.updateFlagReview).mockResolvedValue({} as never)

        const flagASynced = makeFlaggedQuestion('flag-a', { repetitionCount: sm2A.repetitions, lastReviewedAt: sm2A.lastReviewDate })
        const flagBStillPending = makeFlaggedQuestion('flag-b')

        await spacedRepetitionService.reconcileWithBackend([flagASynced, flagBStillPending])

        expect(localStorage.getItem(RECONCILED_KEY)).not.toBeNull()

        warnSpy.mockRestore()
      })

      it('does not re-push entries that already synced on a prior pass', async () => {
        const sm2A = { ...createInitialSM2(), easeFactor: 1.8, repetitions: 1 }
        const sm2B = { ...createInitialSM2(), easeFactor: 2.2, repetitions: 2 }
        spacedRepetitionService.saveSM2Data('flag-a', sm2A)
        spacedRepetitionService.saveSM2Data('flag-b', sm2B)

        const flagA = makeFlaggedQuestion('flag-a')
        const flagB = makeFlaggedQuestion('flag-b')

        // First pass: flag-a push succeeds (and gets re-keyed to the cache), flag-b fails.
        vi.mocked(api.updateFlagReview).mockImplementation(async (id: string) => {
          if (id === 'flag-b') throw new Error('network blip')
          return {} as never
        })
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await spacedRepetitionService.reconcileWithBackend([flagA, flagB])

        // Retry: simulate the backend now reporting flag-a as having real progress, so a
        // subsequent run must treat it as already-synced (direct match via hasBackendProgress)
        // rather than re-pushing it.
        vi.mocked(api.updateFlagReview).mockClear()
        vi.mocked(api.updateFlagReview).mockResolvedValue({} as never)

        const flagASynced = makeFlaggedQuestion('flag-a', { repetitionCount: sm2A.repetitions, lastReviewedAt: sm2A.lastReviewDate })
        const flagBStillPending = makeFlaggedQuestion('flag-b')

        await spacedRepetitionService.reconcileWithBackend([flagASynced, flagBStillPending])

        // Only flag-b was pushed this time — flag-a is skipped because hasBackendProgress() is true
        expect(api.updateFlagReview).toHaveBeenCalledTimes(1)
        expect(api.updateFlagReview).toHaveBeenCalledWith('flag-b', expect.objectContaining({ repetitionCount: sm2B.repetitions }))

        warnSpy.mockRestore()
      })

      it('latches RECONCILED_KEY immediately when all pending pushes succeed on the first pass', async () => {
        spacedRepetitionService.saveSM2Data('flag-a', createInitialSM2())
        spacedRepetitionService.saveSM2Data('flag-b', createInitialSM2())
        const flags = [makeFlaggedQuestion('flag-a'), makeFlaggedQuestion('flag-b')]

        await spacedRepetitionService.reconcileWithBackend(flags)

        expect(localStorage.getItem(RECONCILED_KEY)).not.toBeNull()
        expect(api.updateFlagReview).toHaveBeenCalledTimes(2)
      })
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
