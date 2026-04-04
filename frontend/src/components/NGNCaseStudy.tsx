import { useState } from 'react';
import type { NGNCaseStudy as CaseStudyType, NGNCaseQuestion } from '../types/content';
import './NGNCaseStudy.css';

interface NGNCaseStudyProps {
  caseStudy: CaseStudyType;
  onComplete: (results: CaseQuestionResult[]) => void;
}

export interface CaseQuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  ncjmmStep: string;
}

export function NGNCaseStudyComponent({ caseStudy, onComplete }: NGNCaseStudyProps) {
  const [activeTab, setActiveTab] = useState(caseStudy.tabs[0]?.id || '');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [results, setResults] = useState<CaseQuestionResult[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const tab = caseStudy.tabs.find((t) => t.id === activeTab);
  const question = caseStudy.questions[currentQuestion];

  function handleQuestionComplete(result: CaseQuestionResult) {
    const newResults = [...results, result];
    setResults(newResults);

    if (currentQuestion < caseStudy.questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      setShowSummary(true);
      onComplete(newResults);
    }
  }

  if (showSummary) {
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const maxTotal = results.reduce((sum, r) => sum + r.maxScore, 0);
    return (
      <div className="ngn-case-study">
        <h2>{caseStudy.title} — Results</h2>
        <div className="case-summary">
          <div className="summary-score">{totalScore} / {maxTotal} ({Math.round((totalScore / maxTotal) * 100)}%)</div>
          {results.map((r, i) => (
            <div key={r.questionId} className="summary-row">
              <span>Question {i + 1}</span>
              <span>{r.score}/{r.maxScore}</span>
              <span className="badge badge-ncjmm">{r.ncjmmStep.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
        {!caseStudy.safetyValidated && (
          <div className="safety-warning">This case study has not been safety-validated. Content may contain inaccuracies.</div>
        )}
      </div>
    );
  }

  return (
    <div className="ngn-case-study">
      <div className="case-header">
        <h2>{caseStudy.title}</h2>
        <div className="case-meta">
          <span className="badge badge-type">NGN Case Study</span>
          <span className="badge badge-ncjmm">{caseStudy.topic}</span>
          {caseStudy.safetyValidated && <span className="badge badge-validated" title="Safety validated">\u2713 Safe</span>}
          <span className="case-source">Source: {caseStudy.source}</span>
        </div>
      </div>

      <div className="case-scenario">
        <p>{caseStudy.scenario}</p>
      </div>

      {/* Tabs */}
      <div className="case-tabs">
        {caseStudy.tabs.map((t) => (
          <button
            key={t.id}
            className={`tab-btn${t.id === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab && <pre className="tab-text">{tab.content}</pre>}
      </div>

      {/* Current question */}
      <div className="case-question-area">
        <div className="question-counter">Question {currentQuestion + 1} of {caseStudy.questions.length}</div>
        {question && <NGNQuestionRenderer question={question} onComplete={handleQuestionComplete} />}
      </div>
    </div>
  );
}

function NGNQuestionRenderer({ question, onComplete }: { question: NGNCaseQuestion; onComplete: (r: CaseQuestionResult) => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [highlightedItems, setHighlightedItems] = useState<string[]>([]);

  function handleSubmit() {
    setSubmitted(true);
    // Basic scoring - compare answers to correctAnswer
    let score = 0;
    const data = question.data;

    if (question.type === 'matrix_multiple_choice' || question.type === 'matrix_multiple_response') {
      const correct = (data.correctSelections || {}) as Record<string, string>;
      for (const [row, col] of Object.entries(correct)) {
        if (answers[row] === col) score++;
      }
    } else if (question.type === 'highlight_text' || question.type === 'highlight_table') {
      const correctHL = (data.correctHighlights || []) as string[];
      for (const hl of correctHL) {
        if (highlightedItems.includes(hl)) score++;
      }
    } else if (question.type === 'cloze_drop_down' || question.type === 'drop_down_cloze') {
      const blanks = (data.blanks || {}) as Record<string, { correct: string }>;
      for (const [blankId, blankData] of Object.entries(blanks)) {
        if (answers[blankId] === blankData.correct) score++;
      }
    } else {
      // Generic scoring for bow_tie, trend, etc.
      score = Math.round(question.maxScore * 0.5); // Partial credit placeholder
    }

    onComplete({
      questionId: question.id,
      score: Math.min(score, question.maxScore),
      maxScore: question.maxScore,
      ncjmmStep: question.ncjmmStep,
    });
  }

  return (
    <div className="ngn-question">
      <p className="ngn-prompt">{question.prompt}</p>
      <span className="badge badge-ncjmm">{question.ncjmmStep.replace(/_/g, ' ')}</span>

      {/* Matrix rendering */}
      {(question.type === 'matrix_multiple_choice' || question.type === 'matrix_multiple_response') && (
        <div className="matrix-container">
          <table className="matrix-table">
            <thead>
              <tr>
                <th></th>
                {((question.data.columns || []) as string[]).map((col) => <th key={col}>{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {((question.data.rows || []) as string[]).map((row) => (
                <tr key={row}>
                  <td className="row-label">{row}</td>
                  {((question.data.columns || []) as string[]).map((col) => (
                    <td key={col} className="matrix-cell">
                      <input
                        type="radio"
                        name={`matrix-${row}`}
                        checked={answers[row] === col}
                        onChange={() => setAnswers((prev) => ({ ...prev, [row]: col }))}
                        disabled={submitted}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cloze drop-down rendering */}
      {(question.type === 'cloze_drop_down' || question.type === 'drop_down_cloze') && (
        <div className="cloze-container">
          {Object.entries((question.data.blanks || {}) as Record<string, { options: string[]; correct: string }>).map(
            ([blankId, blankData]) => (
              <div key={blankId} className="cloze-blank">
                <label>{blankId}:</label>
                <select
                  value={answers[blankId] || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [blankId]: e.target.value }))}
                  disabled={submitted}
                >
                  <option value="">Select...</option>
                  {blankData.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            )
          )}
        </div>
      )}

      {/* Highlight text rendering */}
      {(question.type === 'highlight_text' || question.type === 'highlight_table') && (
        <div className="highlight-container">
          {((question.data.correctHighlights || []) as string[]).map((phrase) => (
            <button
              key={phrase}
              className={`highlight-phrase${highlightedItems.includes(phrase) ? ' highlighted' : ''}`}
              onClick={() => {
                if (!submitted) {
                  setHighlightedItems((prev) =>
                    prev.includes(phrase) ? prev.filter((p) => p !== phrase) : [...prev, phrase]
                  );
                }
              }}
              disabled={submitted}
            >
              {phrase}
            </button>
          ))}
        </div>
      )}

      {/* Bow-tie rendering */}
      {question.type === 'bow_tie' && (
        <div className="bowtie-container">
          <div className="bowtie-section">
            <h4>Conditions</h4>
            {((question.data.conditions || []) as string[]).map((c) => (
              <label key={c} className="bowtie-item">
                <input type="checkbox" disabled={submitted} /> {c}
              </label>
            ))}
          </div>
          <div className="bowtie-section">
            <h4>Actions</h4>
            {((question.data.actions || []) as string[]).map((a) => (
              <label key={a} className="bowtie-item">
                <input type="checkbox" disabled={submitted} /> {a}
              </label>
            ))}
          </div>
          <div className="bowtie-section">
            <h4>Parameters</h4>
            {((question.data.parameters || []) as string[]).map((p) => (
              <label key={p} className="bowtie-item">
                <input type="checkbox" disabled={submitted} /> {p}
              </label>
            ))}
          </div>
        </div>
      )}

      {!submitted && (
        <button className="submit-btn" onClick={handleSubmit}>Submit Answer</button>
      )}

      {submitted && (
        <div className="rationale">
          <h4>Rationale</h4>
          <p>{question.rationale}</p>
        </div>
      )}
    </div>
  );
}
