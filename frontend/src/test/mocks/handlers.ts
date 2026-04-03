import { http, HttpResponse } from 'msw'

export const handlers = [
  // Auth
  http.post('/api/auth/register', () => HttpResponse.json({ message: 'Registration successful', email: 'test@example.com' })),
  http.post('/api/auth/login', () => HttpResponse.json({ message: 'Login successful', email: 'test@example.com' })),
  http.post('/api/auth/logout', () => HttpResponse.json({ message: 'Logged out successfully' })),
  http.get('/api/auth/me', () => HttpResponse.json({ authenticated: true, userId: '123', email: 'test@example.com', role: 'USER' })),

  // Stats
  http.get('/api/stats', () => HttpResponse.json({ topicScores: {}, history: [], streak: 5, readinessScore: 75.0, ncjmmScores: {} })),
  http.put('/api/stats', () => HttpResponse.json({ topicScores: {}, history: [], streak: 5, readinessScore: 75.0 })),
  http.patch('/api/stats/streak', () => HttpResponse.json({ streak: 6 })),
  http.patch('/api/stats/history', () => HttpResponse.json({ history: [{}] })),

  // Flags
  http.get('/api/flags', () => HttpResponse.json([])),
  http.post('/api/flags', () => HttpResponse.json({ id: '1', topic: 'test', category: 'REVIEW' })),
  http.put('/api/flags/:id', () => HttpResponse.json({ id: '1', category: 'HARD' })),
  http.delete('/api/flags/:id', () => new HttpResponse(null, { status: 204 })),

  // Claude
  http.post('/api/claude/chat', () => HttpResponse.json({ content: [{ type: 'text', text: 'response' }] })),

  // Errors
  http.post('/api/errors/report', () => HttpResponse.json({ status: 'reported' })),

  // Exam
  http.post('/api/exam/start', () => HttpResponse.json({
    sessionId: 'exam-1',
    status: 'IN_PROGRESS',
    timeLimitMinutes: 300,
    currentQuestion: {
      questionId: 'q1',
      questionNumber: 1,
      topic: 'Pharmacology',
      difficulty: 0.5,
      difficultyLabel: 'Medium',
      stem: 'Test question stem?',
      options: [
        { id: 'A', text: 'Option A' },
        { id: 'B', text: 'Option B' },
        { id: 'C', text: 'Option C' },
        { id: 'D', text: 'Option D' },
      ],
      type: 'mc',
      maxQuestions: 145,
      minQuestions: 75,
    },
    totalQuestions: 145,
    currentDifficulty: 0.5,
  })),
  http.post('/api/exam/:id/answer', () => HttpResponse.json({
    correct: true,
    questionsAnswered: 1,
    currentDifficulty: 0.55,
    nextQuestion: {
      questionId: 'q2',
      questionNumber: 2,
      topic: 'Safety',
      difficulty: 0.55,
      difficultyLabel: 'Medium',
      stem: 'Second question?',
      options: [
        { id: 'A', text: 'Option A' },
        { id: 'B', text: 'Option B' },
      ],
      type: 'mc',
      maxQuestions: 145,
      minQuestions: 75,
    },
    elapsedSeconds: 60,
    examContinues: true,
  })),
  http.post('/api/exam/:id/finish', () => HttpResponse.json({
    sessionId: 'exam-1',
    status: 'COMPLETED',
    passPrediction: true,
    confidenceLevel: 0.95,
    totalQuestions: 75,
    correctCount: 60,
    accuracy: 80,
    topicBreakdown: {},
    elapsedSeconds: 3600,
    timeLimitMinutes: 300,
    timeAnalysis: { avgTimePerQuestion: 48, totalTimeMinutes: 60, remainingMinutes: 240 },
    difficultyAnalysis: { initial: 0.5, average: 0.6, final: 0.7, trend: 'increasing' },
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T01:00:00Z',
    examContinues: false,
  })),
  http.get('/api/exam/history', () => HttpResponse.json([])),

  // Cache
  http.get('/api/cache', () => HttpResponse.json({ id: '1', contentKey: 'test', source: 'api', data: {}, ttlDays: 7 })),
  http.put('/api/cache', () => HttpResponse.json({ id: '1', contentKey: 'test', source: 'api', data: {} })),

  // Reading positions
  http.get('/api/reading-positions', () => HttpResponse.json([])),
  http.get('/api/reading-positions/:key', () => HttpResponse.json(null)),
  http.put('/api/reading-positions', () => HttpResponse.json({ id: '1', contentKey: 'test', position: {} })),
]
