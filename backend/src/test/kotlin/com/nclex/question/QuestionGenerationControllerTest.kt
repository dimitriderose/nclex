package com.nclex.question

import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.UUID

class QuestionGenerationControllerTest {

    private val service: QuestionGenerationService = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: QuestionGenerationController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = QuestionGenerationController(service)
    }

    private fun mockAuth() {
        every { httpRequest.getAttribute("userId") } returns userId
    }

    private fun createQuestionResponse(
        type: String = "mc",
        topic: String = "Pharmacology"
    ) = GeneratedQuestionResponse(
        id = UUID.randomUUID().toString(),
        type = type,
        stem = "Test question",
        options = listOf(
            QuestionOptionDTO("A", "Option A", true),
            QuestionOptionDTO("B", "Option B", false)
        ),
        rationale = "Test rationale",
        ncjmmStep = "recognize_cues",
        ncjmmValidated = true,
        topic = topic,
        subtopic = null,
        difficulty = "medium",
        source = "Generated",
        sourceKey = "pharm",
        partialCredit = null,
        calculation = null,
        createdAt = "2024-01-01"
    )

    // ── generateQuestion ───────────────────────────────────────────

    @Nested
    inner class GenerateQuestion {

        @Test
        fun `missing userId throws IllegalStateException`() {
            every { httpRequest.getAttribute("userId") } returns null

            val body = GenerateRequest(topic = "Pharm")
            assertThatThrownBy { controller.generateQuestion(body, httpRequest) }
                .isInstanceOf(IllegalStateException::class.java)
                .hasMessageContaining("Missing userId")
        }

        @Test
        fun `successful generation returns 200`() {
            mockAuth()
            val question = createQuestionResponse()
            every {
                service.generateQuestion("Pharm", "mc", "medium", null, null, userId.toString())
            } returns question

            val body = GenerateRequest(topic = "Pharm")
            val result = controller.generateQuestion(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.stem).isEqualTo("Test question")
        }

        @Test
        fun `passes all params to service`() {
            mockAuth()
            val question = createQuestionResponse()
            val context = mapOf<String, Any>("hint" to "dosage")
            every {
                service.generateQuestion("Cardio", "sata", "hard", "take_action", context, userId.toString())
            } returns question

            val body = GenerateRequest(
                topic = "Cardio",
                questionType = "sata",
                difficulty = "hard",
                ncjmmStep = "take_action",
                context = context
            )
            controller.generateQuestion(body, httpRequest)

            verify {
                service.generateQuestion("Cardio", "sata", "hard", "take_action", context, userId.toString())
            }
        }

        @Test
        fun `null difficulty defaults to medium`() {
            mockAuth()
            val question = createQuestionResponse()
            every {
                service.generateQuestion(any(), any(), eq("medium"), any(), any(), any())
            } returns question

            val body = GenerateRequest(topic = "Pharm", difficulty = null)
            controller.generateQuestion(body, httpRequest)

            verify { service.generateQuestion(any(), any(), eq("medium"), any(), any(), any()) }
        }
    }

    // ── generateBatch ──────────────────────────────────────────────

    @Nested
    inner class GenerateBatch {

        @Test
        fun `missing userId throws IllegalStateException`() {
            every { httpRequest.getAttribute("userId") } returns null

            val body = BatchGenerateRequest(topics = listOf("Pharm"))
            assertThatThrownBy { controller.generateBatch(body, httpRequest) }
                .isInstanceOf(IllegalStateException::class.java)
        }

        @Test
        fun `successful batch returns list`() {
            mockAuth()
            val questions = listOf(createQuestionResponse(), createQuestionResponse())
            every {
                service.generateBatch(listOf("Pharm", "Cardio"), 5, listOf("mc"), "medium", userId.toString())
            } returns questions

            val body = BatchGenerateRequest(topics = listOf("Pharm", "Cardio"), count = 5)
            val result = controller.generateBatch(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `null difficulty defaults to medium`() {
            mockAuth()
            every {
                service.generateBatch(any(), any(), any(), eq("medium"), any())
            } returns emptyList()

            val body = BatchGenerateRequest(topics = listOf("t"), difficulty = null)
            controller.generateBatch(body, httpRequest)

            verify { service.generateBatch(any(), any(), any(), eq("medium"), any()) }
        }
    }

    // ── validateQuestion ───────────────────────────────────────────

    @Nested
    inner class ValidateQuestion {

        @Test
        fun `returns validation result`() {
            every { httpRequest.getAttribute("userId") } returns userId
            val validationResult = ValidationResult(true, null, 0.95, "Correct")
            every {
                service.validateNCJMMTag("What is...", "recognize_cues", "Because...")
            } returns validationResult

            val body = ValidateRequest("What is...", "recognize_cues", "Because...")
            val result = controller.validateQuestion(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.isValid).isTrue()
            assertThat(result.body!!.confidence).isEqualTo(0.95)
        }
    }

    // ── userId toString edge case ─────────────────────────────────

    @Nested
    inner class UserIdEdgeCases {

        @Test
        fun `non-null non-string userId calls toString on generate`() {
            // Cover the safe-call branch where getAttribute returns non-null
            every { httpRequest.getAttribute("userId") } returns 42
            val question = createQuestionResponse()
            every {
                service.generateQuestion("Pharm", "mc", "medium", null, null, "42")
            } returns question

            val body = GenerateRequest(topic = "Pharm")
            val result = controller.generateQuestion(body, httpRequest)
            assertThat(result.statusCode.value()).isEqualTo(200)
        }

        @Test
        fun `non-null non-string userId calls toString on batch`() {
            every { httpRequest.getAttribute("userId") } returns 42
            every {
                service.generateBatch(any(), any(), any(), any(), eq("42"))
            } returns emptyList()

            val body = BatchGenerateRequest(topics = listOf("t"))
            val result = controller.generateBatch(body, httpRequest)
            assertThat(result.statusCode.value()).isEqualTo(200)
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `GenerateRequest defaults`() {
            val req = GenerateRequest(topic = "t")
            assertThat(req.questionType).isEqualTo("mc")
            assertThat(req.difficulty).isEqualTo("medium")
            assertThat(req.ncjmmStep).isNull()
            assertThat(req.context).isNull()
        }

        @Test
        fun `BatchGenerateRequest defaults`() {
            val req = BatchGenerateRequest(topics = listOf("t"))
            assertThat(req.count).isEqualTo(5)
            assertThat(req.questionTypes).isEqualTo(listOf("mc"))
            assertThat(req.difficulty).isEqualTo("medium")
        }

        @Test
        fun `CalculationDTO fields`() {
            val calc = CalculationDTO("formula", 1.5, "mg", 0.1)
            assertThat(calc.formula).isEqualTo("formula")
            assertThat(calc.correctAnswer).isEqualTo(1.5)
            assertThat(calc.unit).isEqualTo("mg")
            assertThat(calc.tolerance).isEqualTo(0.1)
        }

        @Test
        fun `QuestionOptionDTO fields`() {
            val opt = QuestionOptionDTO("A", "text", true)
            assertThat(opt.id).isEqualTo("A")
            assertThat(opt.isCorrect).isTrue()
        }

        @Test
        fun `ValidationResult fields`() {
            val vr = ValidationResult(false, "analyze_cues", 0.8, "Should be analyze")
            assertThat(vr.isValid).isFalse()
            assertThat(vr.suggestedStep).isEqualTo("analyze_cues")
        }
    }
}
