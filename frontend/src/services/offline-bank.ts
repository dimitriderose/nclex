/**
 * Offline question bank management
 * Stores 100 pre-generated questions in localStorage for offline use
 */

import type { GeneratedQuestion } from '../types/content';
import { questionService } from './question-service';

const BANK_KEY = 'nclex:offline_bank';
const BANK_META_KEY = 'nclex:offline_bank_meta';
const BANK_SIZE = 100;
// Signed-off PRD policy (docs/NCLEX_Trainer_v5_PRD.md:953) is a 24-hour regeneration window —
// was previously mismatched at 7 days, leaving the bank stale far longer than playtesters agreed to.
const BANK_MAX_AGE_DAYS = 1;

// Spread of NCLEX-RN client-needs categories (mirrors PracticePage's TOPICS / the exam
// simulator's TOPIC_DISTRIBUTION) — populating across all of them keeps the offline bank
// useful regardless of which topic the user practices while offline.
const BANK_TOPICS = [
  'Pharmacological Therapies', 'Management of Care', 'Safety and Infection Control',
  'Physiological Adaptation', 'Reduction of Risk Potential', 'Basic Care and Comfort',
  'Health Promotion and Maintenance', 'Psychosocial Integrity',
];

// generateBatch caps `count` at 20 server-side, so spreading BANK_SIZE across topics in
// chunks (round-robin across BANK_TOPICS per request) keeps each request within that limit
// while still reaching ~100 questions total.
const POPULATE_BATCH_SIZE = 20;

interface BankMeta {
  generatedAt: string;
  count: number;
  topics: string[];
  version: number;
}

export const offlineBank = {
  getBank(): GeneratedQuestion[] {
    try {
      const raw = localStorage.getItem(BANK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  setBank(questions: GeneratedQuestion[]): void {
    try {
      localStorage.setItem(BANK_KEY, JSON.stringify(questions));
      const meta: BankMeta = {
        generatedAt: new Date().toISOString(),
        count: questions.length,
        topics: [...new Set(questions.map((q) => q.topic))],
        version: 1,
      };
      localStorage.setItem(BANK_META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('Failed to save offline bank (quota?):', e);
    }
  },

  getMeta(): BankMeta | null {
    try {
      const raw = localStorage.getItem(BANK_META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  /**
   * Determine if the offline bank needs regeneration
   * Reasons: empty, too old, too small, version mismatch
   */
  shouldRegenerateBank(): boolean {
    const meta = this.getMeta();
    if (!meta) return true;

    // Bank is too small
    if (meta.count < BANK_SIZE * 0.5) return true;

    // Bank is too old
    const age = Date.now() - new Date(meta.generatedAt).getTime();
    const maxAge = BANK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (age > maxAge) return true;

    // Version mismatch
    if (meta.version < 1) return true;

    return false;
  },

  /**
   * Get a random question from the offline bank, optionally filtered by topic
   */
  getRandomQuestion(topic?: string): GeneratedQuestion | null {
    let bank = this.getBank();
    if (topic) {
      bank = bank.filter((q) => q.topic.toLowerCase().includes(topic.toLowerCase()));
    }
    if (bank.length === 0) return null;
    return bank[Math.floor(Math.random() * bank.length)];
  },

  /**
   * Remove a question from the bank (used questions)
   */
  removeQuestion(questionId: string): void {
    const bank = this.getBank().filter((q) => q.id !== questionId);
    this.setBank(bank);
  },

  getBankSize(): number {
    return this.getBank().length;
  },

  /**
   * Populate the offline bank per PRD §5.9: fetch ~BANK_SIZE questions spread across a
   * variety of topics (now bank-first server-side, so this mostly reuses existing
   * generated_questions rows rather than spending fresh Claude calls) and persist them
   * via setBank(). Intended to run on session end when shouldRegenerateBank() is true
   * (see useOnlineStatus's session-end trigger).
   *
   * Requests are chunked at POPULATE_BATCH_SIZE (the server-side generateBatch cap) and
   * round-robin across BANK_TOPICS so every category gets representation. Failures on
   * individual chunks are swallowed (best-effort) — a partially-filled bank from whatever
   * succeeded is still more useful offline than none, and shouldRegenerateBank() will
   * retry on the next session if the result lands below BANK_SIZE * 0.5.
   */
  async populateBank(): Promise<GeneratedQuestion[]> {
    const collected: GeneratedQuestion[] = [];
    let remaining = BANK_SIZE;
    let topicOffset = 0;

    while (remaining > 0) {
      const count = Math.min(POPULATE_BATCH_SIZE, remaining);
      const topics = Array.from(
        { length: Math.min(count, BANK_TOPICS.length) },
        (_, i) => BANK_TOPICS[(topicOffset + i) % BANK_TOPICS.length]
      );
      topicOffset += topics.length;

      try {
        const batch = await questionService.generateBatch({ topics, count, difficulty: 'medium' });
        collected.push(...batch);
      } catch (e) {
        console.warn('Offline bank population: batch failed, continuing with what we have', e);
      }

      remaining -= count;
    }

    if (collected.length > 0) {
      this.setBank(collected);
    }
    return collected;
  },

  /**
   * Convenience wrapper: regenerate the bank only if it's due (per shouldRegenerateBank),
   * otherwise no-op. Safe to call opportunistically (e.g., on session end / going offline)
   * without re-checking staleness at every call site.
   */
  async maybeRegenerateBank(): Promise<boolean> {
    if (!this.shouldRegenerateBank()) return false;
    const questions = await this.populateBank();
    return questions.length > 0;
  },

  clearBank(): void {
    localStorage.removeItem(BANK_KEY);
    localStorage.removeItem(BANK_META_KEY);
  },
};
