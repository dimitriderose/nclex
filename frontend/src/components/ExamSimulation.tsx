import { useState, useEffect, useRef, useCallback } from 'react'
import { examApi } from '../services/exam-api'
import type {
  ExamStartResponse,
  ExamQuestion,
  ExamResults,
  ExamHistoryItem,
} from '../services/exam-api'
import './ExamSimulation.css'

export function ExamSimulation() {
  const [phase, setPhase] = useState<'start' | 'exam' | 'results' | 'history'>('start')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<ExamQuestion | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [questionsAnswered, setQuestionsAnswered] = useState(0)
  const [, setCurrentDifficulty] = useState(0.5)
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(300)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [results, setResults] = useState<ExamResults | null>(null)
  const [history, setHistory] = useState<ExamHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Timer
  useEffect(() => {
    if (phase === 'exam' && sessionId) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1
          if (next >= timeLimitMinutes * 60) {
            handleFinish()
          }
          return next
        })
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [phase, sessionId, timeLimitMinutes])

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const getRemainingTime = (): number => {
    return Math.max(0, timeLimitMinutes * 60 - elapsedSeconds)
  }

  const handleStart = async () => {
    setLoading(true)
    setError(null)
    try {
      const data: ExamStartResponse = await examApi.startExam()
      setSessionId(data.sessionId)
      setCurrentQuestion(data.currentQuestion)
      setTimeLimitMinutes(data.timeLimitMinutes)
      setQuestionsAnswered(0)
      setCurrentDifficulty(data.currentDifficulty)
      setElapsedSeconds(0)
      setQuestionStartTime(Date.now())
      setPhase('exam')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start exam')
    } finally {
      setLoading(false)
    }
  }

  const handleAnswer = async () => {
    if (!sessionId || !currentQuestion || !selectedAnswer) return
    setLoading(true)
    setError(null)
    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)
    try {
      const data = await examApi.submitAnswer(
        sessionId,
        currentQuestion.questionId,
        selectedAnswer,
        timeSpent
      )
      if (data.examContinues && data.nextQuestion) {
        setCurrentQuestion(data.nextQuestion)
        setQuestionsAnswered(data.questionsAnswered)
        setCurrentDifficulty(data.currentDifficulty)
        setElapsedSeconds(data.elapsedSeconds)
        setSelectedAnswer(null)
        setQuestionStartTime(Date.now())
      } else {
        setResults(data as unknown as ExamResults)
        setPhase('results')
        if (timerRef.current) clearInterval(timerRef.current)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setLoading(false)
    }
  }

  const handleFinish = useCallback(async () => {
    if (!sessionId) return
    if (timerRef.current) clearInterval(timerRef.current)
    setLoading(true)
    try {
      const data = await examApi.finishExam(sessionId)
      setResults(data)
      setPhase('results')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to finish exam')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  const handleViewHistory = async () => {
    setLoading(true)
    try {
      const data = await examApi.getExamHistory()
      setHistory(data)
      setPhase('history')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  // ── Start Screen ──────────────────────────────────────────────

  if (phase === 'start') {
    return (
      <div className="exam-container">
        <div className="exam-start-card">
          <h2>NCLEX-RN Exam Simulation</h2>
          <div className="exam-info">
            <div className="info-item">
              <span className="info-label">Questions</span>
              <span className="info-value">75–145 (CAT)</span>
            </div>
            <div className="info-item">
              <span className="info-label">Time Limit</span>
              <span className="info-value">5 hours</span>
            </div>
            <div className="info-item">
              <span className="info-label">Algorithm</span>
              <span className="info-value">Adaptive</span>
            </div>
          </div>
          <p className="exam-description">
            This simulation mirrors the real NCLEX-RN exam. Questions adapt to your ability level.
            The exam ends when the algorithm can predict pass/fail with 95% confidence, or at 145 questions.
          </p>
          {error && <p className="exam-error">{error}</p>}
          <div className="exam-actions">
            <button className="btn-primary" onClick={handleStart} disabled={loading}>
              {loading ? 'Starting...' : 'Begin Exam'}
            </button>
            <button className="btn-secondary" onClick={handleViewHistory}>
              View History
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Exam Screen ───────────────────────────────────────────────

  if (phase === 'exam' && currentQuestion) {
    const remaining = getRemainingTime()
    const progress = questionsAnswered / 145 * 100
    const isLowTime = remaining < 30 * 60 // less than 30 min

    return (
      <div className="exam-container">
        {/* Header Bar */}
        <div className="exam-header">
          <div className="exam-timer-section">
            <span className={`exam-timer ${isLowTime ? 'timer-warning' : ''}`}>
              {formatTime(remaining)}
            </span>
            <span className="timer-label">remaining</span>
          </div>
          <div className="exam-question-count">
            Question {questionsAnswered + 1} of 75–145
          </div>
          <div className="exam-difficulty-badge">
            {currentQuestion.difficultyLabel}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="exam-progress">
          <div className="exam-progress-bar" style={{ width: `${Math.min(100, progress)}%` }} />
          <div className="progress-markers">
            <span className="marker" style={{ left: `${75 / 145 * 100}%` }}>75</span>
            <span className="marker" style={{ left: '100%' }}>145</span>
          </div>
        </div>

        {/* Question */}
        <div className="exam-question-card">
          <div className="question-topic">{currentQuestion.topic}</div>
          <p className="question-stem">{currentQuestion.stem}</p>
          <div className="question-options">
            {currentQuestion.options.map((option) => (
              <button
                key={option.id}
                className={`option-btn ${selectedAnswer === option.id ? 'selected' : ''}`}
                onClick={() => setSelectedAnswer(option.id)}
              >
                <span className="option-letter">{option.id}</span>
                <span className="option-text">{option.text}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="exam-error">{error}</p>}

        {/* Actions */}
        <div className="exam-footer">
          <button
            className="btn-primary"
            onClick={handleAnswer}
            disabled={!selectedAnswer || loading}
          >
            {loading ? 'Submitting...' : 'Next'}
          </button>
          <button className="btn-danger" onClick={handleFinish} disabled={loading}>
            End Exam
          </button>
        </div>
      </div>
    )
  }

  // ── Results Screen ────────────────────────────────────────────

  if (phase === 'results' && results) {
    const passed = results.passPrediction
    return (
      <div className="exam-container">
        <div className="exam-results-card">
          <div className={`result-banner ${passed ? 'pass' : 'fail'}`}>
            <h2>{passed ? 'PASS' : 'BELOW PASSING'}</h2>
            <span className="confidence">
              {Math.round((results.confidenceLevel || 0) * 100)}% confidence
            </span>
          </div>

          <div className="results-grid">
            <div className="result-stat">
              <span className="stat-value">{results.totalQuestions}</span>
              <span className="stat-label">Questions</span>
            </div>
            <div className="result-stat">
              <span className="stat-value">{results.correctCount}</span>
              <span className="stat-label">Correct</span>
            </div>
            <div className="result-stat">
              <span className="stat-value">{Math.round(results.accuracy || 0)}%</span>
              <span className="stat-label">Accuracy</span>
            </div>
            <div className="result-stat">
              <span className="stat-value">
                {results.timeAnalysis
                  ? Math.round(results.timeAnalysis.totalTimeMinutes)
                  : 0}m
              </span>
              <span className="stat-label">Time Used</span>
            </div>
          </div>

          {/* Topic Breakdown */}
          {results.topicBreakdown && (
            <div className="topic-breakdown">
              <h3>Topic Breakdown</h3>
              {Object.entries(results.topicBreakdown).map(([topic, data]) => (
                <div key={topic} className="topic-row">
                  <span className="topic-name">{topic}</span>
                  <div className="topic-bar-container">
                    <div
                      className="topic-bar"
                      style={{ width: `${data.accuracy || 0}%` }}
                    />
                  </div>
                  <span className="topic-pct">{Math.round(data.accuracy || 0)}%</span>
                  <span className="topic-count">{data.total} Qs</span>
                </div>
              ))}
            </div>
          )}

          {/* Difficulty Analysis */}
          {results.difficultyAnalysis && (
            <div className="difficulty-section">
              <h3>Difficulty Trend</h3>
              <p>
                Started at {Math.round(results.difficultyAnalysis.initial * 100)}%,
                ended at {Math.round(results.difficultyAnalysis.final * 100)}%
                ({results.difficultyAnalysis.trend})
              </p>
            </div>
          )}

          <div className="exam-actions">
            <button className="btn-primary" onClick={() => setPhase('start')}>
              Take Another Exam
            </button>
            <button className="btn-secondary" onClick={handleViewHistory}>
              View History
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── History Screen ────────────────────────────────────────────

  if (phase === 'history') {
    return (
      <div className="exam-container">
        <div className="exam-history-card">
          <h2>Exam History</h2>
          {history.length === 0 ? (
            <p className="no-history">No exam sessions yet.</p>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <div key={item.sessionId} className="history-item">
                  <div className="history-result">
                    <span className={`badge ${item.passPrediction ? 'pass' : 'fail'}`}>
                      {item.passPrediction ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="history-status">{item.status}</span>
                  </div>
                  <div className="history-details">
                    <span>{item.totalQuestions} questions</span>
                    <span>{item.correctCount} correct</span>
                    <span>{Math.round(item.elapsedSeconds / 60)}m</span>
                    <span>{new Date(item.startedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-secondary" onClick={() => setPhase('start')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  return <div className="exam-container"><p>Loading...</p></div>
}
