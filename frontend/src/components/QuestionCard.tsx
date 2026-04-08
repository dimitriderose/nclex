import { useState } from 'react';
import type { GeneratedQuestion, NCJMMStep } from '../types/content';
import { NCJMM_STEPS } from '../types/content';
import { questionService } from '../services/question-service';

interface QuestionCardProps {
  question: GeneratedQuestion;
  onAnswer: (result: AnswerResult) => void;
  showRationale?: boolean;
}

export interface AnswerResult {
  questionId: string;
  correct: boolean;
  score: number;
  selectedIds: string[];
  ncjmmStep: NCJMMStep;
  topic: string;
  timeTaken: number;
}

export function QuestionCard({ question, onAnswer, showRationale: forceShowRationale }: QuestionCardProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dosageAnswer, setDosageAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showRationale, setShowRationale] = useState(forceShowRationale ?? false);
  const [startTime] = useState(Date.now());

  const isSATA = question.type === 'sata';
  const isDosage = question.type === 'dosage';

  function handleOptionClick(optionId: string) {
    if (submitted) return;

    if (isSATA) {
      setSelectedIds((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
      );
    } else {
      setSelectedIds([optionId]);
    }
  }

  function handleSubmit() {
    if (submitted) return;
    setSubmitted(true);
    setShowRationale(true);

    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    let correct = false;
    let score = 0;

    if (isDosage && question.calculation) {
      const numAnswer = parseFloat(dosageAnswer);
      correct = questionService.scoreDosage(
        numAnswer,
        question.calculation.correctAnswer,
        question.calculation.tolerance
      );
      score = correct ? 1 : 0;
    } else if (isSATA) {
      score = questionService.scoreSATA(selectedIds, question.options);
      correct = score >= 0.8; // 80% threshold for "correct" in SATA
    } else {
      correct = questionService.scoreMC(selectedIds[0], question.options);
      score = correct ? 1 : 0;
    }

    onAnswer({
      questionId: question.id,
      correct,
      score,
      selectedIds,
      ncjmmStep: question.ncjmmStep,
      topic: question.topic,
      timeTaken,
    });
  }

  function getOptionClass(optionId: string): string {
    const base = 'question-option';
    const isSelected = selectedIds.includes(optionId);
    const option = question.options.find((o) => o.id === optionId);

    if (!submitted) {
      return `${base}${isSelected ? ' selected' : ''}`;
    }

    if (option?.isCorrect) return `${base} correct`;
    if (isSelected && !option?.isCorrect) return `${base} incorrect`;
    return base;
  }

  const ncjmmLabel = NCJMM_STEPS.find((s) => s.key === question.ncjmmStep)?.label || question.ncjmmStep;

  return (
    <div className="question-card">
      {/* Header badges */}
      <div className="question-header">
        <span className="badge badge-type">{question.type.toUpperCase()}</span>
        <span className="badge badge-difficulty">{question.difficulty}</span>
        <span className="badge badge-ncjmm">{ncjmmLabel}</span>
        {question.ncjmmValidated && <span className="badge badge-validated" title="NCJMM tag validated">{'\u2713'}</span>}
      </div>

      {/* Topic */}
      <div className="question-topic">{question.topic}{question.subtopic ? ` \u203A ${question.subtopic}` : ''}</div>

      {/* Question stem */}
      <div className="question-stem">
        <p>{question.stem}</p>
        {isSATA && <p className="sata-instruction"><em>Select all that apply.</em></p>}
      </div>

      {/* Options */}
      {!isDosage && (
        <div className="question-options">
          {question.options.map((option) => (
            <button
              key={option.id}
              className={getOptionClass(option.id)}
              onClick={() => handleOptionClick(option.id)}
              disabled={submitted}
            >
              <span className="option-letter">{option.id}</span>
              <span className="option-text">{option.text}</span>
              {submitted && option.isCorrect && <span className="option-check">{'\u2713'}</span>}
              {submitted && selectedIds.includes(option.id) && !option.isCorrect && <span className="option-x">{'\u2717'}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Dosage calculation input */}
      {isDosage && (
        <div className="dosage-input">
          {question.calculation && (
            <p className="dosage-formula">Formula: {question.calculation.formula}</p>
          )}
          <div className="dosage-answer-row">
            <input
              type="number"
              step="any"
              value={dosageAnswer}
              onChange={(e) => setDosageAnswer(e.target.value)}
              disabled={submitted}
              placeholder="Enter your answer"
              className="dosage-field"
            />
            {question.calculation && <span className="dosage-unit">{question.calculation.unit}</span>}
          </div>
          {submitted && question.calculation && (
            <p className="dosage-correct">
              Correct answer: {question.calculation.correctAnswer} {question.calculation.unit}
            </p>
          )}
        </div>
      )}

      {/* Submit button */}
      {!submitted && (
        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={isDosage ? !dosageAnswer : selectedIds.length === 0}
        >
          Submit Answer
        </button>
      )}

      {/* Rationale */}
      {showRationale && (
        <div className="rationale">
          <h4>Rationale</h4>
          <p>{question.rationale}</p>
        </div>
      )}

      {/* Source attribution badge */}
      {showRationale && question.source && (
        <div className="source-attribution">
          <span className="source-badge">
            Source: {question.source}
            {question.sourceKey !== question.topic ? ` (${question.sourceKey})` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
