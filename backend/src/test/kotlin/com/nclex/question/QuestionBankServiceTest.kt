package com.nclex.question

import com.nclex.model.GeneratedQuestion
import com.nclex.repository.GeneratedQuestionRepository
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.lang.reflect.Method
import java.time.Instant
import java.util.UUID

class QuestionBankServiceTest {

    private val generatedQuestionRepository: GeneratedQuestionRepository = mockk()
    private val questionGenerationService: QuestionGenerationService = mockk()
    private val persistence: QuestionBankPersistence = mockk()

    private lateinit var service: QuestionBankService

    private val userId: UUID = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        service = QuestionBankService(
            generatedQuestionRepository = generatedQuestionRepository,
            questionGenerationService = questionGenerationService,
            persistence = persistence
        )
    }

    // ── helpers ─────────────────────────────────────────────────────

    private fun bankRow(
        id: UUID = UUID.randomUUID(),
        topic: String = "Pharmacology",
        questionType: String = "mc",
        difficulty: String = "medium",
        usageCount: Int = 0,
        contentHash: String = UUID.randomUUID().toString()
    ): GeneratedQuestion = GeneratedQuestion(
        id = id,
        topic = topic,
        questionType = questionType,
        difficulty = difficulty,
        ncjmmStep = "recognize_cues",
        stem = "Stem for $id",
        options = listOf(
            mapOf("id" to "A", "text" to "Option A", "isCorrect" to true),
            mapOf("id" to "B", "text" to "Option B", "isCorrect" to false)
        ),
        correctAnswer = mapOf("correctOptionIds" to listOf("A")),
        rationale = "Because A is correct",
        source = "OpenStax",
        contentHash = contentHash,
        usageCount = usageCount,
        createdAt = Instant.now(),
        lastUsedAt = null
    )

    private fun generatedResponse(
        id: String = UUID.randomUUID().toString(),
        topic: String = "Pharmacology",
        type: String = "mc",
        stem: String = "What is the priority nursing action?",
        options: List<QuestionOptionDTO> = listOf(
            QuestionOptionDTO("A", "Assess vitals", true),
            QuestionOptionDTO("B", "Call MD", false)
        ),
        calculation: CalculationDTO? = null,
        difficulty: String = "medium"
    ): GeneratedQuestionResponse = GeneratedQuestionResponse(
        id = id,
        type = type,
        stem = stem,
        options = options,
        rationale = "Assessment is the priority action",
        ncjmmStep = "recognize_cues",
        ncjmmValidated = true,
        topic = topic,
        subtopic = null,
        difficulty = difficulty,
        source = "Generated",
        sourceKey = topic,
        partialCredit = if (type == "sata") true else null,
        calculation = calculation,
        createdAt = Instant.now().toString()
    )

    private fun stubNoBankRows() {
        every {
            generatedQuestionRepository.findUnattemptedForUser(any(), any(), any(), any(), any())
        } returns emptyList()
    }

    // ── 1. Bank-first selection ─────────────────────────────────────

    @Nested
    inner class BankFirstSelection {

        @Test
        fun `fully satisfied request never invokes generation`() {
            val rows = listOf(bankRow(), bankRow(), bankRow())
            every {
                generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userId, any())
            } returns rows
            every { persistence.bumpUsage(any()) } returns Unit

            val result = service.getQuestions("Pharmacology", "mc", "medium", userId, 3)

            assertThat(result).hasSize(3)
            verify(exactly = 0) { questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any()) }
        }
    }

    // ── 2. 70% cap honored ──────────────────────────────────────────

    @Nested
    inner class SeventyPercentCap {

        @Test
        fun `bank lookup limit is rounded up from the bank fraction of the requested count`() {
            val limitSlot = slot<Int>()
            every {
                generatedQuestionRepository.findUnattemptedForUser(any(), any(), any(), any(), capture(limitSlot))
            } returns emptyList()
            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse()
            every { persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns UUID.randomUUID()

            service.getQuestions("Pharmacology", "mc", "medium", userId, 5)

            assertThat(limitSlot.captured).isEqualTo(4)
        }

        @Test
        fun `large request caps bank-sourced rows at the bank fraction limit`() {
            val cappedRows = (1..14).map { bankRow(usageCount = it) }
            every {
                generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userId, 14)
            } returns cappedRows
            every { persistence.bumpUsage(any()) } returns Unit
            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse()
            every { persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns UUID.randomUUID()

            service.getQuestions("Pharmacology", "mc", "medium", userId, 20)

            verify { generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userId, 14) }
        }
    }

    // ── 3. Shortfall generation + persistence ──────────────────────

    @Nested
    inner class ShortfallGenerationAndPersistence {

        @Test
        fun `generates and persists exactly the gap between bank rows and requested count`() {
            val bankRows = listOf(bankRow(), bankRow())
            every {
                generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userId, any())
            } returns bankRows
            every { persistence.bumpUsage(any()) } returns Unit

            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse()
            every {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            } returns UUID.randomUUID()

            val result = service.getQuestions("Pharmacology", "mc", "medium", userId, 5)

            assertThat(result).hasSize(5)
            // shortfall = 5 - 2 = 3
            verify(exactly = 3) { questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any()) }
            verify(exactly = 3) {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            }
        }
    }

    // ── 4 & 5. Dedup on content_hash collision ─────────────────────

    @Nested
    inner class DedupOnContentHashCollision {

        @Test
        fun `content hash collision on insert resolves to the existing row's id`() {
            stubNoBankRows()
            val generatedId = UUID.randomUUID().toString()
            val existingRowId = UUID.randomUUID()

            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse(id = generatedId)

            every {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            } returns null
            every { generatedQuestionRepository.findByContentHash(any()) } returns bankRow(id = existingRowId)

            val result = service.getQuestions("Pharmacology", "mc", "medium", userId, 1)

            assertThat(result.single().id).isEqualTo(existingRowId.toString())
        }

        @Test
        fun `unresolvable hash collision yields no question for that slot`() {
            stubNoBankRows()

            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse()
            every {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            } returns null
            every { generatedQuestionRepository.findByContentHash(any()) } returns null

            // generateAndPersist swallows exceptions per-item and logs a warning, so the
            // service itself returns a short list rather than propagating — but the
            // IllegalStateException is what's actually thrown internally. We assert that
            // by invoking persistGenerated's logic indirectly: the swallowed-exception path
            // means getQuestions returns fewer than requested (0 generated successfully).
            val result = service.getQuestions("Pharmacology", "mc", "medium", userId, 1)

            assertThat(result).isEmpty()
        }

        @Test
        fun `persistGenerated throws IllegalStateException when both insertIfAbsent and findByContentHash are null`() {
            // Exercise the private persistGenerated method directly via reflection so the
            // IllegalStateException itself (not just its swallowed effect) is asserted,
            // matching plan item 5 precisely.
            every {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            } returns null
            every { generatedQuestionRepository.findByContentHash(any()) } returns null

            val response = generatedResponse()
            val method: Method = QuestionBankService::class.java.getDeclaredMethod(
                "persistGenerated", GeneratedQuestionResponse::class.java
            )
            method.isAccessible = true

            assertThatThrownBy {
                try {
                    method.invoke(service, response)
                } catch (e: java.lang.reflect.InvocationTargetException) {
                    throw e.targetException
                }
            }.isInstanceOf(IllegalStateException::class.java)
        }
    }

    // ── 6. usage_count / last_used_at bump ──────────────────────────

    @Nested
    inner class UsageBump {

        @Test
        fun `served bank rows trigger bumpUsage with exactly those ids`() {
            val rows = listOf(bankRow(), bankRow(), bankRow())
            val idsSlot = slot<List<UUID>>()
            every {
                generatedQuestionRepository.findUnattemptedForUser(any(), any(), any(), any(), any())
            } returns rows
            every { persistence.bumpUsage(capture(idsSlot)) } returns Unit

            service.getQuestions("Pharmacology", "mc", "medium", userId, 3)

            assertThat(idsSlot.captured).containsExactlyInAnyOrderElementsOf(rows.map { it.id })
            verify(exactly = 1) { persistence.bumpUsage(any()) }
        }

        @Test
        fun `no served bank rows means bumpUsage is skipped`() {
            stubNoBankRows()
            every {
                questionGenerationService.generateQuestion(any(), any(), any(), any(), any(), any())
            } returns generatedResponse()
            every {
                persistence.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())
            } returns UUID.randomUUID()

            service.getQuestions("Pharmacology", "mc", "medium", userId, 1)

            verify(exactly = 0) { persistence.bumpUsage(any()) }
        }
    }

    // ── 7. computeContentHash / normalizeForHash ────────────────────

    @Nested
    inner class ContentHashNormalization {

        private fun normalize(value: String): String {
            val method = QuestionBankService::class.java.getDeclaredMethod("normalizeForHash", String::class.java)
            method.isAccessible = true
            return method.invoke(service, value) as String
        }

        private fun contentHash(topic: String, type: String, stem: String): String {
            val method = QuestionBankService::class.java.getDeclaredMethod(
                "computeContentHash", String::class.java, String::class.java, String::class.java
            )
            method.isAccessible = true
            return method.invoke(service, topic, type, stem) as String
        }

        @Test
        fun `normalizeForHash lowercases the stem`() {
            assertThat(normalize("UPPER CASE STEM")).isEqualTo("upper case stem")
        }

        @Test
        fun `normalizeForHash folds smart quotes to straight quotes`() {
            assertThat(normalize("What’s the patient’s status?"))
                .isEqualTo(normalize("What's the patient's status?"))
        }

        @Test
        fun `normalizeForHash folds en and em dashes to a hyphen`() {
            assertThat(normalize("Pre–op vs. post—op care"))
                .isEqualTo(normalize("Pre-op vs. post-op care"))
        }

        @Test
        fun `normalizeForHash strips bold markdown markers`() {
            assertThat(normalize("**Bold** drug name")).isEqualTo("bold drug name")
        }

        @Test
        fun `normalizeForHash strips italic markdown markers`() {
            assertThat(normalize("_Italic_ instructions")).isEqualTo("italic instructions")
        }

        @Test
        fun `normalizeForHash strips inline code backticks`() {
            assertThat(normalize("Use `metoprolol` now")).isEqualTo("use metoprolol now")
        }

        @Test
        fun `normalizeForHash collapses runs of whitespace to a single space`() {
            assertThat(normalize("Multiple   spaces between words")).isEqualTo("multiple spaces between words")
        }

        @Test
        fun `normalizeForHash collapses embedded tabs and newlines to a single space`() {
            assertThat(normalize("Spaces\tand\nnewlines here")).isEqualTo("spaces and newlines here")
        }

        @Test
        fun `normalizeForHash trims a run of trailing periods`() {
            assertThat(normalize("Trailing punctuation noise...")).isEqualTo("trailing punctuation noise")
        }

        @Test
        fun `normalizeForHash trims a run of trailing exclamation marks`() {
            assertThat(normalize("Trailing punctuation noise!!!")).isEqualTo("trailing punctuation noise")
        }

        @Test
        fun `computeContentHash collapses smart-quote variants of the same stem to the same hash`() {
            val plain = contentHash("Pharmacology", "mc", "What is the patient's priority need?")
            val smartQuotes = contentHash("Pharmacology", "mc", "What is the patient’s priority need?")

            assertThat(smartQuotes).isEqualTo(plain)
        }

        @Test
        fun `computeContentHash collapses markdown-marker variants of the same stem to the same hash`() {
            val plain = contentHash("Pharmacology", "mc", "What is the patient's priority need?")
            val withMarkdown = contentHash("Pharmacology", "mc", "What is the **patient's** priority `need`?")

            assertThat(withMarkdown).isEqualTo(plain)
        }

        @Test
        fun `computeContentHash collapses whitespace variants of the same stem to the same hash`() {
            val plain = contentHash("Pharmacology", "mc", "What is the patient's priority need?")
            val withWhitespaceNoise = contentHash("Pharmacology", "mc", "What   is the patient's\npriority need?")

            assertThat(withWhitespaceNoise).isEqualTo(plain)
        }

        @Test
        fun `genuinely different stems hash differently`() {
            val first = contentHash("Pharmacology", "mc", "What is the priority nursing action for this patient?")
            val second = contentHash("Pharmacology", "mc", "Which laboratory value requires immediate follow-up?")

            assertThat(first).isNotEqualTo(second)
        }

        @Test
        fun `different topic or type also changes the hash even with identical stem`() {
            val stem = "What is the priority nursing action?"
            val mcHash = contentHash("Pharmacology", "mc", stem)
            val sataHash = contentHash("Pharmacology", "sata", stem)
            val otherTopicHash = contentHash("Cardiology", "mc", stem)

            assertThat(mcHash).isNotEqualTo(sataHash)
            assertThat(mcHash).isNotEqualTo(otherTopicHash)
        }
    }

    // ── 8. buildCorrectAnswer ────────────────────────────────────────

    @Nested
    inner class BuildCorrectAnswer {

        private fun buildCorrectAnswer(response: GeneratedQuestionResponse): Map<String, Any> {
            val method = QuestionBankService::class.java.getDeclaredMethod("buildCorrectAnswer", GeneratedQuestionResponse::class.java)
            method.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            return method.invoke(service, response) as Map<String, Any>
        }

        @Test
        fun `mc question yields correctOptionIds only`() {
            val response = generatedResponse(
                type = "mc",
                options = listOf(
                    QuestionOptionDTO("A", "Right", true),
                    QuestionOptionDTO("B", "Wrong", false),
                    QuestionOptionDTO("C", "Wrong", false),
                    QuestionOptionDTO("D", "Wrong", false)
                )
            )

            val result = buildCorrectAnswer(response)

            assertThat(result).containsOnlyKeys("correctOptionIds")
            assertThat(result["correctOptionIds"]).isEqualTo(listOf("A"))
        }

        @Test
        fun `sata question yields correctOptionIds with multiple entries`() {
            val response = generatedResponse(
                type = "sata",
                options = listOf(
                    QuestionOptionDTO("A", "Right", true),
                    QuestionOptionDTO("B", "Right", true),
                    QuestionOptionDTO("C", "Wrong", false),
                    QuestionOptionDTO("D", "Right", true),
                    QuestionOptionDTO("E", "Wrong", false),
                    QuestionOptionDTO("F", "Wrong", false)
                )
            )

            val result = buildCorrectAnswer(response)

            assertThat(result).containsOnlyKeys("correctOptionIds")
            @Suppress("UNCHECKED_CAST")
            assertThat(result["correctOptionIds"] as List<String>).containsExactly("A", "B", "D")
        }

        @Test
        fun `dosage question without an explicit tolerance defaults the calculation tolerance to zero`() {
            val response = generatedResponse(
                type = "dosage",
                options = listOf(QuestionOptionDTO("A", "25 mL/hr", true)),
                calculation = CalculationDTO(
                    formula = "Dose / Concentration x Volume",
                    correctAnswer = 25.0,
                    unit = "mL/hr",
                    tolerance = null
                )
            )

            val result = buildCorrectAnswer(response)

            assertThat(result).containsOnlyKeys("correctOptionIds", "calculation")
            @Suppress("UNCHECKED_CAST")
            val calculation = result["calculation"] as Map<String, Any>
            assertThat(calculation["formula"]).isEqualTo("Dose / Concentration x Volume")
            assertThat(calculation["correctAnswer"]).isEqualTo(25.0)
            assertThat(calculation["unit"]).isEqualTo("mL/hr")
            assertThat(calculation["tolerance"]).isEqualTo(0.0)
        }

        @Test
        fun `dosage question with explicit tolerance preserves the provided value`() {
            val response = generatedResponse(
                type = "dosage",
                options = listOf(QuestionOptionDTO("A", "25 mL/hr", true)),
                calculation = CalculationDTO(
                    formula = "Dose / Concentration x Volume",
                    correctAnswer = 25.0,
                    unit = "mL/hr",
                    tolerance = 0.5
                )
            )

            val result = buildCorrectAnswer(response)

            @Suppress("UNCHECKED_CAST")
            val calculation = result["calculation"] as Map<String, Any>
            assertThat(calculation["tolerance"]).isEqualTo(0.5)
        }
    }
}
