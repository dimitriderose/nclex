const BASE_URL = '/api'

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(body.message || 'Request failed')
  }

  return response
}

export interface ExamStartResponse {
  sessionId: string
  status: string
  timeLimitMinutes: number
  currentQuestion: ExamQuestion
  totalQuestions: number
  currentDifficulty: number
}

export interface ExamQuestion {
  questionId: string
  questionNumber: number
  topic: string
  difficulty: number
  difficultyLabel: string
  stem: string
  options: { id: string; text: string }[]
  type: string
  maxQuestions: number
  minQuestions: number
}

export interface AnswerResponse {
  correct: boolean
  questionsAnswered: number
  currentDifficulty: number
  nextQuestion?: ExamQuestion
  elapsedSeconds: number
  examContinues: boolean
  // Exam results fields (when examContinues is false)
  passPrediction?: boolean
  confidenceLevel?: number
  accuracy?: number
  topicBreakdown?: Record<string, { correct: number; total: number; accuracy: number }>
  timeAnalysis?: { avgTimePerQuestion: number; totalTimeMinutes: number; remainingMinutes: number }
  difficultyAnalysis?: { initial: number; average: number; final: number; trend: string }
}

export interface ExamResults {
  sessionId: string
  status: string
  passPrediction: boolean
  confidenceLevel: number
  totalQuestions: number
  correctCount: number
  accuracy: number
  topicBreakdown: Record<string, { correct: number; total: number; accuracy: number }>
  elapsedSeconds: number
  timeLimitMinutes: number
  timeAnalysis: { avgTimePerQuestion: number; totalTimeMinutes: number; remainingMinutes: number }
  difficultyAnalysis: { initial: number; average: number; final: number; trend: string }
  startedAt: string
  completedAt: string
  examContinues: boolean
}

export interface ExamHistoryItem {
  sessionId: string
  status: string
  totalQuestions: number
  correctCount: number
  passPrediction: boolean
  confidenceLevel: number
  startedAt: string
  completedAt: string
  elapsedSeconds: number
}

export const examApi = {
  async startExam(): Promise<ExamStartResponse> {
    const res = await authedFetch('/exam/start', { method: 'POST' })
    return res.json()
  },

  async submitAnswer(
    sessionId: string,
    questionId: string,
    selectedAnswer: string,
    timeSpentSeconds: number
  ): Promise<AnswerResponse> {
    const res = await authedFetch(`/exam/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId, selectedAnswer, timeSpentSeconds }),
    })
    return res.json()
  },

  async finishExam(sessionId: string): Promise<ExamResults> {
    const res = await authedFetch(`/exam/${sessionId}/finish`, { method: 'POST' })
    return res.json()
  },

  async getExamState(sessionId: string): Promise<ExamResults> {
    const res = await authedFetch(`/exam/${sessionId}`)
    return res.json()
  },

  async getExamHistory(): Promise<ExamHistoryItem[]> {
    const res = await authedFetch('/exam/history')
    return res.json()
  },
}
