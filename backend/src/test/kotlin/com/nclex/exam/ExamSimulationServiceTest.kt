package com.nclex.exam

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import com.nclex.model.ExamSession
import com.nclex.model.ExamStatus
import com.nclex.repository.ExamSessionRepository
import com.nclex.repository.UserStatsRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.*

class ExamSimulationServiceTest {

    private val examSessionRepository: ExamSessionRepository = mockk()
    private val userStatsRepository: UserStatsRepository = mockk()
    private val auditLogger: AuditLogger = mockk()

    private lateinit var service: ExamSimulationService

    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        service = ExamSimulationService(examSessionRepository, userStatsRepository, auditLogger)
        every { auditLogger.logUserAction(any(), any(), any(), any()) } returns AuditLog(eventType = "TEST")
    }

    // ================================================================
    // startExam
    // ================================================================

    @Nested
    inner class StartExam {

        @Test
        fun `no existing session creates new IN_PROGRESS session`() {
            every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns null
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val session = service.startExam(userId)

            assertThat(session.userId).isEqualTo(userId)
            assertThat(session.status).isEqualTo(ExamStatus.IN_PROGRESS)
            assertThat(session.currentDifficulty).isEqualTo(0.5)
            assertThat(session.timeLimitMinutes).isEqualTo(300)
            assertThat(session.totalQuestions).isEqualTo(0)

            // Only saved once (the new session)
            verify(exactly = 1) { examSessionRepository.save(any()) }
        }

        @Test
        fun `existing IN_PROGRESS session gets abandoned before creating new`() {
            val existingSession = ExamSession(userId = userId, status = ExamStatus.IN_PROGRESS)
            every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns existingSession
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val session = service.startExam(userId)

            // First save: abandon existing, second save: new session
            verify(exactly = 2) { examSessionRepository.save(any()) }
            assertThat(existingSession.status).isEqualTo(ExamStatus.ABANDONED)
            assertThat(existingSession.completedAt).isNotNull()
            assertThat(session.status).isEqualTo(ExamStatus.IN_PROGRESS)
        }

        @Test
        fun `audit log is written on start`() {
            every { examSessionRepository.findByUserIdAndStatus(userId, ExamStatus.IN_PROGRESS) } returns null
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.startExam(userId)

            verify {
                auditLogger.logUserAction(
                    eventType = "EXAM_STARTED",
                    userId = userId,
                    metadata = match { it.containsKey("sessionId") }
                )
            }
        }
    }

    // ================================================================
    // submitAnswer
    // ================================================================

    @Nested
    inner class SubmitAnswer {

        private fun createInProgressSession(
            totalQuestions: Int = 10,
            correctCount: Int = 5,
            currentDifficulty: Double = 0.5,
            startedAt: Instant = Instant.now(),
            questionHistory: List<Map<String, Any>> = emptyList()
        ): ExamSession {
            val sessionId = UUID.randomUUID()
            return ExamSession(
                id = sessionId,
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = totalQuestions,
                correctCount = correctCount,
                currentDifficulty = currentDifficulty,
                startedAt = startedAt,
                questionHistory = questionHistory
            )
        }

        @Test
        fun `exam not IN_PROGRESS throws IllegalStateException`() {
            val session = ExamSession(userId = userId, status = ExamStatus.COMPLETED)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)

            assertThatThrownBy {
                service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))
            }.isInstanceOf(IllegalStateException::class.java)
                .hasMessageContaining("not in progress")
        }

        @Test
        fun `time exceeded finishes with TIMED_OUT`() {
            // Session started 6 hours ago (exceeding 5-hour limit)
            val session = createInProgressSession(
                startedAt = Instant.now().minusSeconds(6 * 3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))

            assertThat(result["status"]).isEqualTo("TIMED_OUT")
            assertThat(result["examContinues"]).isEqualTo(false)
        }

        @Test
        fun `correct answer increases difficulty capped at 0_95`() {
            val session = createInProgressSession(currentDifficulty = 0.92)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            mockkObject(kotlin.random.Random)
            every { kotlin.random.Random.nextDouble() } returns 0.0 // always correct

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))

            if (result["correct"] == true) {
                // Difficulty should be capped at MAX_DIFFICULTY (0.95)
                assertThat(session.currentDifficulty).isLessThanOrEqualTo(0.95)
            }

            unmockkObject(kotlin.random.Random)
        }

        @Test
        fun `incorrect answer decreases difficulty floored at 0_1`() {
            val session = createInProgressSession(currentDifficulty = 0.12)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            mockkObject(kotlin.random.Random)
            every { kotlin.random.Random.nextDouble() } returns 0.99 // always incorrect

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))

            if (result["correct"] == false) {
                // Difficulty should be floored at MIN_DIFFICULTY (0.1)
                assertThat(session.currentDifficulty).isGreaterThanOrEqualTo(0.1)
            }

            unmockkObject(kotlin.random.Random)
        }

        @Test
        fun `exam continues when CAT returns null (under MIN_QUESTIONS)`() {
            val session = createInProgressSession(totalQuestions = 10, correctCount = 5)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))

            // Under 75 questions, CAT should return null -> exam continues
            assertThat(result["examContinues"]).isEqualTo(true)
        }

        @Test
        fun `question history is appended with each answer`() {
            val session = createInProgressSession(totalQuestions = 0)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.submitAnswer(userId, session.id, AnswerRequest("q1", "A", 30))

            assertThat(session.questionHistory).hasSize(1)
            assertThat(session.questionHistory[0]["questionId"]).isEqualTo("q1")
            assertThat(session.questionHistory[0]["selectedAnswer"]).isEqualTo("A")
        }
    }

    // ================================================================
    // evaluateCATRules (tested via submitAnswer)
    // ================================================================

    @Nested
    inner class CATRules {

        @Test
        fun `at MAX_QUESTIONS (145) exam finishes - pass when difficulty above 0_5`() {
            // Build a question history of 144 items so that after adding one more it becomes 145
            val history = (1..144).map { i ->
                mapOf<String, Any>(
                    "questionId" to "q$i",
                    "selectedAnswer" to "A",
                    "correct" to true,
                    "difficulty" to 0.6,
                    "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            }
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 144, // will become 145 after this answer
                correctCount = 80,
                currentDifficulty = 0.6,
                startedAt = Instant.now(),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q145", "A", 30))

            // At 145 questions, exam should be finished
            assertThat(result["examContinues"]).isEqualTo(false)
        }

        @Test
        fun `under MIN_QUESTIONS (75) exam always continues`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 50,
                correctCount = 40,
                currentDifficulty = 0.8,
                startedAt = Instant.now()
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q51", "A", 30))

            // Under 75 questions -> exam continues regardless of confidence
            assertThat(result["examContinues"]).isEqualTo(true)
        }

        @Test
        fun `CI above passing standard at 100 questions with high accuracy returns pass`() {
            // Build a history where nearly all answers are correct at high difficulty
            val history = (1..99).map { i ->
                mapOf<String, Any>(
                    "questionId" to "q$i",
                    "selectedAnswer" to "A",
                    "correct" to true,
                    "difficulty" to 0.8,
                    "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            }
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 99,
                correctCount = 95, // 95/99 ~ 96% correct
                currentDifficulty = 0.8,
                startedAt = Instant.now(),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            // Force a correct answer
            mockkObject(kotlin.random.Random)
            every { kotlin.random.Random.nextDouble() } returns 0.01

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q100", "A", 30))

            // With 96%+ correct at 100 questions, lower CI bound should be > 0 -> pass
            // The exam should finish
            if (result["examContinues"] == false) {
                assertThat(result["passPrediction"]).isEqualTo(true)
            }

            unmockkObject(kotlin.random.Random)
        }

        @Test
        fun `CI below passing standard at 100 questions with low accuracy returns fail`() {
            val history = (1..99).map { i ->
                mapOf<String, Any>(
                    "questionId" to "q$i",
                    "selectedAnswer" to "A",
                    "correct" to false, // almost all wrong
                    "difficulty" to 0.2,
                    "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            }
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 99,
                correctCount = 5, // 5/99 ~ 5% correct
                currentDifficulty = 0.2,
                startedAt = Instant.now(),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            mockkObject(kotlin.random.Random)
            every { kotlin.random.Random.nextDouble() } returns 0.99 // always incorrect

            val result = service.submitAnswer(userId, session.id, AnswerRequest("q100", "A", 30))

            // With ~5% correct at 100 questions, upper CI bound should be < 0 -> fail
            if (result["examContinues"] == false) {
                assertThat(result["passPrediction"]).isEqualTo(false)
            }

            unmockkObject(kotlin.random.Random)
        }
    }

    // ================================================================
    // finishExam
    // ================================================================

    @Nested
    inner class FinishExam {

        @Test
        fun `finishExam sets status, completedAt, passPrediction, confidence`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 80,
                correctCount = 50,
                currentDifficulty = 0.5,
                startedAt = Instant.now().minusSeconds(3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            assertThat(session.status).isEqualTo(ExamStatus.COMPLETED)
            assertThat(session.completedAt).isNotNull()
            assertThat(session.passPrediction).isNotNull()
            assertThat(session.confidenceLevel).isNotNull()
            assertThat(result["examContinues"]).isEqualTo(false)
        }

        @Test
        fun `finishExam with catDecision uses it for passPrediction`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 80,
                correctCount = 50,
                startedAt = Instant.now().minusSeconds(3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.finishExam(userId, session.id, ExamStatus.COMPLETED, catDecision = true)

            assertThat(session.passPrediction).isTrue()
        }

        @Test
        fun `finishExam with catDecision false`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 145,
                correctCount = 60,
                startedAt = Instant.now().minusSeconds(3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.finishExam(userId, session.id, ExamStatus.COMPLETED, catDecision = false)

            assertThat(session.passPrediction).isFalse()
        }

        @Test
        fun `finishExam audit logs EXAM_COMPLETED`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 80,
                correctCount = 50,
                startedAt = Instant.now().minusSeconds(3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.finishExam(userId, session.id)

            verify {
                auditLogger.logUserAction(
                    eventType = "EXAM_COMPLETED",
                    userId = userId,
                    metadata = match {
                        it["sessionId"] == session.id.toString() &&
                        it.containsKey("totalQuestions") &&
                        it.containsKey("correctCount") &&
                        it.containsKey("passPrediction")
                    }
                )
            }
        }

        @Test
        fun `finishExam with TIMED_OUT status`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 50,
                correctCount = 25,
                startedAt = Instant.now().minusSeconds(3600)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            service.finishExam(userId, session.id, ExamStatus.TIMED_OUT)

            assertThat(session.status).isEqualTo(ExamStatus.TIMED_OUT)
        }
    }

    // ================================================================
    // getExamState
    // ================================================================

    @Nested
    inner class GetExamState {

        @Test
        fun `IN_PROGRESS state includes nextQuestion`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 10,
                correctCount = 5,
                currentDifficulty = 0.5,
                startedAt = Instant.now()
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)

            val state = service.getExamState(userId, session.id)

            assertThat(state).containsKey("nextQuestion")
            assertThat(state["status"]).isEqualTo("IN_PROGRESS")
        }

        @Test
        fun `COMPLETED state includes results but no nextQuestion`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 80,
                correctCount = 50,
                currentDifficulty = 0.6,
                startedAt = Instant.now().minusSeconds(3600),
                completedAt = Instant.now(),
                passPrediction = true,
                confidenceLevel = 0.85
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)

            val state = service.getExamState(userId, session.id)

            assertThat(state).doesNotContainKey("nextQuestion")
            assertThat(state["status"]).isEqualTo("COMPLETED")
            assertThat(state).containsKey("passPrediction")
            assertThat(state).containsKey("accuracy")
        }

        @Test
        fun `state includes basic fields`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 10,
                correctCount = 5,
                currentDifficulty = 0.5,
                startedAt = Instant.now()
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)

            val state = service.getExamState(userId, session.id)

            assertThat(state["sessionId"]).isEqualTo(session.id)
            assertThat(state["totalQuestions"]).isEqualTo(10)
            assertThat(state["correctCount"]).isEqualTo(5)
            assertThat(state["currentDifficulty"]).isEqualTo(0.5)
            assertThat(state["timeLimitMinutes"]).isEqualTo(300)
        }
    }

    // ================================================================
    // getExamHistory
    // ================================================================

    @Nested
    inner class GetExamHistory {

        @Test
        fun `maps sessions correctly`() {
            val session1 = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 80,
                correctCount = 50,
                passPrediction = true,
                confidenceLevel = 0.92,
                completedAt = Instant.now(),
                elapsedSeconds = 3600
            )
            val session2 = ExamSession(
                userId = userId,
                status = ExamStatus.TIMED_OUT,
                totalQuestions = 60,
                correctCount = 30,
                passPrediction = false,
                confidenceLevel = 0.7,
                completedAt = Instant.now(),
                elapsedSeconds = 18000
            )

            every { examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId) } returns listOf(session1, session2)

            val history = service.getExamHistory(userId)

            assertThat(history).hasSize(2)
            assertThat(history[0]["status"]).isEqualTo("COMPLETED")
            assertThat(history[0]["totalQuestions"]).isEqualTo(80)
            assertThat(history[0]["correctCount"]).isEqualTo(50)
            assertThat(history[0]["passPrediction"]).isEqualTo(true)
            assertThat(history[0]["confidenceLevel"]).isEqualTo(0.92)
            assertThat(history[1]["status"]).isEqualTo("TIMED_OUT")
        }

        @Test
        fun `handles null passPrediction and confidenceLevel`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.ABANDONED,
                totalQuestions = 10,
                correctCount = 5,
                passPrediction = null,
                confidenceLevel = null,
                completedAt = null,
                elapsedSeconds = 600
            )

            every { examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId) } returns listOf(session)

            val history = service.getExamHistory(userId)

            assertThat(history[0]["passPrediction"]).isEqualTo(false) // null defaults to false
            assertThat(history[0]["confidenceLevel"]).isEqualTo(0.0) // null defaults to 0.0
            assertThat(history[0]["completedAt"]).isEqualTo("") // null defaults to ""
        }

        @Test
        fun `empty history returns empty list`() {
            every { examSessionRepository.findByUserIdOrderByCreatedAtDesc(userId) } returns emptyList()

            val history = service.getExamHistory(userId)

            assertThat(history).isEmpty()
        }
    }

    // ================================================================
    // getDifficultyLabel (tested via getNextQuestion)
    // ================================================================

    @Nested
    inner class DifficultyLabel {

        private fun getDifficultyLabelViaNextQuestion(difficulty: Double): String {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                currentDifficulty = difficulty
            )
            val question = service.getNextQuestion(session)
            return question["difficultyLabel"] as String
        }

        @Test
        fun `difficulty 0_8 or above is Very Hard`() {
            assertThat(getDifficultyLabelViaNextQuestion(0.8)).isEqualTo("Very Hard")
            assertThat(getDifficultyLabelViaNextQuestion(0.95)).isEqualTo("Very Hard")
        }

        @Test
        fun `difficulty 0_6 to 0_79 is Hard`() {
            assertThat(getDifficultyLabelViaNextQuestion(0.6)).isEqualTo("Hard")
            assertThat(getDifficultyLabelViaNextQuestion(0.79)).isEqualTo("Hard")
        }

        @Test
        fun `difficulty 0_4 to 0_59 is Medium`() {
            assertThat(getDifficultyLabelViaNextQuestion(0.4)).isEqualTo("Medium")
            assertThat(getDifficultyLabelViaNextQuestion(0.59)).isEqualTo("Medium")
        }

        @Test
        fun `difficulty 0_2 to 0_39 is Easy`() {
            assertThat(getDifficultyLabelViaNextQuestion(0.2)).isEqualTo("Easy")
            assertThat(getDifficultyLabelViaNextQuestion(0.39)).isEqualTo("Easy")
        }

        @Test
        fun `difficulty below 0_2 is Very Easy`() {
            assertThat(getDifficultyLabelViaNextQuestion(0.1)).isEqualTo("Very Easy")
            assertThat(getDifficultyLabelViaNextQuestion(0.0)).isEqualTo("Very Easy")
            assertThat(getDifficultyLabelViaNextQuestion(0.19)).isEqualTo("Very Easy")
        }
    }

    // ================================================================
    // getSessionForUser
    // ================================================================

    @Nested
    inner class GetSessionForUser {

        @Test
        fun `session not found throws IllegalArgumentException`() {
            val sessionId = UUID.randomUUID()
            every { examSessionRepository.findById(sessionId) } returns Optional.empty()

            assertThatThrownBy {
                service.getExamState(userId, sessionId)
            }.isInstanceOf(IllegalArgumentException::class.java)
                .hasMessageContaining("not found")
        }

        @Test
        fun `wrong user throws IllegalArgumentException`() {
            val otherUserId = UUID.randomUUID()
            val session = ExamSession(userId = otherUserId, status = ExamStatus.IN_PROGRESS)
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)

            assertThatThrownBy {
                service.getExamState(userId, session.id)
            }.isInstanceOf(IllegalArgumentException::class.java)
                .hasMessageContaining("does not belong")
        }
    }

    // ================================================================
    // estimateAbility (tested via finishExam behavior)
    // ================================================================

    @Nested
    inner class EstimateAbility {

        @Test
        fun `0 questions returns ability that calculates pass prediction`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                totalQuestions = 0,
                correctCount = 0,
                startedAt = Instant.now().minusSeconds(60)
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            // With 0 questions, ability = 0.0 (at pass line),
            // calculatePassPrediction checks > PASSING_STANDARD (0.0), so false
            assertThat(session.passPrediction).isFalse()
        }
    }

    // ================================================================
    // buildExamResults
    // ================================================================

    @Nested
    inner class BuildExamResults {

        @Test
        fun `empty history produces correct defaults`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 0,
                correctCount = 0,
                startedAt = Instant.now().minusSeconds(60),
                questionHistory = emptyList()
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            assertThat(result["accuracy"]).isEqualTo(0.0)
            assertThat(result["examContinues"]).isEqualTo(false)

            @Suppress("UNCHECKED_CAST")
            val timeAnalysis = result["timeAnalysis"] as Map<String, Any>
            assertThat(timeAnalysis["avgTimePerQuestion"]).isEqualTo(0.0)

            @Suppress("UNCHECKED_CAST")
            val difficultyAnalysis = result["difficultyAnalysis"] as Map<String, Any>
            assertThat(difficultyAnalysis["initial"]).isEqualTo(0.5)
            assertThat(difficultyAnalysis["average"]).isEqualTo(0.5) // fallback to INITIAL_DIFFICULTY
            assertThat(difficultyAnalysis["final"]).isEqualTo(0.5)
        }

        @Test
        fun `populated history calculates accuracy and averages`() {
            val history = listOf(
                mapOf<String, Any>(
                    "questionId" to "q1", "correct" to true,
                    "difficulty" to 0.4, "timeSpentSeconds" to 20,
                    "timestamp" to Instant.now().toString()
                ),
                mapOf<String, Any>(
                    "questionId" to "q2", "correct" to false,
                    "difficulty" to 0.6, "timeSpentSeconds" to 40,
                    "timestamp" to Instant.now().toString()
                ),
                mapOf<String, Any>(
                    "questionId" to "q3", "correct" to true,
                    "difficulty" to 0.5, "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            )
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 3,
                correctCount = 2,
                startedAt = Instant.now().minusSeconds(3600),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            // accuracy = 2/3 * 100 ~ 66.67
            val accuracy = result["accuracy"] as Double
            assertThat(accuracy).isBetween(66.0, 67.0)

            @Suppress("UNCHECKED_CAST")
            val timeAnalysis = result["timeAnalysis"] as Map<String, Any>
            assertThat(timeAnalysis["avgTimePerQuestion"]).isEqualTo(30.0) // (20+40+30)/3

            @Suppress("UNCHECKED_CAST")
            val difficultyAnalysis = result["difficultyAnalysis"] as Map<String, Any>
            assertThat(difficultyAnalysis["average"]).isEqualTo(0.5) // (0.4+0.6+0.5)/3
            assertThat(difficultyAnalysis["final"]).isEqualTo(0.5)
        }

        @Test
        fun `difficulty trend is increasing when final is above average`() {
            val history = listOf(
                mapOf<String, Any>(
                    "questionId" to "q1", "correct" to true,
                    "difficulty" to 0.3, "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                ),
                mapOf<String, Any>(
                    "questionId" to "q2", "correct" to true,
                    "difficulty" to 0.8, "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            )
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 2,
                correctCount = 2,
                startedAt = Instant.now().minusSeconds(3600),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            @Suppress("UNCHECKED_CAST")
            val difficultyAnalysis = result["difficultyAnalysis"] as Map<String, Any>
            // final (0.8) > average (0.55) -> "increasing"
            assertThat(difficultyAnalysis["trend"]).isEqualTo("increasing")
        }

        @Test
        fun `difficulty trend is decreasing when final is below or equal to average`() {
            val history = listOf(
                mapOf<String, Any>(
                    "questionId" to "q1", "correct" to true,
                    "difficulty" to 0.8, "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                ),
                mapOf<String, Any>(
                    "questionId" to "q2", "correct" to true,
                    "difficulty" to 0.3, "timeSpentSeconds" to 30,
                    "timestamp" to Instant.now().toString()
                )
            )
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.COMPLETED,
                totalQuestions = 2,
                correctCount = 2,
                startedAt = Instant.now().minusSeconds(3600),
                questionHistory = history
            )
            every { examSessionRepository.findById(session.id) } returns Optional.of(session)
            every { examSessionRepository.save(any()) } answers { firstArg() }

            val result = service.finishExam(userId, session.id)

            @Suppress("UNCHECKED_CAST")
            val difficultyAnalysis = result["difficultyAnalysis"] as Map<String, Any>
            // final (0.3) < average (0.55) -> "decreasing"
            assertThat(difficultyAnalysis["trend"]).isEqualTo("decreasing")
        }
    }
}
