/**
 * Offline question bank management
 * Stores 100 pre-generated questions in localStorage for offline use
 */

import type { GeneratedQuestion } from '../types/content';

const BANK_KEY = 'nclex:offline_bank';
const BANK_META_KEY = 'nclex:offline_bank_meta';
const BANK_SIZE = 100;
const BANK_MAX_AGE_DAYS = 7;

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

  clearBank(): void {
    localStorage.removeItem(BANK_KEY);
    localStorage.removeItem(BANK_META_KEY);
  },
};
