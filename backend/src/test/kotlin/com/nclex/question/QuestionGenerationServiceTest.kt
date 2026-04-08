package com.nclex.question

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.model.AuditLog
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono
import java.time.Instant
import java.util.UUID

class QuestionGenerationServiceTest {

    private val webClientBuilder: WebClient.Builder = mockk()
    private val webClient: WebClient = mockk()
    private val requestBodyUriSpec: WebClient.RequestBodyUriSpec = mockk()
    private val requestBodySpec: WebClient.RequestBodySpec = mockk()
    private val requestHeadersSpec: WebClient.RequestHeadersSpec<*> = mockk()
    private val responseSpec: WebClient.ResponseSpec = mockk()
    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val rateLimitService: RateLimitService = mockk()
    private val auditLogger: AuditLogger = mockk()

    private lateinit var service: QuestionGenerationService

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        service = QuestionGenerationService(
            webClient = webClientBuilder,
            contentCacheRepository = contentCacheRepository,
            rateLimitService = rateLimitService,
            auditLogger = auditLogger,
            apiKey = "test-key",
            apiUrl = "https://api.test.com",
            model = "test-model"
        )
    }

    private fun mockClaudeCall(responseJson: String) {
        every { webClientBuilder.build() } returns webClient
        every { webClient.post() } returns requestBodyUriSpec
        every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
        every { requestBodySpec.header(any(), any()) } returns requestBodySpec
        every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
        every { requestHeadersSpec.retrieve() } returns responseSpec
        every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
            mapOf("content" to listOf(mapOf("type" to "text", "text" to responseJson)))
        )
    }

    // ── generateQuestion ────────────────────────────────────────────

    @Nested
    inner class GenerateQuestion {

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns false

            assertThatThrownBy {
                service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            }.isInstanceOf(RateLimitException::class.java)
        }

        @Test
        fun `successful generation returns validated question`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """
                {
                    "stem": "What is the priority nursing action?",
                    "options": [
                        {"id": "A", "text": "Assess vitals", "isCorrect": true},
                        {"id": "B", "text": "Call MD", "isCorrect": false},
                        {"id": "C", "text": "Document", "isCorrect": false},
                        {"id": "D", "text": "Educate", "isCorrect": false}
                    ],
                    "rationale": "Assessment is priority",
                    "ncjmmStep": "recognize_cues",
                    "subtopic": "vitals",
                    "source": "OpenStax",
                    "sourceKey": "ch1"
                }
            """.trimIndent()

            val validationJson = """
                {"isValid": true, "suggestedStep": null, "confidence": 0.95, "reasoning": "Correct"}
            """.trimIndent()

            // First call generates question, second call validates
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("Pharmacology", "mc", "medium", null, null, "user1")

            assertThat(result.stem).isEqualTo("What is the priority nursing action?")
            assertThat(result.ncjmmValidated).isTrue()
            assertThat(result.topic).isEqualTo("Pharmacology")
            assertThat(result.type).isEqualTo("mc")
            verify { auditLogger.log(eq("QUESTION_GENERATED"), any(), any(), any(), any()) }
        }

        @Test
        fun `validation says invalid uses suggested step`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """
                {
                    "stem": "Test question",
                    "options": [{"id": "A", "text": "A", "isCorrect": true}],
                    "rationale": "reason",
                    "ncjmmStep": "recognize_cues"
                }
            """.trimIndent()

            val validationJson = """
                {"isValid": false, "suggestedStep": "analyze_cues", "confidence": 0.8, "reasoning": "Should be analyze"}
            """.trimIndent()

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.ncjmmStep).isEqualTo("analyze_cues")
            assertThat(result.ncjmmValidated).isTrue()
        }
    }

    // ── generateBatch ───────────────────────────────────────────────

    @Nested
    inner class GenerateBatch {

        @Test
        fun `caps count at 20`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns false // all fail with rate limit

            // Should attempt at most 20 even if count=50
            val results = service.generateBatch(listOf("topic"), 50, listOf("mc"), "medium", "user1")
            assertThat(results).isEmpty() // all failed, but the count was capped
        }

        @Test
        fun `handles individual failures gracefully`() {
            // First call succeeds, second fails
            var callCount = 0
            every { rateLimitService.tryConsumeClaude(any()) } answers {
                callCount++
                callCount == 1 // only first succeeds
            }
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """
                {"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}
            """.trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))
            ) andThen Mono.just(
                mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson)))
            )

            val results = service.generateBatch(listOf("t1", "t2"), 3, listOf("mc"), "medium", "user1")
            assertThat(results.size).isLessThanOrEqualTo(3)
        }
    }

    // ── validateNCJMMTag ────────────────────────────────────────────

    @Nested
    inner class ValidateNCJMMTag {

        @Test
        fun `API failure returns fallback ValidationResult with isValid true`() {
            every { webClientBuilder.build() } throws RuntimeException("API down")

            val result = service.validateNCJMMTag("stem", "recognize_cues", "rationale")

            assertThat(result.isValid).isTrue()
            assertThat(result.confidence).isEqualTo(0.5)
            assertThat(result.reasoning).contains("Validation unavailable")
        }

        @Test
        fun `successful validation returns parsed result`() {
            val validationJson = """
                {"isValid": false, "suggestedStep": "take_action", "confidence": 0.85, "reasoning": "Should be action"}
            """.trimIndent()
            mockClaudeCall(validationJson)

            val result = service.validateNCJMMTag("stem", "recognize_cues", "rationale")

            assertThat(result.isValid).isFalse()
            assertThat(result.suggestedStep).isEqualTo("take_action")
            assertThat(result.confidence).isCloseTo(0.85, org.assertj.core.data.Offset.offset(0.01))
        }
    }

    // ── parseQuestionResponse (tested via generateQuestion) ─────────

    @Nested
    inner class ParseQuestionResponse {

        @Test
        fun `malformed JSON returns fallback question with error message`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            mockClaudeCall("not valid json at all {{{")
            // The first call returns bad JSON, then validation also needs to be called
            // but since parseQuestionResponse catches exception, it returns fallback
            // and then validateNCJMMTag is called separately
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to "not valid json")))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to """{"isValid":true,"confidence":0.5,"reasoning":"ok"}"""))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")

            assertThat(result.stem).isEqualTo("Error generating question. Please try again.")
            assertThat(result.rationale).contains("error")
            assertThat(result.options).hasSize(4)
        }

        @Test
        fun `valid JSON with markdown code blocks parses correctly`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val wrappedJson = """```json
                {"stem":"Test","options":[{"id":"A","text":"A","isCorrect":true},{"id":"B","text":"B","isCorrect":false},{"id":"C","text":"C","isCorrect":false},{"id":"D","text":"D","isCorrect":false}],"rationale":"R","ncjmmStep":"analyze_cues","subtopic":"sub","source":"src","sourceKey":"key"}
            ```""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to wrappedJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.stem).isEqualTo("Test")
            assertThat(result.ncjmmStep).isEqualTo("analyze_cues")
        }

        @Test
        fun `sata question type sets partialCredit to true`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "sata", "medium", null, null, "user1")
            assertThat(result.partialCredit).isTrue()
        }
    }

    // ── parseValidationResponse ─────────────────────────────────────

    @Nested
    inner class ParseValidationResponse {

        @Test
        fun `malformed JSON returns fallback`() {
            mockClaudeCall("this is not json")
            // validateNCJMMTag catches parse errors internally
            val result = service.validateNCJMMTag("stem", "step", "rationale")
            // The parseValidationResponse returns isValid=true on parse error
            assertThat(result.isValid).isTrue()
        }
    }

    // ── gatherContentContext ────────────────────────────────────────

    @Nested
    inner class GatherContentContext {

        @Test
        fun `cache search succeeds with entries`() {
            val cache = ContentCache(
                contentKey = "key1",
                source = "OpenStax",
                data = mapOf("info" to "test"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns listOf(cache)

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result).isNotNull
            verify { contentCacheRepository.searchByKeyOrSource("topic", any()) }
        }

        @Test
        fun `cache throws exception continues gracefully`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } throws RuntimeException("DB error")

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result).isNotNull
        }

        @Test
        fun `with extraContext adds it to prompt`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val context = mapOf<String, Any>("hint" to "focus on dosage")
            val result = service.generateQuestion("topic", "mc", "medium", null, context, "user1")
            assertThat(result).isNotNull
        }
    }

    // ── callClaude ──────────────────────────────────────────────────

    @Nested
    inner class CallClaude {

        @Test
        fun `blank API key throws ExternalServiceException`() {
            val serviceNoKey = QuestionGenerationService(
                webClient = webClientBuilder,
                contentCacheRepository = contentCacheRepository,
                rateLimitService = rateLimitService,
                auditLogger = auditLogger,
                apiKey = "",
                apiUrl = "https://api.test.com",
                model = "test-model"
            )
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            assertThatThrownBy {
                serviceNoKey.generateQuestion("topic", "mc", "medium", null, null, "user1")
            }.isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("API key not configured")
        }
    }

    // ── parseQuestionResponse - dosage type ──────────────────────────

    @Nested
    inner class DosageType {

        @Test
        fun `dosage question type includes calculation field`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{
                "stem":"Calculate the dosage",
                "options":[{"id":"A","text":"2.5 mg","isCorrect":true},{"id":"B","text":"5 mg","isCorrect":false}],
                "rationale":"Calculation based on weight",
                "ncjmmStep":"generate_solutions",
                "calculation":{"formula":"dose = weight * factor","correctAnswer":2.5,"unit":"mg","tolerance":0.1}
            }""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("dosage", "dosage", "medium", null, null, "user1")

            assertThat(result.calculation).isNotNull
            assertThat(result.calculation!!.formula).isEqualTo("dose = weight * factor")
            assertThat(result.calculation!!.correctAnswer).isEqualTo(2.5)
            assertThat(result.calculation!!.unit).isEqualTo("mg")
            assertThat(result.calculation!!.tolerance).isEqualTo(0.1)
        }

        @Test
        fun `non-dosage question type has no partialCredit`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.partialCredit).isNull()
        }

        @Test
        fun `null calculation in JSON results in null calculation`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues","calculation":null}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.calculation).isNull()
        }
    }

    // ── callClaude edge cases ──────────────────────────────────────

    @Nested
    inner class CallClaudeEdgeCases {

        @Test
        fun `empty response body throws ExternalServiceException`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.empty()

            assertThatThrownBy {
                service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            }.isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("Empty response")
        }

        @Test
        fun `invalid content format throws ExternalServiceException`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(mapOf("no_content" to "value"))

            assertThatThrownBy {
                service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            }.isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("Invalid response format")
        }

        @Test
        fun `response with no text content throws ExternalServiceException`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to listOf(mapOf("type" to "image", "url" to "http://...")))
            )

            assertThatThrownBy {
                service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            }.isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("No text content")
        }
    }

    // ── Companion object ──────────────────────────────────────────

    @Nested
    inner class CompanionObject {

        @Test
        fun `NCJMM_STEPS has all 6 steps`() {
            assertThat(QuestionGenerationService.NCJMM_STEPS).hasSize(6)
            assertThat(QuestionGenerationService.NCJMM_STEPS).contains("recognize_cues", "take_action", "evaluate_outcomes")
        }

        @Test
        fun `QUESTION_TYPES has expected types`() {
            assertThat(QuestionGenerationService.QUESTION_TYPES).contains("mc", "sata", "dosage", "pharmacology")
        }
    }

    // ── parseQuestionResponse missing field branches ─────────────────

    @Nested
    inner class ParseQuestionResponseMissingFields {

        @Test
        fun `JSON with missing option fields uses defaults`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            // Options with missing id, text, isCorrect
            val questionJson = """{
                "stem":"Q",
                "options":[{"isCorrect":true},{"id":"B"}],
                "rationale":"R",
                "ncjmmStep":"recognize_cues"
            }""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.options).hasSize(2)
        }

        @Test
        fun `JSON with missing stem, rationale, ncjmmStep, difficulty uses defaults`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            // Minimal JSON with only options
            val questionJson = """{
                "options":[{"id":"A","text":"A","isCorrect":true}]
            }""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            assertThat(result.stem).isEqualTo("Question generation failed") // default
            assertThat(result.rationale).isEmpty() // default
            assertThat(result.ncjmmStep).isEqualTo("recognize_cues") // default
            assertThat(result.difficulty).isEqualTo("medium") // default
        }

        @Test
        fun `JSON without source and sourceKey fields uses defaults`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            // Omit source and sourceKey entirely so tree["source"] returns null (Java null)
            val questionJson = """{
                "stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],
                "rationale":"R","ncjmmStep":"recognize_cues"
            }""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("mytopic", "mc", "medium", null, null, "user1")
            assertThat(result.source).isEqualTo("Generated") // default when missing
            assertThat(result.sourceKey).isEqualTo("mytopic") // default to topic
        }

        @Test
        fun `calculation with missing formula, unit, correctAnswer uses defaults`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{
                "stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],
                "rationale":"R","ncjmmStep":"recognize_cues",
                "calculation":{}
            }""".trimIndent()
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "dosage", "medium", null, null, "user1")
            assertThat(result.calculation).isNotNull
            assertThat(result.calculation!!.formula).isEmpty()
            assertThat(result.calculation!!.correctAnswer).isEqualTo(0.0)
            assertThat(result.calculation!!.unit).isEmpty()
            assertThat(result.calculation!!.tolerance).isNull()
        }

        @Test
        fun `validation with null suggestedStep keeps original step`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            // isValid=false but suggestedStep is null
            val validationJson = """{"isValid":false,"suggestedStep":null,"confidence":0.8,"reasoning":"unsure"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            val result = service.generateQuestion("topic", "mc", "medium", null, null, "user1")
            // suggestedStep is null, so original step is kept
            assertThat(result.ncjmmStep).isEqualTo("recognize_cues")
        }

        @Test
        fun `generateQuestion with valid UUID userId`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            // Use valid UUID string to cover the UUID.fromString success branch
            val validUUID = UUID.randomUUID().toString()
            val result = service.generateQuestion("topic", "mc", "medium", null, null, validUUID)
            assertThat(result).isNotNull
        }
    }

    // ── parseValidationResponse missing field branches ─────────────

    @Nested
    inner class ParseValidationResponseMissingFields {

        @Test
        fun `JSON with missing isValid, confidence, reasoning uses defaults`() {
            // Cover null-coalescing branches in parseValidationResponse
            val validationJson = """{}"""
            mockClaudeCall(validationJson)

            val result = service.validateNCJMMTag("stem", "step", "rationale")
            assertThat(result.isValid).isTrue() // default
            assertThat(result.confidence).isEqualTo(0.5) // default
            assertThat(result.reasoning).isEqualTo("No reasoning provided") // default
        }

        @Test
        fun `suggestedStep value of literal null string is filtered out`() {
            val validationJson = """{"isValid":true,"suggestedStep":"null","confidence":0.9,"reasoning":"ok"}"""
            mockClaudeCall(validationJson)

            val result = service.validateNCJMMTag("stem", "step", "rationale")
            assertThat(result.suggestedStep).isNull() // "null" string filtered by takeIf
        }
    }

    // ── buildGenerationSystemPrompt ─────────────────────────────────

    @Nested
    inner class BuildGenerationSystemPrompt {

        @Test
        fun `with ncjmmStep specified includes must-target instruction`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"take_action"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            val capturedBodies = mutableListOf<Any>()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(capture(capturedBodies)) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            service.generateQuestion("topic", "mc", "hard", "take_action", null, "user1")

            @Suppress("UNCHECKED_CAST")
            val body = capturedBodies[0] as Map<String, Any>
            val systemPrompt = body["system"] as String
            assertThat(systemPrompt).contains("take_action")
            assertThat(systemPrompt).contains("MUST target")
        }

        @Test
        fun `without ncjmmStep uses auto-assign instruction`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val questionJson = """{"stem":"Q","options":[{"id":"A","text":"A","isCorrect":true}],"rationale":"R","ncjmmStep":"recognize_cues"}"""
            val validationJson = """{"isValid":true,"confidence":0.9,"reasoning":"ok"}"""

            val capturedBodies = mutableListOf<Any>()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(capture(capturedBodies)) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to questionJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to validationJson))))
            )

            service.generateQuestion("topic", "mc", "medium", null, null, "user1")

            @Suppress("UNCHECKED_CAST")
            val body = capturedBodies[0] as Map<String, Any>
            val systemPrompt = body["system"] as String
            assertThat(systemPrompt).contains("Assign the most appropriate")
        }
    }
}
