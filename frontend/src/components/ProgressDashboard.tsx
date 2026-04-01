import { useState, useEffect, useMemo } from 'react';
import type { TopicAccuracy, NCJMMAccuracy, ReadinessBand, NCJMMStep, ReadinessAssessment } from '../types/content';
import { NCJMM_STEPS } from '../types/content';
import type { UserStats, HistoryEntry } from '../types';
import { api } from '../services/api';
import './ProgressDashboard.css';

// NCLEX Test Plan topic weights (2023 blueprint)
const TOPIC_WEIGHTS: Record<string, number> = {
  'Management of Care': 0.18,
  'Safety and Infection Control': 0.12,
  'Health Promotion and Maintenance': 0.09,
  'Psychosocial Integrity': 0.09,
  'Basic Care and Comfort': 0.09,
  'Pharmacological Therapies': 0.15,
  'Reduction of Risk Potential': 0.12,
  'Physiological Adaptation': 0.14,
};

const DEFAULT_WEIGHT = 0.08;

function calculateReadinessBand(score: number): ReadinessBand {
  if (score >= 90) return 'very_high';
  if (score >= 75) return 'high';
  if (score >= 60) return 'borderline';
  return 'low';
}

function bandLabel(band: ReadinessBand): string {
  const labels: Record<ReadinessBand, string> = {
    low: 'Low (<60)',
    borderline: 'Borderline (60-74)',
    high: 'High (75-89)',
    very_high: 'Very High (90+)',
  };
  return labels[band];
}

function bandColor(band: ReadinessBand): string {
  const colors: Record<ReadinessBand, string> = {
    low: '#ef4444',
    borderline: '#f59e0b',
    high: '#22c55e',
    very_high: '#059669',
  };
  return colors[band];
}

export function ProgressDashboard() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStats().then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  const analysis = useMemo(() => {
    if (!stats) return null;

    // Topic accuracy
    const topicMap = new Map<string, { correct: number; total: number; recentScores: number[] }>();
    const ncjmmMap = new Map<NCJMMStep, { correct: number; total: number }>();

    for (const entry of stats.history as HistoryEntry[]) {
      const topic = entry.topic || 'Unknown';
      const existing = topicMap.get(topic) || { correct: 0, total: 0, recentScores: [] };
      existing.total++;
      if (entry.correct) existing.correct++;
      existing.recentScores.push(entry.correct ? 100 : 0);
      topicMap.set(topic, existing);

      // NCJMM tracking
      const step = (entry as Record<string, unknown>).ncjmmStep as NCJMMStep | undefined;
      if (step) {
        const ncjmm = ncjmmMap.get(step) || { correct: 0, total: 0 };
        ncjmm.total++;
        if (entry.correct) ncjmm.correct++;
        ncjmmMap.set(step, ncjmm);
      }
    }

    const topicAccuracies: TopicAccuracy[] = Array.from(topicMap.entries()).map(([topic, data]) => ({
      topic,
      correct: data.correct,
      total: data.total,
      percentage: Math.round((data.correct / data.total) * 100),
      trend: data.recentScores.slice(-10), // Last 10 attempts
    }));

    const ncjmmAccuracies: NCJMMAccuracy[] = NCJMM_STEPS.map((step) => {
      const data = ncjmmMap.get(step.key) || { correct: 0, total: 0 };
      return {
        step: step.key,
        correct: data.correct,
        total: data.total,
        percentage: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
      };
    });

    // Readiness score (weighted by topic importance)
    let weightedSum = 0;
    let weightSum = 0;
    for (const ta of topicAccuracies) {
      const weight = TOPIC_WEIGHTS[ta.topic] ?? DEFAULT_WEIGHT;
      weightedSum += ta.percentage * weight;
      weightSum += weight;
    }
    const readinessScore = weightSum > 0 ? Math.round(weightedSum / weightSum) : 0;
    const band = calculateReadinessBand(readinessScore);

    // Session history (group by date)
    const sessions = new Map<string, number>();
    for (const entry of stats.history) {
      const date = entry.timestamp?.split('T')[0] || 'unknown';
      sessions.set(date, (sessions.get(date) || 0) + 1);
    }

    const assessment: ReadinessAssessment = {
      score: readinessScore,
      band,
      topicScores: topicAccuracies,
      ncjmmScores: ncjmmAccuracies,
      recommendation: band === 'very_high'
        ? 'You are performing exceptionally well. Focus on maintaining your knowledge and tackling weak areas.'
        : band === 'high'
          ? 'Strong performance. Continue practicing NGN-style questions and review borderline topics.'
          : band === 'borderline'
            ? 'You\'re close! Focus on your weakest topics and practice more SATA and clinical judgment questions.'
            : 'More study time needed. Focus on foundational concepts and high-weight NCLEX topics.',
    };

    return {
      assessment,
      topicAccuracies: topicAccuracies.sort((a, b) => a.percentage - b.percentage),
      ncjmmAccuracies,
      sessions: Array.from(sessions.entries()).map(([date, count]) => ({ date, count })).slice(-30),
      streak: stats.streak,
      totalQuestions: stats.history.length,
    };
  }, [stats]);

  if (loading) return <div className="dashboard-loading">Loading progress...</div>;
  if (!stats || !analysis) return <div className="dashboard-empty">No study data yet. Start answering questions!</div>;

  const { assessment, topicAccuracies, ncjmmAccuracies, sessions, streak, totalQuestions } = analysis;

  return (
    <div className="progress-dashboard">
      <h2>Progress Dashboard</h2>

      {/* Readiness Score */}
      <div className="readiness-card" style={{ borderColor: bandColor(assessment.band) }}>
        <div className="readiness-score" style={{ color: bandColor(assessment.band) }}>
          {assessment.score}%
        </div>
        <div className="readiness-band">{bandLabel(assessment.band)}</div>
        <p className="readiness-rec">{assessment.recommendation}</p>
      </div>

      {/* Quick stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{totalQuestions}</div>
          <div className="stat-label">Questions Answered</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">Day Streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{topicAccuracies.length}</div>
          <div className="stat-label">Topics Covered</div>
        </div>
      </div>

      {/* Topic Accuracy */}
      <div className="section">
        <h3>Topic Accuracy</h3>
        <div className="topic-bars">
          {topicAccuracies.map((ta) => (
            <div key={ta.topic} className="topic-row">
              <div className="topic-name">{ta.topic}</div>
              <div className="topic-bar-container">
                <div
                  className="topic-bar-fill"
                  style={{
                    width: `${ta.percentage}%`,
                    background: ta.percentage >= 75 ? '#22c55e' : ta.percentage >= 60 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <div className="topic-pct">{ta.percentage}%</div>
              <div className="topic-count">({ta.correct}/{ta.total})</div>
            </div>
          ))}
        </div>
      </div>

      {/* NCJMM Step Analytics */}
      <div className="section">
        <h3>Clinical Judgment (NCJMM) Steps</h3>
        <div className="ncjmm-grid">
          {ncjmmAccuracies.map((na) => {
            const stepInfo = NCJMM_STEPS.find((s) => s.key === na.step);
            return (
              <div key={na.step} className="ncjmm-card">
                <div className="ncjmm-label">{stepInfo?.label || na.step}</div>
                <div className="ncjmm-pct" style={{ color: na.percentage >= 75 ? '#22c55e' : na.percentage >= 60 ? '#f59e0b' : '#ef4444' }}>
                  {na.total > 0 ? `${na.percentage}%` : '--'}
                </div>
                <div className="ncjmm-count">{na.correct}/{na.total}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Study Session History */}
      <div className="section">
        <h3>Study Activity (Last 30 Days)</h3>
        <div className="session-chart">
          {sessions.map((s) => (
            <div key={s.date} className="session-bar-wrapper">
              <div
                className="session-bar"
                style={{ height: `${Math.min(s.count * 4, 100)}px` }}
                title={`${s.date}: ${s.count} questions`}
              />
              <div className="session-date">{s.date.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
