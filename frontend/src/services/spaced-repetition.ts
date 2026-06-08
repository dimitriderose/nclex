/**
 * SM-2 Spaced Repetition Algorithm
 * Implements the SuperMemo SM-2 algorithm for review scheduling
 */

import type { SM2Data, ReviewItem, GeneratedQuestion } from '../types/content';
import type { FlaggedQuestion } from '../types';
import { api } from './api';

const SM2_STORAGE_KEY = 'nclex:sm2_data';
const RECONCILED_KEY = 'nclex:sm2_reconciled';

/**
 * SM-2 Algorithm implementation
 * Grade: 0-5 (0=complete blackout, 5=perfect response)
 */
export function calculateSM2(
  current: SM2Data,
  grade: number
): SM2Data {
  const clampedGrade = Math.max(0, Math.min(5, grade));

  let { easeFactor, interval, repetitions } = current;

  if (clampedGrade >= 3) {
    // Correct response
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
  } else {
    // Incorrect response - reset
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor
  easeFactor = easeFactor + (0.1 - (5 - clampedGrade) * (0.08 + (5 - clampedGrade) * 0.02));
  easeFactor = Math.max(1.3, easeFactor); // Minimum EF is 1.3

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    easeFactor,
    interval,
    repetitions,
    nextReviewDate: nextReviewDate.toISOString(),
    lastReviewDate: new Date().toISOString(),
    lastGrade: clampedGrade,
  };
}

export function createInitialSM2(): SM2Data {
  return {
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReviewDate: new Date().toISOString(),
    lastReviewDate: new Date().toISOString(),
    lastGrade: 0,
  };
}

/**
 * True once a backend flag carries durable SM-2 progress — i.e. it's been reviewed at
 * least once via the new PATCH /api/flags/{id}/review path (repetitionCount > 0 or
 * lastReviewedAt set). Flags that only have the column defaults (easinessFactor 2.5,
 * repetitionCount 0, no lastReviewedAt) haven't been reviewed under the durable scheme yet
 * — either they're brand new, or their progress still only lives in localStorage pending
 * reconciliation.
 */
function hasBackendProgress(flag: FlaggedQuestion): boolean {
  return (flag.repetitionCount ?? 0) > 0 || !!flag.lastReviewedAt;
}

/**
 * Hydrates SM2Data straight from a backend flag's durable SM-2 columns (V8 migration) —
 * this is what lets the review queue survive a refresh/cache-clear/different device.
 */
function sm2FromFlag(flag: FlaggedQuestion): SM2Data {
  return {
    easeFactor: flag.easinessFactor ?? 2.5,
    interval: flag.intervalDays ?? 0,
    repetitions: flag.repetitionCount ?? 0,
    nextReviewDate: flag.nextReviewDate ?? new Date().toISOString(),
    lastReviewDate: flag.lastReviewedAt ?? new Date().toISOString(),
    lastGrade: 0, // not persisted server-side; only meaningful within a single review session
  };
}

// Persistence layer — localStorage remains an offline-first cache, but the backend's
// durable flagged_questions SM-2 columns (V8 migration) are now the source of truth.
// Reads prefer backend-hydrated state once a flag has real progress there; writes go to
// both (cache immediately, sync through PATCH /api/flags/{id}/review).
export const spacedRepetitionService = {
  getAllSM2Data(): Record<string, SM2Data> {
    try {
      const raw = localStorage.getItem(SM2_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  getSM2Data(flagId: string): SM2Data {
    const all = this.getAllSM2Data();
    return all[flagId] || createInitialSM2();
  },

  saveSM2Data(flagId: string, data: SM2Data): void {
    const all = this.getAllSM2Data();
    all[flagId] = data;
    localStorage.setItem(SM2_STORAGE_KEY, JSON.stringify(all));
  },

  /**
   * Resolve the SM2 state to use for a flag: prefer the backend's durable columns once
   * they carry real progress, else fall back to the localStorage cache (covers brand-new
   * flags and the pre-reconciliation window where backend columns still hold defaults).
   */
  resolveSM2Data(flag: FlaggedQuestion): SM2Data {
    if (hasBackendProgress(flag)) {
      return sm2FromFlag(flag);
    }
    return this.getSM2Data(flag.id);
  },

  /**
   * Pushes durable SM-2 state to the backend (PATCH /api/flags/{id}/review). Best-effort —
   * the localStorage cache write already happened by the time this is called, so a network
   * failure here just means the next reconciliation pass (or a later review) catches up.
   */
  async pushReviewState(flagId: string, sm2: SM2Data): Promise<void> {
    await api.updateFlagReview(flagId, {
      easinessFactor: sm2.easeFactor,
      repetitionCount: sm2.repetitions,
      intervalDays: sm2.interval,
      nextReviewDate: sm2.nextReviewDate,
      lastReviewedAt: sm2.lastReviewDate,
    });
  },

  /**
   * Process a review grade for a flagged question. Writes through to both the localStorage
   * cache (immediate, always succeeds, keeps the queue responsive offline) and the backend
   * (durable — survives refresh/cache-clear/device switch): cache-then-sync, not
   * cache-instead-of-sync.
   */
  reviewQuestion(flagId: string, grade: number): SM2Data {
    const current = this.getSM2Data(flagId);
    const updated = calculateSM2(current, grade);
    this.saveSM2Data(flagId, updated);
    this.pushReviewState(flagId, updated).catch((e) => {
      console.warn('Failed to sync review state to backend (will retry on next review/reconciliation):', e);
    });
    return updated;
  },

  /**
   * One-time cutover/reconciliation pass (Phase 4 "Cutover note"): pre-existing
   * localStorage['nclex:sm2_data'] entries predate the durable backend columns and
   * question_id-linked flags. Rather than just "start loading from backend and ignore
   * local state" — which would silently orphan in-flight review schedules — match each
   * local entry to a backend flag and push it through PATCH /api/flags/{id}/review:
   *
   *   1. Direct match (the common case): local entries are keyed by flagId, which IS the
   *      backend flag's id — if that flag still exists and has no backend progress yet
   *      (i.e. it predates this feature), push the local schedule straight to it.
   *   2. Sole-orphan/sole-candidate fallback: for the rare case where a local entry's key
   *      no longer resolves to any current flag (e.g. flags were recreated server-side
   *      with new ids). NOTE: localStorage['nclex:sm2_data'] stores only schedule data
   *      (SM2Data — easeFactor/interval/repetitions/dates), not question content, so a
   *      true stem/topic content-match against backend flags isn't possible from the
   *      client's data alone. Instead, this pairs the orphan with a legacy flag
   *      (question_id IS NULL — the only ones that could plausibly predate the bank and
   *      be the target of a pre-cutover local schedule) that has no backend progress yet,
   *      but ONLY when there's exactly one orphaned local entry AND exactly one unclaimed
   *      legacy candidate — i.e. the match is unambiguous by elimination. Any broader
   *      pairing (multiple orphans/candidates) would risk attaching the wrong schedule to
   *      the wrong question, which is worse than leaving those entries localStorage-only
   *      (they're preserved, never deleted, and keep working from the local cache).
   *
   * Gated by RECONCILED_KEY, which is only latched once every matched entry has been
   * successfully pushed — a partial failure leaves it unset so the next load retries.
   * Always idempotent/safe to re-run: hasBackendProgress() is true for anything already
   * pushed, so direct-match (Pass 1) skips it on subsequent passes, and nothing is ever
   * double-applied or corrupted by running this more than once.
   */
  async reconcileWithBackend(flags: FlaggedQuestion[]): Promise<void> {
    if (localStorage.getItem(RECONCILED_KEY)) return;

    const localEntries = this.getAllSM2Data();
    const flagsById = new Map(flags.map((f) => [f.id, f]));
    const claimed = new Set<string>();
    const pending: { flagId: string; sm2: SM2Data }[] = [];
    const orphaned: { storedId: string; sm2: SM2Data }[] = [];

    // Pass 1: direct flagId match
    for (const [storedId, sm2] of Object.entries(localEntries)) {
      const flag = flagsById.get(storedId);
      if (flag) {
        if (!hasBackendProgress(flag)) {
          pending.push({ flagId: flag.id, sm2 });
          claimed.add(flag.id);
        }
      } else {
        orphaned.push({ storedId, sm2 });
      }
    }

    // Pass 2: narrow content-match fallback (see doc comment for why this stays conservative)
    if (orphaned.length === 1) {
      const legacyCandidates = flags.filter((f) => f.questionId == null && !hasBackendProgress(f) && !claimed.has(f.id));
      if (legacyCandidates.length === 1) {
        pending.push({ flagId: legacyCandidates[0].id, sm2: orphaned[0].sm2 });
        claimed.add(legacyCandidates[0].id);
      }
    }

    let allPushed = true;
    for (const { flagId, sm2 } of pending) {
      try {
        await this.pushReviewState(flagId, sm2);
        // Re-key the cache entry to the resolved flagId so future loads direct-match
        // without re-running content matching.
        this.saveSM2Data(flagId, sm2);
      } catch (e) {
        allPushed = false;
        console.warn(`Reconciliation: failed to push SM-2 state for flag ${flagId}:`, e);
      }
    }

    // Only latch the "done" gate once every pending entry made it to the backend. A
    // partial failure (e.g. a network blip on one PATCH) leaves RECONCILED_KEY unset so
    // the next load retries — safe to retry because hasBackendProgress() makes already-
    // pushed entries direct-match (and skip re-push) on the next pass; nothing is
    // double-applied. Without this, a single failed push would permanently strand that
    // entry as localStorage-only (it'd keep working locally, but never sync — quietly
    // defeating the "survives cache-clear/device-switch" goal of this cutover).
    if (allPushed) {
      localStorage.setItem(RECONCILED_KEY, new Date().toISOString());
    }
  },

  /**
   * Get all items due for review, sorted by priority. Hydrates from the backend's durable
   * SM-2 columns when a flag has real progress there; falls back to the localStorage cache
   * otherwise — see resolveSM2Data.
   */
  getDueItems(flags: FlaggedQuestion[]): ReviewItem[] {
    const now = new Date().toISOString();
    const items: ReviewItem[] = [];

    for (const flag of flags) {
      const sm2 = this.resolveSM2Data(flag);
      const isDue = sm2.nextReviewDate <= now;

      items.push({
        flagId: flag.id,
        question: flag.question as unknown as GeneratedQuestion,
        sm2,
        dueToday: isDue,
      });
    }

    // Sort: due items first (oldest first), then by ease factor (hardest first)
    return items.sort((a, b) => {
      if (a.dueToday && !b.dueToday) return -1;
      if (!a.dueToday && b.dueToday) return 1;
      if (a.dueToday && b.dueToday) {
        return a.sm2.nextReviewDate.localeCompare(b.sm2.nextReviewDate);
      }
      return a.sm2.easeFactor - b.sm2.easeFactor;
    });
  },

  /**
   * Get count of items due today
   */
  getDueCount(flags: FlaggedQuestion[]): number {
    const now = new Date().toISOString();
    return flags.filter((flag) => {
      const sm2 = this.resolveSM2Data(flag);
      return sm2.nextReviewDate <= now;
    }).length;
  },

  /**
   * Clear all SM2 data
   */
  clearAll(): void {
    localStorage.removeItem(SM2_STORAGE_KEY);
    localStorage.removeItem(RECONCILED_KEY);
  },
};
