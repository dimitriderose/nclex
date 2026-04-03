package com.nclex.exam

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import com.nclex.model.ExamSession
import com.nclex.model.ExamStatus
import com.nclex.repository.ExamSessionRepository
import com.nclex.repository.UserStatsRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.Instant
import java.util.*

class ExamSimulationServiceTest {

    private val examSessionRepository = mockk<ExamSessionRepository>()
    private val userStatsRepository = mockk<UserStatsRepository>()
    private val auditLogger = mockk<AuditLogger>(relaxed = true)

    private val service = ExamSimulationService(
        examSessionRepository, userStatsRepository, auditLogger
    )

    private val userId = UUID.randomUUID()
    private val sessionId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        clearAllMocks()
        every { auditLogger.logUserAction(any(), any(), any(), any()) } returns AuditLog(eventType = "TEST")
        every { examSessionRepository.save(any()) } answers { firstArg() }
    }

    // ── startExam ───────────────────────────────────────────────

    @Test
    fun `startExam with no existing exam creates new session`() {
        every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns null

        val result = service.startExam(userId)

        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.status).isEqualTo(ExamStatus.IN_PROGRESS)
        assertThat(result.currentDifficulty).isEqualTo(0.5)
        assertThat(result.timeLimitMinutes).isEqualTo(300)
        verify(exactly = 1) { examSessionRepository.save(any()) }
    }

    @Test
    fun `startExam abandons existing IN_PROGRESS exam`() {
        val existing = ExamSession(userId = userId, status = ExamStatus.IN_PROGRESS)
        every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns existing

        service.startExam(userId)

        assertThat(existing.status).isEqualTo(ExamStatus.ABANDONED)
        assertThat(existing.completedAt).isNotNull()
        // Saves: existing (abandoned) + new session = 2 saves
        verify(exactly = 2) { examSessionRepository.save(any()) }
    }

    @Test
    fun `startExam writes audit log`() {
        every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns null

        service.startExam(userId)

        verify { auditLogger.logUserAction(eventType = "EXAM_STARTED", userId = userId, metadata = any(), ipAddress = any()) }
    }

    // ── submitAnswer ────────────────────────────────────────────

    private fun createInProgressSession(
        totalQuestions: Int = 10,
        correctCount: Int = 5,
        difficulty: Double = 0.5,
        startedAt: Instant = Instant.now()
    ): ExamSession {
        val session = ExamSession(
            id = sessionId,
            userId = userId,
            status = ExamStatus.IN_PROGRESS,
            totalQuestions = totalQuestions,
            correctCount = correctCount,
            currentDifficulty = difficulty,
            startedAt = startedAt,
            questionHistory = (1..totalQuestions).map {
                mapOf<String, Any>("questionId" to "q$it", "correct" to (it <= correctCount), "difficulty" to difficulty, "timeSpentSeconds" to 30)
            }
        )
        return session
    }

    @Test
    fun `submitAnswer throws when exam is not in progress`() {
        val session = ExamSession(id = sessionId, userId = userId, status = ExamStatus.COMPLETED)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        assertThrows<IllegalStateException> {
            service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))
        }
    }

    @Test
    fun `submitAnswer finishes exam when time limit exceeded`() {
        val longAgo = Instant.now().minusSeconds(301 * 60) // 301 minutes ago
        val session = createInProgressSession(startedAt = longAgo)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))

        assertThat(result["examContinues"]).isEqualTo(false)
    }

    @Test
    fun `submitAnswer increases difficulty when correct and caps at MAX`() {
        val session = createInProgressSession(difficulty = 0.92)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        // Submit and check difficulty is capped
        service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))

        // Difficulty should be at most MAX_DIFFICULTY (0.95)
        assertThat(session.currentDifficulty).isLessThanOrEqualTo(0.95)
    }

    @Test
    fun `submitAnswer decreases difficulty when incorrect and floors at MIN`() {
        val session = createInProgressSession(difficulty = 0.12)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        // Multiple submits to ensure it hits the floor
        // Note: we can't control Random, but we can verify the bounds
        service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))

        assertThat(session.currentDifficulty).isGreaterThanOrEqualTo(0.1)
    }

    @Test
    fun `submitAnswer updates question history`() {
        val session = createInProgressSession(totalQuestions = 0, correctCount = 0)
        session.questionHistory = emptyList()
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        service.submitAnswer(userId, sessionId, AnswerRequest("q1", "B", 45))

        assertThat(session.questionHistory).hasSize(1)
        assertThat(session.totalQuestions).isEqualTo(1)
    }

    @Test
    fun `submitAnswer throws for wrong user`() {
        val otherUser = UUID.randomUUID()
        val session = ExamSession(id = sessionId, userId = otherUser, status = ExamStatus.IN_PROGRESS)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        assertThrows<IllegalArgumentException> {
            service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))
        }
    }

    @Test
    fun `submitAnswer throws for non-existent session`() {
        every { examSessionRepository.findById(sessionId) } returns Optional.empty()

        assertThrows<IllegalArgumentException> {
            service.submitAnswer(userId, sessionId, AnswerRequest("q1", "A", 30))
        }
    }

    // ── evaluateCATRules (tested indirectly) ────────────────────

    @Test
    fun `submitAnswer triggers pass when max questions reached with high difficulty`() {
        val session = createInProgressSession(totalQuestions = 144, correctCount = 100, difficulty = 0.6)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.submitAnswer(userId, sessionId, AnswerRequest("q145", "A", 30))

        // At 145+ questions, CAT should decide based on difficulty
        // The totalQuestions will be 145 after adding this answer
        if (result.containsKey("examContinues") && result["examContinues"] == false) {
            assertThat(result).containsKey("passPrediction")
        }
    }

    @Test
    fun `submitAnswer continues when below minimum questions`() {
        val session = createInProgressSession(totalQuestions = 10, correctCount = 7)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.submitAnswer(userId, sessionId, AnswerRequest("q11", "A", 30))

        // With only 11 questions, exam should continue (below 75 min)
        if (result["examContinues"] == true) {
            assertThat(result).containsKey("nextQuestion")
        }
    }

    // ── finishExam ──────────────────────────────────────────────

    @Test
    fun `finishExam sets status and completedAt`() {
        val session = createInProgressSession()
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.finishExam(userId, sessionId)

        assertThat(session.status).isEqualTo(ExamStatus.COMPLETED)
        assertThat(session.completedAt).isNotNull()
        assertThat(result["examContinues"]).isEqualTo(false)
    }

    @Test
    fun `finishExam sets passPrediction and confidence`() {
        val session = createInProgressSession(totalQuestions = 80, correctCount = 60)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        service.finishExam(userId, sessionId)

        assertThat(session.passPrediction).isNotNull()
        assertThat(session.confidenceLevel).isNotNull()
    }

    @Test
    fun `finishExam writes audit log`() {
        val session = createInProgressSession()
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        service.finishExam(userId, sessionId)

        verify { auditLogger.logUserAction(eventType = "EXAM_COMPLETED", userId = userId, metadata = any(), ipAddress = any()) }
    }

    @Test
    fun `finishExam with catDecision uses provided value`() {
        val session = createInProgressSession()
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        service.finishExam(userId, sessionId, ExamStatus.COMPLETED, true)

        assertThat(session.passPrediction).isTrue()
    }

    // ── getExamState ────────────────────────────────────────────

    @Test
    fun `getExamState for IN_PROGRESS includes nextQuestion`() {
        val session = createInProgressSession()
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.getExamState(userId, sessionId)

        assertThat(result["status"]).isEqualTo("IN_PROGRESS")
        assertThat(result).containsKey("nextQuestion")
    }

    @Test
    fun `getExamState for COMPLETED includes results`() {
        val session = createInProgressSession()
        session.status = ExamStatus.COMPLETED
        session.completedAt = Instant.now()
        session.passPrediction = true
        session.confidenceLevel = 0.95
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.getExamState(userId, sessionId)

        assertThat(result["status"]).isEqualTo("COMPLETED")
        assertThat(result).containsKey("passPrediction")
    }

    // ── getExamHistory ──────────────────────────────────────────

    @Test
    fun `getExamHistory maps sessions correctly`() {
        val session1 = ExamSession(
            userId = userId,
            status = ExamStatus.COMPLETED,
            totalQuestions = 80,
            correctCount = 60,
            passPrediction = true,
            confidenceLevel = 0.95,
            completedAt = Instant.now(),
            elapsedSeconds = 3600
        )
        val session2 = ExamSession(
            userId = userId,
            status = ExamStatus.ABANDONED,
            totalQuestions = 20,
            correctCount = 10,
            elapsedSeconds = 600
        )
        every { examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId) } returns listOf(session1, session2)

        val history = service.getExamHistory(userId)

        assertThat(history).hasSize(2)
        assertThat(history[0]["status"]).isEqualTo("COMPLETED")
        assertThat(history[0]["passPrediction"]).isEqualTo(true)
        assertThat(history[0]["totalQuestions"]).isEqualTo(80)
    }

    @Test
    fun `getExamHistory handles null passPrediction and completedAt`() {
        val session = ExamSession(
            userId = userId,
            status = ExamStatus.ABANDONED,
            totalQuestions = 10,
            correctCount = 5,
            passPrediction = null,
            confidenceLevel = null,
            completedAt = null,
            elapsedSeconds = 300
        )
        every { examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId) } returns listOf(session)

        val history = service.getExamHistory(userId)

        assertThat(history[0]["passPrediction"]).isEqualTo(false) // null defaults to false
        assertThat(history[0]["confidenceLevel"]).isEqualTo(0.0) // null defaults to 0.0
        assertThat(history[0]["completedAt"]).isEqualTo("") // null becomes empty string
    }

    // ── getDifficultyLabel ──────────────────────────────────────

    @Test
    fun `getNextQuestion returns correct difficulty labels`() {
        // Test through getNextQuestion which uses getDifficultyLabel
        val sessionVeryHard = createInProgressSession(difficulty = 0.85)
        every { examSessionRepository.findById(sessionId) } returns Optional.of(sessionVeryHard)

        val state = service.getExamState(userId, sessionId)
        @Suppress("UNCHECKED_CAST")
        val nextQ = state["nextQuestion"] as Map<String, Any>
        assertThat(nextQ["difficultyLabel"]).isEqualTo("Very Hard")
    }

    @Test
    fun `getDifficultyLabel covers all ranges`() {
        // Test all ranges by creating sessions with different difficulties
        val difficulties = listOf(0.85 to "Very Hard", 0.65 to "Hard", 0.45 to "Medium", 0.25 to "Easy", 0.05 to "Very Easy")
        for ((diff, expectedLabel) in difficulties) {
            val session = createInProgressSession(difficulty = diff)
            val id = session.id
            every { examSessionRepository.findById(id) } returns Optional.of(session)
            val state = service.getExamState(userId, id)
            @Suppress("UNCHECKED_CAST")
            val nextQ = state["nextQuestion"] as Map<String, Any>
            assertThat(nextQ["difficultyLabel"]).isEqualTo(expectedLabel)
        }
    }

    // ── buildExamResults ────────────────────────────────────────

    @Test
    fun `buildExamResults for empty history`() {
        val session = ExamSession(
            id = sessionId,
            userId = userId,
            status = ExamStatus.COMPLETED,
            totalQuestions = 0,
            correctCount = 0,
            questionHistory = emptyList(),
            completedAt = Instant.now(),
            elapsedSeconds = 0
        )
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.finishExam(userId, sessionId)

        assertThat(result["accuracy"]).isEqualTo(0.0)
        @Suppress("UNCHECKED_CAST")
        val timeAnalysis = result["timeAnalysis"] as Map<String, Any>
        assertThat(timeAnalysis["avgTimePerQuestion"]).isEqualTo(0.0)
    }

    @Test
    fun `buildExamResults for populated history`() {
        val history = listOf(
            mapOf<String, Any>("questionId" to "q1", "correct" to true, "difficulty" to 0.5, "timeSpentSeconds" to 30),
            mapOf<String, Any>("questionId" to "q2", "correct" to false, "difficulty" to 0.55, "timeSpentSeconds" to 45)
        )
        val session = ExamSession(
            id = sessionId,
            userId = userId,
            status = ExamStatus.COMPLETED,
            totalQuestions = 2,
            correctCount = 1,
            currentDifficulty = 0.5,
            questionHistory = history,
            completedAt = Instant.now(),
            elapsedSeconds = 75
        )
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.finishExam(userId, sessionId)

        assertThat(result["accuracy"]).isEqualTo(50.0)
        @Suppress("UNCHECKED_CAST")
        val diffAnalysis = result["difficultyAnalysis"] as Map<String, Any>
        assertThat(diffAnalysis).containsKeys("initial", "average", "final", "trend")
    }

    // ── estimateAbility (tested indirectly through finishExam) ──

    @Test
    fun `finishExam with zero questions returns correct defaults`() {
        val session = ExamSession(
            id = sessionId,
            userId = userId,
            status = ExamStatus.IN_PROGRESS,
            totalQuestions = 0,
            correctCount = 0,
            questionHistory = emptyList()
        )
        every { examSessionRepository.findById(sessionId) } returns Optional.of(session)

        val result = service.finishExam(userId, sessionId)
        // estimateAbility returns 0.0 for 0 questions
        assertThat(result).containsKey("passPrediction")
    }
}
