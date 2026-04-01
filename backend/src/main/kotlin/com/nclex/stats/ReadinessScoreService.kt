package com.nclex.stats

import com.nclex.model.UserStats
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.max
import kotlin.math.min

/**
 * Calculates NCLEX readiness scores using the 2026 NCLEX-RN Test Plan weights.
 *
 * Factors considered:
 *   1. Topic accuracy (weighted by NCLEX-RN client needs categories)
 *   2. Question volume (diminishing returns past threshold)
 *   3. Recency decay (recent performance weighted more heavily)
 *   4. NCJMM clinical judgment step performance
 */
@Service
class ReadinessScoreService {
    private val logger = LoggerFactory.getLogger(javaClass)

    companion object {
        // 2026 NCLEX-RN Test Plan category weights (midpoint of percentage ranges)
        val NCLEX_WEIGHTS = mapOf(
            "Management of Care" to 0.21,                     // 18-24%
            "Safety and Infection Control" to 0.12,            // 10-14%
            "Health Promotion and Maintenance" to 0.09,        // 7-11%
            "Psychosocial Integrity" to 0.09,                  // 7-11%
            "Basic Care and Comfort" to 0.09,                  // 7-11%
            "Pharmacological and Parenteral Therapies" to 0.16,// 13-19%
            "Reduction of Risk Potential" to 0.12,             // 10-14%
            "Physiological Adaptation" to 0.12                 // 10-14%
        )

        // NCJMM (National Council Clinical Judgment Measurement Model) step weights
        val NCJMM_WEIGHTS = mapOf(
            "Recognize Cues" to 0.20,
            "Analyze Cues" to 0.20,
            "Prioritize Hypotheses" to 0.15,
            "Generate Solutions" to 0.15,
            "Take Action" to 0.15,
            "Evaluate Outcomes" to 0.15
        )

        // Minimum questions needed per topic for a reliable score
        private const val MIN_QUESTIONS_PER_TOPIC = 10
        // Volume at which diminishing returns plateau
        private const val VOLUME_PLATEAU = 50
        // Days of activity considered "recent"
        private const val RECENCY_WINDOW_DAYS = 14L
        // Weight distribution across score components
        private const val TOPIC_ACCURACY_WEIGHT = 0.50
        private const val VOLUME_WEIGHT = 0.15
        private const val RECENCY_WEIGHT = 0.15
        private const val NCJMM_WEIGHT = 0.20
    }

    /**
     * Calculate readiness from a user's stats.
     * Returns a ReadinessResult with overall score, band, and breakdowns.
     */
    fun calculateReadiness(userStats: UserStats): ReadinessResult {
        val topicAccuracy = calculateTopicAccuracy(userStats.topicScores)
        val volumeScore = calculateVolumeScore(userStats.history)
        val recencyScore = calculateRecencyScore(userStats.lastActiveAt)
        val ncjmmScore = calculateNcjmmScore(userStats.ncjmmScores)

        val overallScore = (
            topicAccuracy.weightedScore * TOPIC_ACCURACY_WEIGHT +
            volumeScore * VOLUME_WEIGHT +
            recencyScore * RECENCY_WEIGHT +
            ncjmmScore.weightedScore * NCJMM_WEIGHT
        ) * 100.0

        val clampedScore = min(100.0, max(0.0, overallScore))
        val band = classifyBand(clampedScore)

        return ReadinessResult(
            score = clampedScore,
            band = band,
            topicBreakdown = topicAccuracy.breakdown,
            ncjmmBreakdown = ncjmmScore.breakdown,
            volumeScore = volumeScore * 100,
            recencyScore = recencyScore * 100,
            questionsAnswered = userStats.history.size,
            recommendation = generateRecommendation(band, topicAccuracy, ncjmmScore)
        )
    }

    // ── Topic Accuracy (weighted by NCLEX-RN test plan) ───────────

    @Suppress("UNCHECKED_CAST")
    private fun calculateTopicAccuracy(topicScores: Map<String, Any>): TopicResult {
        var weightedSum = 0.0
        var totalWeight = 0.0
        val breakdown = mutableMapOf<String, TopicDetail>()

        for ((topic, weight) in NCLEX_WEIGHTS) {
            val topicData = topicScores[topic] as? Map<String, Any>
            val correct = (topicData?.get("correct") as? Number)?.toDouble() ?: 0.0
            val total = (topicData?.get("total") as? Number)?.toDouble() ?: 0.0

            val accuracy = if (total >= MIN_QUESTIONS_PER_TOPIC) {
                correct / total
            } else {
                // Penalize low sample size: blend with 50% baseline
                val sampleWeight = total / MIN_QUESTIONS_PER_TOPIC
                val rawAccuracy = if (total > 0) correct / total else 0.0
                rawAccuracy * sampleWeight + 0.5 * (1 - sampleWeight)
            }

            weightedSum += accuracy * weight
            totalWeight += weight
            breakdown[topic] = TopicDetail(
                accuracy = accuracy * 100,
                questionsAnswered = total.toInt(),
                weight = weight,
                sufficient = total >= MIN_QUESTIONS_PER_TOPIC
            )
        }

        val weightedScore = if (totalWeight > 0) weightedSum / totalWeight else 0.0
        return TopicResult(weightedScore, breakdown)
    }

    // ── Volume Score (diminishing returns) ───────────────────────

    private fun calculateVolumeScore(history: List<Map<String, Any>>): Double {
        val total = history.size.toDouble()
        if (total == 0.0) return 0.0
        // Logarithmic curve that plateaus around VOLUME_PLATEAU
        return min(1.0, Math.log(total + 1) / Math.log(VOLUME_PLATEAU.toDouble() + 1))
    }

    // ── Recency Score ───────────────────────────────────────────

    private fun calculateRecencyScore(lastActiveAt: Instant?): Double {
        if (lastActiveAt == null) return 0.0
        val daysSince = ChronoUnit.DAYS.between(lastActiveAt, Instant.now())
        if (daysSince < 0) return 1.0 // future date edge case
        if (daysSince > RECENCY_WINDOW_DAYS) return 0.0
        // Linear decay over the recency window
        return 1.0 - (daysSince.toDouble() / RECENCY_WINDOW_DAYS)
    }

    // ── NCJMM Score ─────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun calculateNcjmmScore(ncjmmScores: Map<String, Any>): NcjmmResult {
        var weightedSum = 0.0
        var totalWeight = 0.0
        val breakdown = mutableMapOf<String, Double>()

        for ((step, weight) in NCJMM_WEIGHTS) {
            val stepData = ncjmmScores[step] as? Map<String, Any>
            val correct = (stepData?.get("correct") as? Number)?.toDouble() ?: 0.0
            val total = (stepData?.get("total") as? Number)?.toDouble() ?: 0.0
            val accuracy = if (total > 0) correct / total else 0.0

            weightedSum += accuracy * weight
            totalWeight += weight
            breakdown[step] = accuracy * 100
        }

        val weightedScore = if (totalWeight > 0) weightedSum / totalWeight else 0.0
        return NcjmmResult(weightedScore, breakdown)
    }

    // ── Band Classification ─────────────────────────────────────

    fun classifyBand(score: Double): String = when {
        score >= 90 -> "Very High"
        score >= 75 -> "High"
        score >= 60 -> "Borderline"
        else -> "Low"
    }

    // ── Recommendations ─────────────────────────────────────────

    private fun generateRecommendation(
        band: String,
        topicResult: TopicResult,
        ncjmmResult: NcjmmResult
    ): String {
        val weakTopics = topicResult.breakdown
            .filter { it.value.accuracy < 70 }
            .entries
            .sortedBy { it.value.accuracy }
            .take(3)
            .map { it.key }

        val weakNcjmm = ncjmmResult.breakdown
            .filter { it.value < 70 }
            .entries
            .sortedBy { it.value }
            .take(2)
            .map { it.key }

        val parts = mutableListOf<String>()

        when (band) {
            "Very High" -> parts.add("Strong performance across the board.")
            "High" -> parts.add("Good progress — focus on weak areas to reach Very High.")
            "Borderline" -> parts.add("You're close to passing — targeted practice can push you over.")
            "Low" -> parts.add("More practice needed — focus on fundamentals and high-weight topics.")
        }

        if (weakTopics.isNotEmpty()) {
            parts.add("Priority topics: ${weakTopics.joinToString(", ")}.")
        }
        if (weakNcjmm.isNotEmpty()) {
            parts.add("Clinical judgment focus: ${weakNcjmm.joinToString(", ")}.")
        }

        val insufficientTopics = topicResult.breakdown
            .filter { !it.value.sufficient }
            .keys
            .take(3)

        if (insufficientTopics.isNotEmpty()) {
            parts.add("Need more questions in: ${insufficientTopics.joinToString(", ")}.")
        }

        return parts.joinToString(" ")
    }

    // ── Result Data Classes ─────────────────────────────────────

    data class ReadinessResult(
        val score: Double,
        val band: String,
        val topicBreakdown: Map<String, TopicDetail>,
        val ncjmmBreakdown: Map<String, Double>,
        val volumeScore: Double,
        val recencyScore: Double,
        val questionsAnswered: Int,
        val recommendation: String
    )

    data class TopicDetail(
        val accuracy: Double,
        val questionsAnswered: Int,
        val weight: Double,
        val sufficient: Boolean
    )

    private data class TopicResult(
        val weightedScore: Double,
        val breakdown: Map<String, TopicDetail>
    )

    private data class NcjmmResult(
        val weightedScore: Double,
        val breakdown: Map<String, Double>
    )
}
