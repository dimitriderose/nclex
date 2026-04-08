package com.nclex.ngn

import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.UUID

class NGNCaseStudyControllerTest {

    private val service: NGNCaseStudyService = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: NGNCaseStudyController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = NGNCaseStudyController(service)
    }

    private fun createCaseStudy() = CaseStudyResponse(
        id = "cs-1",
        title = "Test Case",
        scenario = "Patient scenario",
        tabs = listOf(CaseTabDTO("1", "Notes", "Data", "nurses_notes")),
        questions = listOf(
            CaseQuestionDTO("q1", "bow_tie", "Complete diagram", emptyMap(), null, "Rationale", "analyze_cues", 5)
        ),
        topic = "topic",
        source = "Generated",
        safetyValidated = true,
        createdAt = "2024-01-01"
    )

    // ── generateCaseStudy ──────────────────────────────────────────

    @Nested
    inner class GenerateCaseStudy {

        @Test
        fun `missing userId throws IllegalStateException`() {
            every { httpRequest.getAttribute("userId") } returns null

            val body = GenerateCaseRequest(topic = "heart failure")
            assertThatThrownBy { controller.generateCaseStudy(body, httpRequest) }
                .isInstanceOf(IllegalStateException::class.java)
                .hasMessageContaining("Missing userId")
        }

        @Test
        fun `successful generation returns 200`() {
            every { httpRequest.getAttribute("userId") } returns userId
            val caseStudy = createCaseStudy()
            every {
                service.generateCaseStudy("heart failure", listOf("bow_tie", "matrix_multiple_choice"), "medium", userId.toString())
            } returns caseStudy

            val body = GenerateCaseRequest(topic = "heart failure")
            val result = controller.generateCaseStudy(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.title).isEqualTo("Test Case")
        }

        @Test
        fun `custom questionTypes and difficulty passed to service`() {
            every { httpRequest.getAttribute("userId") } returns userId
            val caseStudy = createCaseStudy()
            every {
                service.generateCaseStudy("dka", listOf("trend"), "hard", userId.toString())
            } returns caseStudy

            val body = GenerateCaseRequest(topic = "dka", questionTypes = listOf("trend"), difficulty = "hard")
            controller.generateCaseStudy(body, httpRequest)

            verify { service.generateCaseStudy("dka", listOf("trend"), "hard", userId.toString()) }
        }

        @Test
        fun `null questionTypes defaults to bow_tie and matrix_multiple_choice`() {
            every { httpRequest.getAttribute("userId") } returns userId
            val caseStudy = createCaseStudy()
            every {
                service.generateCaseStudy(any(), eq(listOf("bow_tie", "matrix_multiple_choice")), any(), any())
            } returns caseStudy

            val body = GenerateCaseRequest(topic = "topic", questionTypes = null)
            controller.generateCaseStudy(body, httpRequest)

            verify { service.generateCaseStudy(any(), eq(listOf("bow_tie", "matrix_multiple_choice")), any(), any()) }
        }

        @Test
        fun `null difficulty defaults to medium`() {
            every { httpRequest.getAttribute("userId") } returns userId
            val caseStudy = createCaseStudy()
            every {
                service.generateCaseStudy(any(), any(), eq("medium"), any())
            } returns caseStudy

            val body = GenerateCaseRequest(topic = "topic", difficulty = null)
            controller.generateCaseStudy(body, httpRequest)

            verify { service.generateCaseStudy(any(), any(), eq("medium"), any()) }
        }
    }

    // ── validateCaseStudy ──────────────────────────────────────────

    @Nested
    inner class ValidateCaseStudy {

        @Test
        fun `returns safety validation result`() {
            val caseStudy = createCaseStudy()
            val safetyResult = SafetyValidationResult(true, emptyList(), 0.95, "Safe")
            every { service.safetyValidate(caseStudy) } returns safetyResult

            val body = ValidateCaseRequest(caseStudy)
            val result = controller.validateCaseStudy(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.safe).isTrue()
        }
    }

    // ── getTemplates ───────────────────────────────────────────────

    @Nested
    inner class GetTemplates {

        @Test
        fun `returns template list`() {
            val templates = listOf(
                CaseTemplateInfo("hf-1", "Heart Failure", "heart failure", listOf("bow_tie"))
            )
            every { service.getAvailableTemplates() } returns templates

            val result = controller.getTemplates()

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
        }
    }

    // ── getQuestionTypes ───────────────────────────────────────────

    @Nested
    inner class GetQuestionTypes {

        @Test
        fun `returns NGN question types`() {
            val result = controller.getQuestionTypes()

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).isEqualTo(NGN_QUESTION_TYPES)
            assertThat(result.body).isNotEmpty
        }
    }

    // ── generateCaseStudy userId edge case ─────────────────────────

    @Nested
    inner class GenerateCaseStudyUserIdEdge {

        @Test
        fun `userId toString returns string for non-null attribute`() {
            // Cover the safe-call branch where getAttribute returns a non-null, non-string value
            every { httpRequest.getAttribute("userId") } returns 12345
            val caseStudy = createCaseStudy()
            every {
                service.generateCaseStudy("topic", listOf("bow_tie", "matrix_multiple_choice"), "medium", "12345")
            } returns caseStudy

            val body = GenerateCaseRequest(topic = "topic")
            val result = controller.generateCaseStudy(body, httpRequest)
            assertThat(result.statusCode.value()).isEqualTo(200)
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `GenerateCaseRequest defaults`() {
            val req = GenerateCaseRequest(topic = "t")
            assertThat(req.questionTypes).isNull()
            assertThat(req.difficulty).isEqualTo("medium")
        }

        @Test
        fun `CaseTabDTO fields`() {
            val tab = CaseTabDTO("1", "Label", "Content", "nurses_notes")
            assertThat(tab.type).isEqualTo("nurses_notes")
        }

        @Test
        fun `CaseQuestionDTO fields`() {
            val q = CaseQuestionDTO("1", "bow_tie", "prompt", emptyMap(), null, "rationale", "analyze_cues", 5)
            assertThat(q.maxScore).isEqualTo(5)
            assertThat(q.correctAnswer).isNull()
        }

        @Test
        fun `SafetyValidationResult fields`() {
            val svr = SafetyValidationResult(false, listOf("issue"), 0.5, "Fix it")
            assertThat(svr.safe).isFalse()
            assertThat(svr.issues).hasSize(1)
        }

        @Test
        fun `NGN_QUESTION_TYPES is not empty and contains bow_tie`() {
            assertThat(NGN_QUESTION_TYPES).isNotEmpty
            assertThat(NGN_QUESTION_TYPES).anyMatch { it.type == "bow_tie" }
            assertThat(NGN_QUESTION_TYPES).anyMatch { it.type == "matrix_multiple_choice" }
        }

        @Test
        fun `NGNTypeInfo fields`() {
            val info = NGNTypeInfo("test", "Test Label", "Test Desc")
            assertThat(info.type).isEqualTo("test")
            assertThat(info.label).isEqualTo("Test Label")
            assertThat(info.description).isEqualTo("Test Desc")
        }

        @Test
        fun `CaseTemplateInfo fields`() {
            val cti = CaseTemplateInfo("id", "title", "topic", listOf("bow_tie"))
            assertThat(cti.questionTypes).hasSize(1)
        }
    }
}
