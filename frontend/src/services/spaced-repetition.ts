/**
 * SM-2 Spaced Repetition Algorithm
 * Implements the SuperMemo SM-2 algorithm for review scheduling
 */

import type { SM2Data, ReviewItem, GeneratedQuestion } from '../types/content';
import type { FlaggedQuestion } from '../types';

const SM2_STORAGE_KEY = 'nclex:sm2_data';

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

// Persistence layer
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
   * Process a review grade for a flagged question
   */
  reviewQuestion(flagId: string, grade: number): SM2Data {
    const current = this.getSM2Data(flagId);
    const updated = calculateSM2(current, grade);
    this.saveSM2Data(flagId, updated);
    return updated;
  },

  /**
   * Get all items due for review, sorted by priority
   */
  getDueItems(flags: FlaggedQuestion[]): ReviewItem[] {
    const now = new Date().toISOString();
    const items: ReviewItem[] = [];

    for (const flag of flags) {
      const sm2 = this.getSM2Data(flag.id);
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
      const sm2 = this.getSM2Data(flag.id);
      return sm2.nextReviewDate <= now;
    }).length;
  },

  /**
   * Clear all SM2 data
   */
  clearAll(): void {
    localStorage.removeItem(SM2_STORAGE_KEY);
  },
};
