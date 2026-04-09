package com.nclex.exam

import com.nclex.model.ExamSession
import com.nclex.model.ExamStatus
import com.nclex.repository.ExamSessionRepository
import com.nclex.repository.UserStatsRepository
import com.nclex.audit.AuditLogger
import com.nclex.exception.ForbiddenException
import com.nclex.exception.NotFoundException
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * CAT (Computerized Adaptive Testing) exam simulation.
 *
 * Mirrors the NCLEX-RN algorithm:
 * - 75 to 145 questions
 * - Difficulty adjusts based on performance
 * - Pass/fail decision based on 95% confidence interval
 * - 5-hour time limit
 * - Weighted question selection from weak topics
 */
@Service
class ExamSimulationService(
    private val examSessionRepository: ExamSessionRepository,
    private val userStatsRepository: UserStatsRepository,
    private val auditLogger: AuditLogger
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    companion object {
        const val MIN_QUESTIONS = 75
        const val MAX_QUESTIONS = 145
        const val TIME_LIMIT_MINUTES = 300 // 5 hours
        const val PASSING_STANDARD = 0.0 // logit = 0.0 is the pass line
        const val CONFIDENCE_THRESHOLD = 0.95
        const val INITIAL_DIFFICULTY = 0.5
        const val DIFFICULTY_STEP_UP = 0.05
        const val DIFFICULTY_STEP_DOWN = 0.05
        const val MIN_DIFFICULTY = 0.1
        const val MAX_DIFFICULTY = 0.95

        // NCLEX-RN client needs category distribution
        val TOPIC_DISTRIBUTION = mapOf(
            "Management of Care" to 0.21,
            "Safety and Infection Control" to 0.12,
            "Health Promotion and Maintenance" to 0.09,
            "Psychosocial Integrity" to 0.09,
            "Basic Care and Comfort" to 0.09,
            "Pharmacological and Parenteral Therapies" to 0.16,
            "Reduction of Risk Potential" to 0.12,
            "Physiological Adaptation" to 0.12
        )
    }

    // ── Start Exam ───────────────────────────────────────────────

    @Transactional
    fun startExam(userId: UUID): ExamSession {
        // Abandon any in-progress exam
        val existing = examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS)
        if (existing != null) {
            existing.status = ExamStatus.ABANDONED
            existing.completedAt = Instant.now()
            existing.updatedAt = Instant.now()
            examSessionRepository.save(existing)
        }

        val session = ExamSession(
            userId = userId,
            status = ExamStatus.IN_PROGRESS,
            currentDifficulty = INITIAL_DIFFICULTY,
            timeLimitMinutes = TIME_LIMIT_MINUTES
        )
        val saved = examSessionRepository.save(session)

        auditLogger.logUserAction(
            eventType = "EXAM_STARTED",
            userId = userId,
            metadata = mapOf("sessionId" to saved.id.toString())
        )

        return saved
    }

    // ── Submit Answer ────────────────────────────────────────────

    @Transactional
    fun submitAnswer(userId: UUID, sessionId: UUID, request: AnswerRequest): Map<String, Any> {
        val session = getSessionForUser(userId, sessionId)
        check(session.status == ExamStatus.IN_PROGRESS) { "Exam is not in progress" }

        // Check time limit
        val elapsed = Duration.between(session.startedAt, Instant.now()).seconds
        if (elapsed >= session.timeLimitMinutes * 60L) {
            return finishExam(userId, sessionId, ExamStatus.TIMED_OUT)
        }

        // Simulate answer correctness based on difficulty
        // In production this would check against a question bank
        val isCorrect = evaluateAnswer(request, session.currentDifficulty)

        // Update question history
        val historyEntry = mapOf(
            "questionId" to request.questionId,
            "selectedAnswer" to request.selectedAnswer,
            "correct" to isCorrect,
            "difficulty" to session.currentDifficulty,
            "timeSpentSeconds" to request.timeSpentSeconds,
            "timestamp" to Instant.now().toString()
        )
        session.questionHistory = session.questionHistory + historyEntry
        session.totalQuestions = session.questionHistory.size
        session.elapsedSeconds = elapsed

        if (isCorrect) {
            session.correctCount++
            session.currentDifficulty = min(MAX_DIFFICULTY, session.currentDifficulty + DIFFICULTY_STEP_UP)
        } else {
            session.currentDifficulty = max(MIN_DIFFICULTY, session.currentDifficulty - DIFFICULTY_STEP_DOWN)
        }

        // Update topic breakdown
        val topic = selectTopicForQuestion(session)
        session.topicBreakdown = updateTopicBreakdown(session.topicBreakdown, topic, isCorrect)
        session.updatedAt = Instant.now()

        // Check CAT termination rules
        val catDecision = evaluateCATRules(session)
        if (catDecision != null) {
            return finishExam(userId, sessionId, ExamStatus.COMPLETED, catDecision)
        }

        examSessionRepository.save(session)

        return mapOf(
            "correct" to isCorrect,
            "questionsAnswered" to session.totalQuestions,
            "currentDifficulty" to session.currentDifficulty,
            "nextQuestion" to getNextQuestion(session),
            "elapsedSeconds" to elapsed,
            "examContinues" to true
        )
    }

    // ── Finish Exam ──────────────────────────────────────────────

    @Transactional
    fun finishExam(userId: UUID, sessionId: UUID): Map<String, Any> {
        return finishExam(userId, sessionId, ExamStatus.COMPLETED)
    }

    @Transactional
    fun finishExam(
        userId: UUID,
        sessionId: UUID,
        status: ExamStatus,
        catDecision: Boolean? = null
    ): Map<String, Any> {
        val session = getSessionForUser(userId, sessionId)
        session.status = status
        session.completedAt = Instant.now()
        session.elapsedSeconds = Duration.between(session.startedAt, Instant.now()).seconds
        session.updatedAt = Instant.now()

        // Calculate pass prediction
        val passPrediction = catDecision ?: calculatePassPrediction(session)
        session.passPrediction = passPrediction
        session.confidenceLevel = calculateConfidence(session)

        examSessionRepository.save(session)

        val results = buildExamResults(session)

        auditLogger.logUserAction(
            eventType = "EXAM_COMPLETED",
            userId = userId,
            metadata = mapOf(
                "sessionId" to sessionId.toString(),
                "status" to status.name,
                "totalQuestions" to session.totalQuestions,
                "correctCount" to session.correctCount,
                "passPrediction" to (passPrediction ?: false),
                "elapsedSeconds" to session.elapsedSeconds
            )
        )

        return results
    }

    // ── Get Exam State ───────────────────────────────────────────

    fun getExamState(userId: UUID, sessionId: UUID): Map<String, Any> {
        val session = getSessionForUser(userId, sessionId)
        val elapsed = Duration.between(session.startedAt, Instant.now()).seconds

        val result = mutableMapOf<String, Any>(
            "sessionId" to session.id,
            "status" to session.status.name,
            "totalQuestions" to session.totalQuestions,
            "correctCount" to session.correctCount,
            "currentDifficulty" to session.currentDifficulty,
            "elapsedSeconds" to elapsed,
            "timeLimitMinutes" to session.timeLimitMinutes,
            "startedAt" to session.startedAt.toString()
        )

        if (session.status == ExamStatus.IN_PROGRESS) {
            result["nextQuestion"] = getNextQuestion(session)
        }
        if (session.status != ExamStatus.IN_PROGRESS) {
            result.putAll(buildExamResults(session))
        }

        return result
    }

    fun getExamHistory(userId: UUID): List<Map<String, Any>> {
        return examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId).map { session ->
            mapOf(
                "sessionId" to session.id,
                "status" to session.status.name,
                "totalQuestions" to session.totalQuestions,
                "correctCount" to session.correctCount,
                "passPrediction" to (session.passPrediction ?: false),
                "confidenceLevel" to (session.confidenceLevel ?: 0.0),
                "startedAt" to session.startedAt.toString(),
                "completedAt" to (session.completedAt?.toString() ?: ""),
                "elapsedSeconds" to session.elapsedSeconds
            )
        }
    }

    // ── Question Generation ──────────────────────────────────────

    fun getNextQuestion(session: ExamSession): Map<String, Any> {
        val topic = selectTopicForQuestion(session)
        val difficulty = session.currentDifficulty
        val questionNumber = session.totalQuestions + 1

        // Generate a question placeholder
        // In production, this would pull from the question bank or Claude
        return mapOf(
            "questionId" to UUID.randomUUID().toString(),
            "questionNumber" to questionNumber,
            "topic" to topic,
            "difficulty" to difficulty,
            "difficultyLabel" to getDifficultyLabel(difficulty),
            "stem" to "Question $questionNumber: [$topic at ${getDifficultyLabel(difficulty)} difficulty]",
            "options" to listOf(
                mapOf("id" to "A", "text" to "Option A"),
                mapOf("id" to "B", "text" to "Option B"),
                mapOf("id" to "C", "text" to "Option C"),
                mapOf("id" to "D", "text" to "Option D")
            ),
            "type" to "MULTIPLE_CHOICE",
            "maxQuestions" to MAX_QUESTIONS,
            "minQuestions" to MIN_QUESTIONS
        )
    }

    // ── CAT Algorithm ────────────────────────────────────────────

    /**
     * Evaluate CAT termination rules:
     * 1. Maximum questions reached (145) → decide based on last difficulty
     * 2. Confidence interval rule: if 95% CI is entirely above or below pass line
     * 3. Minimum questions (75) must be reached before confidence rule applies
     */
    private fun evaluateCATRules(session: ExamSession): Boolean? {
        val totalAnswered = session.totalQuestions

        // Rule 1: Max questions reached
        if (totalAnswered >= MAX_QUESTIONS) {
            val result = session.currentDifficulty >= 0.5
            logger.debug("CAT: max questions reached ({}), difficulty={}, pass={}", totalAnswered, session.currentDifficulty, result)
            return result
        }

        // Rule 2: Minimum not yet reached
        if (totalAnswered < MIN_QUESTIONS) {
            logger.debug("CAT: below minimum ({}/{}), continuing", totalAnswered, MIN_QUESTIONS)
            return null // continue
        }

        // Rule 3: Confidence interval check
        val abilityEstimate = estimateAbility(session)
        val standardError = calculateStandardError(session)
        val lowerBound = abilityEstimate - 1.96 * standardError
        val upperBound = abilityEstimate + 1.96 * standardError

        logger.debug("CAT: q={} ability={} SE={} CI=[{}, {}] passing={}",
            totalAnswered, String.format("%.3f", abilityEstimate), String.format("%.3f", standardError),
            String.format("%.3f", lowerBound), String.format("%.3f", upperBound), PASSING_STANDARD)

        // If entire CI is above passing standard → pass
        if (lowerBound > PASSING_STANDARD) {
            logger.debug("CAT: lower bound {} > passing standard {}, PASS", String.format("%.3f", lowerBound), PASSING_STANDARD)
            return true
        }
        // If entire CI is below passing standard → fail
        if (upperBound < PASSING_STANDARD) {
            logger.debug("CAT: upper bound {} < passing standard {}, FAIL", String.format("%.3f", upperBound), PASSING_STANDARD)
            return false
        }

        logger.debug("CAT: CI straddles passing standard, continuing")
        return null // continue testing
    }

    private fun estimateAbility(session: ExamSession): Double {
        // Simple ability estimate based on proportion correct at given difficulties
        if (session.totalQuestions == 0) return 0.0
        val proportionCorrect = session.correctCount.toDouble() / session.totalQuestions
        // Convert to logit scale
        val p = max(0.01, min(0.99, proportionCorrect))
        return Math.log(p / (1 - p))
    }

    private fun calculateStandardError(session: ExamSession): Double {
        // SE decreases as more questions are answered
        val n = max(1, session.totalQuestions)
        return 1.0 / Math.sqrt(n.toDouble())
    }

    private fun calculatePassPrediction(session: ExamSession): Boolean {
        return estimateAbility(session) > PASSING_STANDARD
    }

    private fun calculateConfidence(session: ExamSession): Double {
        val ability = estimateAbility(session)
        val se = calculateStandardError(session)
        // Distance from pass line in SE units
        val zScore = Math.abs(ability - PASSING_STANDARD) / se
        // Approximate confidence from z-score
        return min(0.99, 0.5 + 0.5 * erf(zScore / Math.sqrt(2.0)))
    }

    // Approximation of the error function
    private fun erf(x: Double): Double {
        val t = 1.0 / (1.0 + 0.3275911 * Math.abs(x))
        val poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
        val result = 1.0 - poly * Math.exp(-x * x)
        return if (x >= 0) result else -result
    }

    // ── Topic Selection (weighted by weakness) ───────────────────

    @Suppress("UNCHECKED_CAST")
    private fun selectTopicForQuestion(session: ExamSession): String {
        val topics = TOPIC_DISTRIBUTION.keys.toList()
        val breakdown = session.topicBreakdown

        // Weight by: base distribution * weakness factor
        val weights = topics.map { topic ->
            val baseWeight = TOPIC_DISTRIBUTION[topic] ?: 0.1
            val topicData = breakdown[topic] as? Map<String, Any>
            val correct = (topicData?.get("correct") as? Number)?.toDouble() ?: 0.0
            val total = (topicData?.get("total") as? Number)?.toDouble() ?: 0.0

            // Weaker topics get higher weight
            val accuracy = if (total > 0) correct / total else 0.5
            val weaknessFactor = 1.0 - accuracy + 0.3 // ensure minimum selection chance
            baseWeight * weaknessFactor
        }

        // Weighted random selection
        val totalWeight = weights.sum()
        var random = Random.nextDouble() * totalWeight
        for (i in topics.indices) {
            random -= weights[i]
            if (random <= 0) return topics[i]
        }
        return topics.last()
    }

    @Suppress("UNCHECKED_CAST")
    private fun updateTopicBreakdown(
        breakdown: Map<String, Any>,
        topic: String,
        isCorrect: Boolean
    ): Map<String, Any> {
        val mutable = breakdown.toMutableMap()
        val topicData = (mutable[topic] as? Map<String, Any>)?.toMutableMap() ?: mutableMapOf()
        val correct = ((topicData["correct"] as? Number)?.toInt() ?: 0) + if (isCorrect) 1 else 0
        val total = ((topicData["total"] as? Number)?.toInt() ?: 0) + 1
        topicData["correct"] = correct
        topicData["total"] = total
        topicData["accuracy"] = if (total > 0) correct.toDouble() / total * 100 else 0.0
        mutable[topic] = topicData
        return mutable
    }

    // ── Answer Evaluation ────────────────────────────────────────

    private fun evaluateAnswer(request: AnswerRequest, difficulty: Double): Boolean {
        // Placeholder: In production, look up the correct answer from question bank
        // For simulation, randomly determine based on a student model
        // Higher difficulty = lower chance of correct answer
        val baseCorrectRate = 0.65 // average nursing student
        val adjustedRate = baseCorrectRate - (difficulty - 0.5) * 0.4
        return Random.nextDouble() < max(0.2, min(0.9, adjustedRate))
    }

    // ── Results Builder ──────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun buildExamResults(session: ExamSession): Map<String, Any> {
        val accuracy = if (session.totalQuestions > 0)
            session.correctCount.toDouble() / session.totalQuestions * 100 else 0.0

        // Time analysis
        val questionTimes = session.questionHistory.mapNotNull {
            (it["timeSpentSeconds"] as? Number)?.toInt()
        }
        val avgTimePerQuestion = if (questionTimes.isNotEmpty()) questionTimes.average() else 0.0

        // Difficulty trend
        val difficulties = session.questionHistory.mapNotNull {
            (it["difficulty"] as? Number)?.toDouble()
        }
        val avgDifficulty = if (difficulties.isNotEmpty()) difficulties.average() else INITIAL_DIFFICULTY
        val finalDifficulty = difficulties.lastOrNull() ?: INITIAL_DIFFICULTY

        return mapOf(
            "sessionId" to session.id,
            "status" to session.status.name,
            "passPrediction" to (session.passPrediction ?: false),
            "confidenceLevel" to (session.confidenceLevel ?: 0.0),
            "totalQuestions" to session.totalQuestions,
            "correctCount" to session.correctCount,
            "accuracy" to accuracy,
            "topicBreakdown" to session.topicBreakdown,
            "elapsedSeconds" to session.elapsedSeconds,
            "timeLimitMinutes" to session.timeLimitMinutes,
            "timeAnalysis" to mapOf(
                "avgTimePerQuestion" to avgTimePerQuestion,
                "totalTimeMinutes" to session.elapsedSeconds / 60.0,
                "remainingMinutes" to max(0, session.timeLimitMinutes * 60L - session.elapsedSeconds) / 60.0
            ),
            "difficultyAnalysis" to mapOf(
                "initial" to INITIAL_DIFFICULTY,
                "average" to avgDifficulty,
                "final" to finalDifficulty,
                "trend" to if (finalDifficulty > avgDifficulty) "increasing" else "decreasing"
            ),
            "startedAt" to session.startedAt.toString(),
            "completedAt" to (session.completedAt?.toString() ?: ""),
            "examContinues" to false
        )
    }

    // ── Helpers ───────────────────────────────────────────────────

    private fun getSessionForUser(userId: UUID, sessionId: UUID): ExamSession {
        val session = examSessionRepository.findById(sessionId)
            .orElseThrow { NotFoundException("Exam session not found: $sessionId") }
        if (session.userId != userId) throw ForbiddenException("Exam session does not belong to user")
        return session
    }

    private fun getDifficultyLabel(difficulty: Double): String = when {
        difficulty >= 0.8 -> "Very Hard"
        difficulty >= 0.6 -> "Hard"
        difficulty >= 0.4 -> "Medium"
        difficulty >= 0.2 -> "Easy"
        else -> "Very Easy"
    }
}
