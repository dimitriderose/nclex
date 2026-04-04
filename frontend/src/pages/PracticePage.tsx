import { useState, useCallback } from 'react'
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

export function PracticePage() {
  const [question, setQuestion] = useState<GeneratedQuestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(TOPICS[0])
  const [selectedType, setSelectedType] = useState<QuestionType>('mc')
  const [questionsAnswered, setQuestionsAnswered] = useState(0)

  const generateQuestion = useCallback(async () => {
    setLoading(true)
    setError('')
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
  }, [selectedTopic, selectedType])

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
        <QuestionCard
          key={question.id}
          question={question}
          onAnswer={handleAnswer}
        />
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
