import { useState, useCallback, useRef, useEffect } from 'react'
import { QuestionCard } from '../components/QuestionCard'
import type { AnswerResult } from '../components/QuestionCard'
import { questionService } from '../services/question-service'
import { offlineBank } from '../services/offline-bank'
import { syncQueue } from '../services/sync-queue'
import { api } from '../services/api'
import type { GeneratedQuestion, QuestionType } from '../types/content'

const TOPICS = [
  'Pharmacological Therapies', 'Management of Care', 'Safety and Infection Control',
  'Physiological Adaptation', 'Reduction of Risk Potential', 'Basic Care and Comfort',
  'Health Promotion and Maintenance', 'Psychosocial Integrity',
]

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'mc', label: 'Multiple Choice' },
  { value: 'sata', label: 'Select All That Apply' },
  { value: 'dosage', label: 'Dosage Calculation' },
  { value: 'pharmacology', label: 'Pharmacology' },
]

// Prefetch queue tuning: fill to QUEUE_TARGET on (re)selection, top back up in the
// background once the queue drops to QUEUE_REPLENISH_THRESHOLD remaining (after serving
// the current question, so the user always has a couple buffered while we fetch more).
const QUEUE_TARGET = 5
const QUEUE_REPLENISH_THRESHOLD = 2

export function PracticePage() {
  const [question, setQuestion] = useState<GeneratedQuestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(TOPICS[0])
  const [selectedType, setSelectedType] = useState<QuestionType>('mc')
  const [questionsAnswered, setQuestionsAnswered] = useState(0)

  // The prefetch queue lives in a ref (not state) — it's mutated by async fetches and
  // read synchronously when serving "Next Question", and queue contents alone shouldn't
  // trigger re-renders (only `question`/`loading`/`error` need to).
  const queueRef = useRef<GeneratedQuestion[]>([])
  const replenishingRef = useRef(false)
  // Guards against a stale async batch (from a topic/type the user has since changed away
  // from) landing in the queue after the fact.
  const queueKeyRef = useRef('')

  const queueKey = `${selectedTopic}::${selectedType}`

  const fillQueue = useCallback(async (topic: string, questionType: QuestionType, count: number) => {
    if (count <= 0) return
    try {
      const batch = await questionService.generateBatch({
        topics: [topic],
        questionTypes: [questionType],
        count,
        difficulty: 'medium',
      })
      // Stale response — the user switched topic/type while this was in flight.
      if (queueKeyRef.current !== `${topic}::${questionType}`) return
      // QuestionBankService can return fewer than requested (Claude generation failures
      // are swallowed server-side) — append whatever came back rather than assuming the
      // queue is always fully topped up; the "always have N" guarantee degrades gracefully
      // to "have whatever the bank could produce" instead of silently breaking.
      if (batch.length > 0) {
        queueRef.current = [...queueRef.current, ...batch]
      }
    } catch {
      // Swallow — the single-question generate()/offline-bank fallback in
      // generateQuestion() remains the error path when the queue runs dry.
    }
  }, [])

  const replenishIfLow = useCallback((topic: string, questionType: QuestionType) => {
    if (replenishingRef.current) return
    if (queueRef.current.length > QUEUE_REPLENISH_THRESHOLD) return

    const needed = QUEUE_TARGET - queueRef.current.length
    if (needed <= 0) return

    replenishingRef.current = true
    fillQueue(topic, questionType, needed).finally(() => {
      replenishingRef.current = false
    })
  }, [fillQueue])

  const generateQuestion = useCallback(async () => {
    setError('')

    // Serve instantly from the prefetch queue when possible — no spinner in the common case.
    const queued = queueRef.current.shift()
    if (queued) {
      setQuestion(queued)
      replenishIfLow(selectedTopic, selectedType)
      return
    }

    setLoading(true)
    setQuestion(null)

    try {
      const q = await questionService.generate({
        topic: selectedTopic,
        questionType: selectedType,
        difficulty: 'medium',
      })
      setQuestion(q)
    } catch {
      // Try offline bank
      const offlineQ = offlineBank.getRandomQuestion(selectedTopic)
      if (offlineQ) {
        setQuestion(offlineQ)
      } else {
        setError('Could not generate a question. Check your connection or try a different topic.')
      }
    } finally {
      setLoading(false)
    }
  }, [selectedTopic, selectedType, replenishIfLow])

  // On topic/type selection, (re)fill the queue from scratch for the new combination —
  // discard whatever was queued for the previous selection (it no longer matches) and
  // prefetch a fresh batch so the first "Next Question" for this combo is instant too.
  useEffect(() => {
    queueKeyRef.current = queueKey
    queueRef.current = []
    replenishingRef.current = true
    fillQueue(selectedTopic, selectedType, QUEUE_TARGET).finally(() => {
      replenishingRef.current = false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey])

  const handleAnswer = useCallback(async (result: AnswerResult) => {
    setQuestionsAnswered((prev) => prev + 1)

    const historyEntry = {
      topic: result.topic,
      correct: result.correct,
      timestamp: new Date().toISOString(),
      ncjmmStep: result.ncjmmStep,
      score: result.score,
      timeTaken: result.timeTaken,
    }

    try {
      await api.appendHistory(historyEntry)
    } catch {
      syncQueue.enqueue('history_append', historyEntry)
    }

    // Records the attempt server-side (drives attempt-history + auto-flagging of wrong
    // answers — see POST /api/questions/{id}/attempt). Best-effort and fire-and-forget:
    // questions served from the offline bank/single-generate fallback may not carry a
    // durable bank id the server recognizes (404), and losing one attempt record isn't
    // worth surfacing an error to the user mid-practice.
    questionService.recordAttempt(result.questionId, result.correct).catch(() => {})
  }, [])

  return (
    <div className="practice-page">
      <div className="practice-controls">
        <select value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)}>
          {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={selectedType} onChange={(e) => setSelectedType(e.target.value as QuestionType)}>
          {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={generateQuestion} disabled={loading}>
          {loading ? 'Generating...' : 'New Question'}
        </button>
        <span className="questions-count">{questionsAnswered} answered this session</span>
      </div>

      {error && <div className="practice-error">{error}</div>}

      {question && (
        <>
          <QuestionCard
            key={question.id}
            question={question}
            onAnswer={handleAnswer}
          />
          <div className="practice-next">
            <button onClick={generateQuestion} disabled={loading}>
              {loading ? 'Generating...' : 'Next Question'}
            </button>
          </div>
        </>
      )}

      {!question && !loading && !error && (
        <div className="practice-empty">
          <h2>Ready to Practice?</h2>
          <p>Select a topic and question type, then click "New Question" to start.</p>
        </div>
      )}
    </div>
  )
}
