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
        fun `returns answer result with next question merged in when exam continues`() {
            // Two-step orchestration (Architect "Transaction boundaries" finding — see
            // ExamSimulationService.submitAnswer's doc): the controller calls submitAnswer
            // (grades + persists, no `nextQuestion` in its "continues" response) and then
            // separately calls getNextQuestionForSession *after* that transaction has
            // committed — specifically so a cold-bank Claude call never runs while a
            // grading transaction holds a DB connection. Was: a single submitAnswer stub
            // returning `nextQuestion` directly, which the controller no longer relies on.
            val sessionId = UUID.randomUUID()
            val answerResult = mapOf<String, Any>("correct" to true, "examContinues" to true)
            val nextQuestion = mapOf<String, Any>("questionId" to "q2", "stem" to "Next stem")
            val request = AnswerRequest("q1", "A", 30)

            every { examSimulationService.submitAnswer(userId, sessionId, request) } returns answerResult
            every { examSimulationService.getNextQuestionForSession(userId, sessionId) } returns nextQuestion

            val result = controller.submitAnswer(userId, sessionId, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["correct"]).isEqualTo(true)
            assertThat(body["examContinues"]).isEqualTo(true)
            assertThat(body["nextQuestion"]).isEqualTo(nextQuestion)
        }

        @Test
        fun `does not fetch next question when exam has ended`() {
            // examContinues = false (e.g. timeout/CAT termination/finish) — the controller
            // must not call getNextQuestionForSession at all (no question to serve, and no
            // reason to risk a cold-bank Claude call on a session that's already over).
            val sessionId = UUID.randomUUID()
            val finishResult = mapOf<String, Any>(
                "status" to "COMPLETED",
                "examContinues" to false,
                "passPrediction" to true
            )
            val request = AnswerRequest("q1", "A", 30)

            every { examSimulationService.submitAnswer(userId, sessionId, request) } returns finishResult

            val result = controller.submitAnswer(userId, sessionId, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["examContinues"]).isEqualTo(false)
            assertThat(body).doesNotContainKey("nextQuestion")
            verify(exactly = 0) { examSimulationService.getNextQuestionForSession(any(), any()) }
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

        @Test
        fun `surfaces questionReview from service results untouched`() {
            // The controller is a thin pass-through over examSimulationService.finishExam's
            // results map (which buildExamResults populates with a `questionReview` key —
            // see ExamSimulationService.buildExamResults / buildQuestionReview). Confirm the
            // controller doesn't drop or transform it on the way to the HTTP response.
            val sessionId = UUID.randomUUID()
            val questionReview = listOf(
                mapOf<String, Any>(
                    "questionId" to UUID.randomUUID().toString(),
                    "correct" to true,
                    "stem" to "A client is prescribed...",
                    "options" to listOf(mapOf("id" to "a", "text" to "Option text")),
                    "selectedAnswer" to "a",
                    "correctAnswer" to mapOf("correctOptionIds" to listOf("a")),
                    "rationale" to "Because...",
                    "topic" to "Pharmacological and Parenteral Therapies",
                    "ncjmmStep" to "take_action"
                )
            )
            val results = mapOf<String, Any>(
                "status" to "COMPLETED",
                "passPrediction" to true,
                "examContinues" to false,
                "questionReview" to questionReview
            )

            every { examSimulationService.finishExam(userId, sessionId) } returns results

            val result = controller.finishExam(userId, sessionId)

            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["questionReview"]).isEqualTo(questionReview)
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

        @Test
        fun `surfaces questionReview when exam has ended`() {
            // For a non-IN_PROGRESS session, getExamState merges in buildExamResults' map
            // (which includes `questionReview`) — confirm the controller passes it through
            // verbatim rather than stripping/reshaping it.
            val sessionId = UUID.randomUUID()
            val questionReview = listOf(
                mapOf<String, Any>("questionId" to "", "correct" to false, "stem" to "")
            )
            val state = mapOf<String, Any>(
                "status" to "COMPLETED",
                "totalQuestions" to 80,
                "questionReview" to questionReview
            )

            every { examSimulationService.getExamState(userId, sessionId) } returns state

            val result = controller.getExamState(userId, sessionId)

            @Suppress("UNCHECKED_CAST")
            val body = result.body as Map<String, Any>
            assertThat(body["questionReview"]).isEqualTo(questionReview)
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
