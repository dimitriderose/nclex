package com.nclex.exam

import com.nclex.model.ExamSession
import com.nclex.model.ExamStatus
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID

class ExamSimulationControllerTest {

    private val examSimulationService: ExamSimulationService = mockk()
    private lateinit var controller: ExamSimulationController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = ExamSimulationController(examSimulationService)
    }

    // ── startExam ──────────────────────────────────────────────────

    @Nested
    inner class StartExam {

        @Test
        fun `returns session data with next question`() {
            val session = ExamSession(
                userId = userId,
                status = ExamStatus.IN_PROGRESS,
                currentDifficulty = 0.5,
                timeLimitMinutes = 300
            )
            val nextQuestion = mapOf<String, Any>("questionId" to "q1", "topic" to "test")

            every { examSimulationService.startExam(userId) } returns session
            every { examSimulationService.getNextQuestion(session) } returns nextQuestion

            val result = controller.startExam(userId)

            assertThat(result.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["sessionId"]).isEqualTo(session.id)
            assertThat(body["status"]).isEqualTo("IN_PROGRESS")
            assertThat(body["timeLimitMinutes"]).isEqualTo(300)
            assertThat(body["currentQuestion"]).isEqualTo(nextQuestion)
            assertThat(body["totalQuestions"]).isEqualTo(0)
            assertThat(body["currentDifficulty"]).isEqualTo(0.5)
        }
    }

    // ── submitAnswer ───────────────────────────────────────────────

    @Nested
    inner class SubmitAnswer {

        @Test
        fun `returns answer result`() {
            val sessionId = UUID.randomUUID()
            val answerResult = mapOf<String, Any>("correct" to true, "examContinues" to true)
            val request = AnswerRequest("q1", "A", 30)

            every { examSimulationService.submitAnswer(userId, sessionId, request) } returns answerResult

            val result = controller.submitAnswer(userId, sessionId, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["correct"]).isEqualTo(true)
            assertThat(body["examContinues"]).isEqualTo(true)
        }
    }

    // ── finishExam ─────────────────────────────────────────────────

    @Nested
    inner class FinishExam {

        @Test
        fun `returns exam results`() {
            val sessionId = UUID.randomUUID()
            val results = mapOf<String, Any>("status" to "COMPLETED", "passPrediction" to true, "examContinues" to false)

            every { examSimulationService.finishExam(userId, sessionId) } returns results

            val result = controller.finishExam(userId, sessionId)

            assertThat(result.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["examContinues"]).isEqualTo(false)
        }
    }

    // ── getExamState ───────────────────────────────────────────────

    @Nested
    inner class GetExamState {

        @Test
        fun `returns current state`() {
            val sessionId = UUID.randomUUID()
            val state = mapOf<String, Any>("status" to "IN_PROGRESS", "totalQuestions" to 50)

            every { examSimulationService.getExamState(userId, sessionId) } returns state

            val result = controller.getExamState(userId, sessionId)

            assertThat(result.statusCode.value()).isEqualTo(200)
        }
    }

    // ── getExamHistory ─────────────────────────────────────────────

    @Nested
    inner class GetExamHistory {

        @Test
        fun `returns history list`() {
            val sessions = listOf(
                mapOf<String, Any>("sessionId" to UUID.randomUUID(), "status" to "COMPLETED")
            )
            every { examSimulationService.getExamHistory(userId) } returns sessions

            val result = controller.getExamHistory(userId)

            assertThat(result.statusCode.value()).isEqualTo(200)
        }
    }

    // ── AnswerRequest DTO ──────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `AnswerRequest defaults`() {
            val req = AnswerRequest("q1", "A")
            assertThat(req.timeSpentSeconds).isEqualTo(0)
        }

        @Test
        fun `AnswerRequest with time`() {
            val req = AnswerRequest("q1", "B", 45)
            assertThat(req.timeSpentSeconds).isEqualTo(45)
        }
    }
}
