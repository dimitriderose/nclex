import { useState, useEffect, useCallback } from 'react';
import type { ReviewItem, SM2Data } from '../types/content';
import type { FlaggedQuestion } from '../types';
import { spacedRepetitionService } from '../services/spaced-repetition';
import { api } from '../services/api';
import { QuestionCard } from './QuestionCard';
import type { AnswerResult } from './QuestionCard';
import './ReviewQueue.css';

export function ReviewQueue() {
  const [flags, setFlags] = useState<FlaggedQuestion[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showGrading, setShowGrading] = useState(false);
  const [sessionResults, setSessionResults] = useState<{ flagId: string; grade: number; sm2: SM2Data }[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    async function loadFlags() {
      try {
        const allFlags = await api.getFlags();

        // One-time cutover: push any pre-existing localStorage-only SM-2 schedules to the
        // backend's durable columns before computing due items, so in-flight review
        // schedules survive the switch to backend-as-source-of-truth (see Phase 4 cutover
        // note in spaced-repetition.ts). Best-effort — getDueItems still falls back to the
        // localStorage cache if this fails, so a network hiccup here doesn't block review.
        let flagsForQueue = allFlags;
        try {
          await spacedRepetitionService.reconcileWithBackend(allFlags);
          // Re-fetch so getDueItems hydrates from the just-reconciled backend SM-2 columns
          // rather than the pre-reconciliation snapshot.
          flagsForQueue = await api.getFlags();
        } catch (e) {
          console.warn('SM-2 reconciliation failed (will retry next load):', e);
        }

        setFlags(flagsForQueue);
        const items = spacedRepetitionService.getDueItems(flagsForQueue);
        setReviewItems(items.filter((i) => i.dueToday));
      } catch (e) {
        console.error('Failed to load flags:', e);
      } finally {
        setLoading(false);
      }
    }
    loadFlags();
  }, []);

  const currentItem = reviewItems[currentIndex];

  const handleAnswer = useCallback((_result: AnswerResult) => {
    // Show grading buttons after answering
    setShowGrading(true);
  }, []);

  const handleGrade = useCallback((grade: number) => {
    if (!currentItem) return;

    const sm2 = spacedRepetitionService.reviewQuestion(currentItem.flagId, grade);
    setSessionResults((prev) => [...prev, { flagId: currentItem.flagId, grade, sm2 }]);
    setShowGrading(false);

    if (currentIndex < reviewItems.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setShowSummary(true);
    }
  }, [currentItem, currentIndex, reviewItems.length]);

  if (loading) return <div className="review-loading">Loading review queue...</div>;

  if (reviewItems.length === 0) {
    const totalFlags = flags.length;
    return (
      <div className="review-empty">
        <h3>No reviews due today!</h3>
        <p>
          {totalFlags > 0
            ? `You have ${totalFlags} flagged questions. Next reviews will appear when they're due.`
            : 'Flag questions during practice to build your review queue.'}
        </p>
      </div>
    );
  }

  if (showSummary) {
    const avgGrade = sessionResults.reduce((s, r) => s + r.grade, 0) / sessionResults.length;
    return (
      <div className="review-summary">
        <h2>Review Complete!</h2>
        <div className="summary-stats">
          <div className="summary-stat">
            <span className="stat-value">{sessionResults.length}</span>
            <span className="stat-label">Reviewed</span>
          </div>
          <div className="summary-stat">
            <span className="stat-value">{avgGrade.toFixed(1)}</span>
            <span className="stat-label">Avg Grade</span>
          </div>
        </div>
        <div className="summary-details">
          {sessionResults.map((r, i) => (
            <div key={r.flagId} className="summary-row">
              <span>Question {i + 1}</span>
              <span className={`grade grade-${r.grade >= 3 ? 'pass' : 'fail'}`}>Grade: {r.grade}</span>
              <span className="next-review">Next: {new Date(r.sm2.nextReviewDate).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="review-queue">
      <div className="review-header">
        <h3>Spaced Review</h3>
        <span className="review-progress">{currentIndex + 1} / {reviewItems.length}</span>
      </div>

      {currentItem?.question && (
        <QuestionCard
          key={currentItem.flagId}
          question={currentItem.question}
          onAnswer={handleAnswer}
        />
      )}

      {showGrading && (
        <div className="grading-panel">
          <p>How well did you know this?</p>
          <div className="grade-buttons">
            <button className="grade-btn grade-0" onClick={() => handleGrade(0)}>0{'\n'}Blackout</button>
            <button className="grade-btn grade-1" onClick={() => handleGrade(1)}>1{'\n'}Wrong</button>
            <button className="grade-btn grade-2" onClick={() => handleGrade(2)}>2{'\n'}Barely</button>
            <button className="grade-btn grade-3" onClick={() => handleGrade(3)}>3{'\n'}Hard</button>
            <button className="grade-btn grade-4" onClick={() => handleGrade(4)}>4{'\n'}Good</button>
            <button className="grade-btn grade-5" onClick={() => handleGrade(5)}>5{'\n'}Perfect</button>
          </div>
          {currentItem && (
            <div className="sm2-info">
              <span>Ease: {currentItem.sm2.easeFactor.toFixed(2)}</span>
              <span>Interval: {currentItem.sm2.interval}d</span>
              <span>Reps: {currentItem.sm2.repetitions}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
