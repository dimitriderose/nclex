/**
 * Types for the ContentDB three-layer storage system
 */

export type ContentLayer = 'localStorage' | 'indexedDB' | 'api';

export interface ContentResult {
  source: ContentLayer;
  key: string;
  data: Record<string, unknown>;
  cached: boolean;
}

export type NCJMMStep =
  | 'recognize_cues'
  | 'analyze_cues'
  | 'prioritize_hypotheses'
  | 'generate_solutions'
  | 'take_action'
  | 'evaluate_outcomes';

export const NCJMM_STEPS: { key: NCJMMStep; label: string; description: string }[] = [
  { key: 'recognize_cues', label: 'Recognize Cues', description: 'Identify relevant information from different sources' },
  { key: 'analyze_cues', label: 'Analyze Cues', description: 'Organize and connect cues to identify patterns' },
  { key: 'prioritize_hypotheses', label: 'Prioritize Hypotheses', description: 'Evaluate and rank hypotheses based on urgency and likelihood' },
  { key: 'generate_solutions', label: 'Generate Solutions', description: 'Identify expected outcomes and plan interventions' },
  { key: 'take_action', label: 'Take Action', description: 'Implement the best nursing intervention' },
  { key: 'evaluate_outcomes', label: 'Evaluate Outcomes', description: 'Compare observed outcomes with expected outcomes' },
];

export type QuestionType = 'mc' | 'sata' | 'dosage' | 'pharmacology';

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface GeneratedQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  rationale: string;
  ncjmmStep: NCJMMStep;
  ncjmmValidated: boolean;
  topic: string;
  subtopic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: string;
  sourceKey: string;
  partialCredit?: boolean; // For SATA
  calculation?: {
    formula: string;
    correctAnswer: number;
    unit: string;
    tolerance?: number;
  };
  createdAt: string;
}

export type NGNQuestionType =
  | 'matrix_multiple_choice'
  | 'multiple_response_grouping'
  | 'cloze_drop_down'
  | 'enhanced_hot_spot'
  | 'bow_tie'
  | 'trend'
  | 'drag_and_drop_cloze'
  | 'drag_and_drop_rationale'
  | 'drop_down_cloze'
  | 'drop_down_rationale'
  | 'drop_down_table'
  | 'highlight_text'
  | 'highlight_table'
  | 'matrix_multiple_response';

export interface NGNCaseStudy {
  id: string;
  title: string;
  scenario: string;
  tabs: NGNCaseTab[];
  questions: NGNCaseQuestion[];
  topic: string;
  source: string;
  safetyValidated: boolean;
  createdAt: string;
}

export interface NGNCaseTab {
  id: string;
  label: string;
  content: string;
  type: 'nurses_notes' | 'hcp_orders' | 'vital_signs' | 'lab_results' | 'history' | 'medication_list' | 'imaging' | 'custom';
}

export interface NGNCaseQuestion {
  id: string;
  type: NGNQuestionType;
  prompt: string;
  data: Record<string, unknown>; // Type-specific data
  correctAnswer: unknown;
  rationale: string;
  ncjmmStep: NCJMMStep;
  maxScore: number;
}

// Spaced repetition types
export interface SM2Data {
  easeFactor: number; // >= 1.3
  interval: number; // days
  repetitions: number;
  nextReviewDate: string; // ISO date
  lastReviewDate: string;
  lastGrade: number; // 0-5
}

export interface ReviewItem {
  flagId: string;
  question: GeneratedQuestion;
  sm2: SM2Data;
  dueToday: boolean;
}

// Progress/Stats types
export interface TopicAccuracy {
  topic: string;
  correct: number;
  total: number;
  percentage: number;
  trend: number[]; // Last N accuracy percentages
}

export interface NCJMMAccuracy {
  step: NCJMMStep;
  correct: number;
  total: number;
  percentage: number;
}

export type ReadinessBand = 'low' | 'borderline' | 'high' | 'very_high';

export interface ReadinessAssessment {
  score: number;
  band: ReadinessBand;
  topicScores: TopicAccuracy[];
  ncjmmScores: NCJMMAccuracy[];
  recommendation: string;
}

// Voice assistant types
export interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: string | null;
  handsFreeModeEnabled: boolean;
}

// Offline types
export interface SyncQueueItem {
  id: string;
  type: 'stats_update' | 'flag_create' | 'flag_update' | 'flag_delete' | 'history_append';
  payload: Record<string, unknown>;
  createdAt: string;
  retries: number;
}

export interface OfflineState {
  isOnline: boolean;
  queueLength: number;
  lastSyncAt: string | null;
  offlineBankSize: number;
}
