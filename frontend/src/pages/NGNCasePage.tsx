import { useState, useCallback } from 'react'
import { NGNCaseStudyComponent } from '../components/NGNCaseStudy'
import type { CaseQuestionResult } from '../components/NGNCaseStudy'
import type { NGNCaseStudy } from '../types/content'

const NGN_TOPICS = [
  'Heart Failure', 'Diabetic Ketoacidosis', 'Pneumonia', 'Stroke',
  'Sepsis', 'Postoperative Care', 'Maternal Health', 'Pediatric Assessment',
]

export function NGNCasePage() {
  const [caseStudy, setCaseStudy] = useState<NGNCaseStudy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(NGN_TOPICS[0])

  const generateCase = useCallback(async () => {
    setLoading(true)
    setError('')
    setCaseStudy(null)

    try {
      const res = await fetch('/api/ngn/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: selectedTopic }),
      })
      if (!res.ok) throw new Error('Failed to generate case study')
      const data = await res.json()
      setCaseStudy(data as NGNCaseStudy)
    } catch {
      setError('Could not generate case study. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [selectedTopic])

  const handleComplete = useCallback((results: CaseQuestionResult[]) => {
    console.log('Case study results:', results)
  }, [])

  return (
    <div className="ngn-page">
      {!caseStudy && (
        <div className="ngn-controls">
          <h2>NGN Case Studies</h2>
          <p>Practice Next Generation NCLEX clinical judgment scenarios.</p>
          <div className="ngn-topic-select">
            <select value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)}>
              {NGN_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={generateCase} disabled={loading}>
              {loading ? 'Generating...' : 'Start Case Study'}
            </button>
          </div>
          {error && <div className="practice-error">{error}</div>}
        </div>
      )}

      {caseStudy && (
        <NGNCaseStudyComponent
          caseStudy={caseStudy}
          onComplete={handleComplete}
        />
      )}
    </div>
  )
}
