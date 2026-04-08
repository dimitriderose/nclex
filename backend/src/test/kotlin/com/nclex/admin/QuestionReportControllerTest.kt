package com.nclex.admin

import com.nclex.model.QuestionReport
import com.nclex.repository.QuestionReportRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.security.Principal
import java.util.UUID

class QuestionReportControllerTest {

    private val questionReportRepository: QuestionReportRepository = mockk()
    private val principal: Principal = mockk()

    private lateinit var controller: QuestionReportController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = QuestionReportController(questionReportRepository)
        every { principal.name } returns userId.toString()
    }

    // ── submitReport ───────────────────────────────────────────────

    @Nested
    inner class SubmitReport {

        @Test
        fun `creates report with user ID and returns 200`() {
            every { questionReportRepository.save(any()) } answers { firstArg() }

            val body = SubmitReportRequest(
                questionTopic = "Pharmacology",
                questionData = mapOf("stem" to "Test question"),
                reportReason = "Wrong answer",
                userNotes = "The correct answer should be B"
            )

            val result = controller.submitReport(body, principal)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.userId).isEqualTo(userId)
            assertThat(result.body!!.questionTopic).isEqualTo("Pharmacology")
            assertThat(result.body!!.reportReason).isEqualTo("Wrong answer")
            assertThat(result.body!!.userNotes).isEqualTo("The correct answer should be B")
        }

        @Test
        fun `null userNotes is accepted`() {
            every { questionReportRepository.save(any()) } answers { firstArg() }

            val body = SubmitReportRequest(
                questionTopic = "Cardiology",
                questionData = emptyMap(),
                reportReason = "Ambiguous",
                userNotes = null
            )

            val result = controller.submitReport(body, principal)

            assertThat(result.body!!.userNotes).isNull()
        }
    }

    // ── myReports ──────────────────────────────────────────────────

    @Nested
    inner class MyReports {

        @Test
        fun `returns user reports`() {
            val reports = listOf(
                QuestionReport(userId = userId, questionTopic = "Pharm", reportReason = "Wrong"),
                QuestionReport(userId = userId, questionTopic = "Cardio", reportReason = "Unclear")
            )
            every { questionReportRepository.findByUserId(userId) } returns reports

            val result = controller.myReports(principal)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `empty reports returns empty list`() {
            every { questionReportRepository.findByUserId(userId) } returns emptyList()

            val result = controller.myReports(principal)

            assertThat(result.body).isEmpty()
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `SubmitReportRequest defaults`() {
            val req = SubmitReportRequest("topic", emptyMap(), "reason")
            assertThat(req.userNotes).isNull()
        }
    }
}
