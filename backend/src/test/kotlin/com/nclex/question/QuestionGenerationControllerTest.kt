package com.nclex.question

import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
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
    private val questionBankService: com.nclex.question.QuestionBankService = mockk()
    private val generatedQuestionRepository: com.nclex.repository.GeneratedQuestionRepository = mockk()
    private val questionAttemptRepository: com.nclex.repository.QuestionAttemptRepository = mockk()
    private val flaggedQuestionRepository: com.nclex.repository.FlaggedQuestionRepository = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: QuestionGenerationController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = QuestionGenerationController(
            service,
            questionBankService,
            generatedQuestionRepository,
            questionAttemptRepository,
            flaggedQuestionRepository
        )
        // Default: bank is empty, so generate/generateBatch fall through to
        // questionGenerationService directly — matches this test class's existing
        // assertions written against the pre-bank "always calls Claude" contract.
        // NOTE: QuestionGenerationControllerTest is on the QA Lead's documented
        // "UPDATE" list (constructor wiring + bank-first assertions) — this stub only
        // restores compilation/non-throwing defaults, not full bank-first coverage.
        every {
            questionBankService.getQuestions(any(), any(), any(), any(), any())
        } returns emptyList()
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
        fun `missing userId throws UnauthorizedException`() {
            // extractUserId's `else` branch (current contract — see QuestionGenerationController):
            // a null/non-UUID/non-UUID-string "userId" attribute is unauthenticated, not a
            // server bug, so it 401s via UnauthorizedException rather than 500ing via
            // IllegalStateException("Missing userId") (the pre-bank-refactor contract).
            every { httpRequest.getAttribute("userId") } returns null

            val body = GenerateRequest(topic = "Pharm")
            assertThatThrownBy { controller.generateQuestion(body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)
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
        fun `missing userId throws UnauthorizedException`() {
            // Same extractUserId contract as GenerateQuestion's equivalent test — see its comment.
            every { httpRequest.getAttribute("userId") } returns null

            val body = BatchGenerateRequest(topics = listOf("Pharm"))
            assertThatThrownBy { controller.generateBatch(body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)
        }

        @Test
        fun `successful batch returns list`() {
            // Bank-first (current contract): generateBatch groups consecutive same
            // (topic, type) indices and delegates to questionBankService.getQuestions per
            // group — it no longer calls questionGenerationService.generateBatch directly
            // (was: stubbing service.generateBatch, which the controller never invokes now).
            mockAuth()
            every {
                questionBankService.getQuestions("Pharm", "mc", "medium", userId, 1)
            } returns listOf(createQuestionResponse(topic = "Pharm"))
            every {
                questionBankService.getQuestions("Cardio", "mc", "medium", userId, 1)
            } returns listOf(createQuestionResponse(topic = "Cardio"))

            val body = BatchGenerateRequest(topics = listOf("Pharm", "Cardio"), count = 2)
            val result = controller.generateBatch(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `null difficulty defaults to medium`() {
            mockAuth()
            every {
                questionBankService.getQuestions(any(), any(), eq("medium"), any(), any())
            } returns emptyList()

            val body = BatchGenerateRequest(topics = listOf("t"), difficulty = null)
            controller.generateBatch(body, httpRequest)

            verify { questionBankService.getQuestions(any(), any(), eq("medium"), any(), any()) }
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

    // ── userId extraction edge cases ──────────────────────────────
    // extractUserId's actual contract (current production code — see
    // QuestionGenerationController.extractUserId): only a UUID instance, or a String
    // that parses as a UUID, authenticate; anything else (including arbitrary objects
    // like an Int, or a non-UUID-shaped String) 401s via UnauthorizedException. The
    // pre-bank-refactor "toString() whatever you get" fallback no longer exists —
    // these cases were rewritten to match (was: "non-null non-string userId calls
    // toString", asserting 42 -> "42" and a 200, which the current code rejects).

    @Nested
    inner class UserIdEdgeCases {

        @Test
        fun `non-UUID non-string userId attribute is unauthorized on generate`() {
            every { httpRequest.getAttribute("userId") } returns 42

            val body = GenerateRequest(topic = "Pharm")
            assertThatThrownBy { controller.generateQuestion(body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)
        }

        @Test
        fun `non-UUID non-string userId attribute is unauthorized on batch`() {
            every { httpRequest.getAttribute("userId") } returns 42

            val body = BatchGenerateRequest(topics = listOf("t"))
            assertThatThrownBy { controller.generateBatch(body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)
        }

        @Test
        fun `non-UUID-shaped string userId attribute is unauthorized`() {
            every { httpRequest.getAttribute("userId") } returns "not-a-uuid"

            val body = GenerateRequest(topic = "Pharm")
            assertThatThrownBy { controller.generateQuestion(body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)
        }

        @Test
        fun `UUID-shaped string userId attribute authenticates`() {
            val uuidString = userId.toString()
            every { httpRequest.getAttribute("userId") } returns uuidString
            every {
                questionBankService.getQuestions("Pharm", "mc", "medium", userId, 1)
            } returns listOf(createQuestionResponse())

            val body = GenerateRequest(topic = "Pharm")
            val result = controller.generateQuestion(body, httpRequest)
            assertThat(result.statusCode.value()).isEqualTo(200)
        }
    }

    // ── recordAttempt ──────────────────────────────────────────────
    // Phase 4: POST /{id}/attempt records a per-user attempt against a bank question and
    // (per QuestionGenerationController.autoFlagWrongAnswer) auto-creates a WRONG-category
    // flag — idempotently per (user, question) — when the answer is incorrect.

    @Nested
    inner class RecordAttempt {

        private val questionId = UUID.randomUUID()

        private fun createGeneratedQuestion(
            id: UUID = questionId,
            topic: String = "Pharmacology"
        ) = com.nclex.model.GeneratedQuestion(
            id = id,
            topic = topic,
            questionType = "mc",
            difficulty = "medium",
            ncjmmStep = "recognize_cues",
            stem = "Test stem",
            options = listOf(mapOf("id" to "A", "text" to "Option A", "isCorrect" to true)),
            correctAnswer = mapOf("id" to "A"),
            rationale = "Test rationale",
            contentHash = "hash-123"
        )

        private fun createAttempt(
            id: UUID = UUID.randomUUID(),
            qId: UUID = questionId,
            correct: Boolean = true,
            source: String = "practice"
        ) = com.nclex.model.QuestionAttempt(
            id = id,
            userId = userId,
            questionId = qId,
            correct = correct,
            source = source
        )

        @Test
        fun `successful attempt returns 201 with attempt fields`() {
            mockAuth()
            val question = createGeneratedQuestion()
            val saved = createAttempt(correct = true)

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(any()) } returns saved

            val body = RecordAttemptRequest(correct = true)
            val result = controller.recordAttempt(questionId, body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(201)
            assertThat(result.body!!["id"]).isEqualTo(saved.id)
            assertThat(result.body!!["questionId"]).isEqualTo(saved.questionId)
            assertThat(result.body!!["correct"]).isEqualTo(true)
            assertThat(result.body!!["source"]).isEqualTo("practice")
            assertThat(result.body!!["attemptedAt"]).isEqualTo(saved.attemptedAt.toString())
        }

        @Test
        fun `correct answer does not auto-flag`() {
            mockAuth()
            val question = createGeneratedQuestion()
            val saved = createAttempt(correct = true)

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(any()) } returns saved

            val body = RecordAttemptRequest(correct = true)
            controller.recordAttempt(questionId, body, httpRequest)

            verify(exactly = 0) { flaggedQuestionRepository.save(any()) }
        }

        @Test
        fun `unknown question id throws NotFoundException and saves no attempt`() {
            mockAuth()
            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.empty()

            val body = RecordAttemptRequest(correct = true)
            assertThatThrownBy { controller.recordAttempt(questionId, body, httpRequest) }
                .isInstanceOf(com.nclex.exception.NotFoundException::class.java)

            verify(exactly = 0) { questionAttemptRepository.save(any()) }
        }

        @Test
        fun `wrong answer auto-flags with WRONG category and question content`() {
            mockAuth()
            val question = createGeneratedQuestion(topic = "Cardiology")
            val saved = createAttempt(correct = false)
            val flagSlot = slot<FlaggedQuestion>()

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(any()) } returns saved
            every {
                flaggedQuestionRepository.existsByUserIdAndQuestionIdAndCategory(userId, question.id, FlagCategory.WRONG)
            } returns false
            every { flaggedQuestionRepository.save(capture(flagSlot)) } answers { firstArg() }

            val body = RecordAttemptRequest(correct = false)
            controller.recordAttempt(questionId, body, httpRequest)

            verify { flaggedQuestionRepository.save(any()) }
            val savedFlag = flagSlot.captured
            assertThat(savedFlag.category).isEqualTo(FlagCategory.WRONG)
            assertThat(savedFlag.questionId).isEqualTo(question.id)
            assertThat(savedFlag.userId).isEqualTo(userId)
            assertThat(savedFlag.topic).isEqualTo("Cardiology")
            assertThat(savedFlag.question["stem"]).isEqualTo(question.stem)
            assertThat(savedFlag.question["options"]).isEqualTo(question.options)
            assertThat(savedFlag.question["rationale"]).isEqualTo(question.rationale)
            assertThat(savedFlag.question["type"]).isEqualTo(question.questionType)
            assertThat(savedFlag.question["difficulty"]).isEqualTo(question.difficulty)
        }

        @Test
        fun `wrong answer does not duplicate flag when one already exists`() {
            mockAuth()
            val question = createGeneratedQuestion()
            val saved = createAttempt(correct = false)

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(any()) } returns saved
            every {
                flaggedQuestionRepository.existsByUserIdAndQuestionIdAndCategory(userId, question.id, FlagCategory.WRONG)
            } returns true

            val body = RecordAttemptRequest(correct = false)
            controller.recordAttempt(questionId, body, httpRequest)

            verify(exactly = 0) { flaggedQuestionRepository.save(any()) }
        }

        @Test
        fun `omitted source defaults to practice`() {
            mockAuth()
            val question = createGeneratedQuestion()
            val attemptSlot = slot<com.nclex.model.QuestionAttempt>()

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(capture(attemptSlot)) } answers { firstArg() }

            val body = RecordAttemptRequest(correct = true, source = null)
            controller.recordAttempt(questionId, body, httpRequest)

            assertThat(attemptSlot.captured.source).isEqualTo("practice")
        }

        @Test
        fun `explicit exam source passes through`() {
            mockAuth()
            val question = createGeneratedQuestion()
            val attemptSlot = slot<com.nclex.model.QuestionAttempt>()

            every { generatedQuestionRepository.findById(questionId) } returns java.util.Optional.of(question)
            every { questionAttemptRepository.save(capture(attemptSlot)) } answers { firstArg() }

            val body = RecordAttemptRequest(correct = true, source = "exam")
            controller.recordAttempt(questionId, body, httpRequest)

            assertThat(attemptSlot.captured.source).isEqualTo("exam")
        }

        @Test
        fun `missing userId throws UnauthorizedException without repo interaction`() {
            every { httpRequest.getAttribute("userId") } returns null

            val body = RecordAttemptRequest(correct = true)
            assertThatThrownBy { controller.recordAttempt(questionId, body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)

            verify(exactly = 0) { generatedQuestionRepository.findById(any()) }
            verify(exactly = 0) { questionAttemptRepository.save(any()) }
            verify(exactly = 0) { flaggedQuestionRepository.save(any()) }
        }

        @Test
        fun `invalid userId string throws UnauthorizedException without repo interaction`() {
            every { httpRequest.getAttribute("userId") } returns "not-a-uuid"

            val body = RecordAttemptRequest(correct = true)
            assertThatThrownBy { controller.recordAttempt(questionId, body, httpRequest) }
                .isInstanceOf(com.nclex.exception.UnauthorizedException::class.java)

            verify(exactly = 0) { generatedQuestionRepository.findById(any()) }
            verify(exactly = 0) { questionAttemptRepository.save(any()) }
            verify(exactly = 0) { flaggedQuestionRepository.save(any()) }
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
