/**
 * Frontend question generation service
 * Interfaces with backend /api/questions endpoints and manages question state
 */

import type { GeneratedQuestion, QuestionType, NCJMMStep } from '../types/content';

const BASE_URL = '/api';

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(body.message || `Request failed: ${response.status}`);
  }
  return response;
}

export interface GenerateOptions {
  topic: string;
  questionType?: QuestionType;
  difficulty?: 'easy' | 'medium' | 'hard';
  ncjmmStep?: NCJMMStep;
  context?: Record<string, unknown>;
}

export interface BatchGenerateOptions {
  topics: string[];
  count?: number;
  questionTypes?: QuestionType[];
  difficulty?: 'easy' | 'medium' | 'hard';
}

export const questionService = {
  async generate(options: GenerateOptions): Promise<GeneratedQuestion> {
    const res = await authedFetch('/questions/generate', {
      method: 'POST',
      body: JSON.stringify({
        topic: options.topic,
        questionType: options.questionType || 'mc',
        difficulty: options.difficulty || 'medium',
        ncjmmStep: options.ncjmmStep,
        context: options.context,
      }),
    });
    return res.json();
  },

  async generateBatch(options: BatchGenerateOptions): Promise<GeneratedQuestion[]> {
    const res = await authedFetch('/questions/generate/batch', {
      method: 'POST',
      body: JSON.stringify({
        topics: options.topics,
        count: options.count || 5,
        questionTypes: options.questionTypes || ['mc'],
        difficulty: options.difficulty || 'medium',
      }),
    });
    return res.json();
  },

  /**
   * Score a SATA answer with partial credit
   * Formula: (correct selections + correct non-selections) / total options
   */
  scoreSATA(selectedIds: string[], options: { id: string; isCorrect: boolean }[]): number {
    let score = 0;
    for (const opt of options) {
      const isSelected = selectedIds.includes(opt.id);
      if ((isSelected && opt.isCorrect) || (!isSelected && !opt.isCorrect)) {
        score++;
      }
    }
    return score / options.length;
  },

  /**
   * Score a dosage calculation answer
   */
  scoreDosage(answer: number, correct: number, tolerance?: number): boolean {
    const tol = tolerance || 0.1;
    return Math.abs(answer - correct) <= tol;
  },

  /**
   * Score a standard MC question
   */
  scoreMC(selectedId: string, options: { id: string; isCorrect: boolean }[]): boolean {
    const selected = options.find((o) => o.id === selectedId);
    return selected?.isCorrect ?? false;
  },
};
