package com.nclex.ngn

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.RateLimitException
import com.nclex.model.AuditLog
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono

class NGNCaseStudyServiceTest {

    private val webClientBuilder: WebClient.Builder = mockk()
    private val webClient: WebClient = mockk()
    private val requestBodyUriSpec: WebClient.RequestBodyUriSpec = mockk()
    private val requestBodySpec: WebClient.RequestBodySpec = mockk()
    private val requestHeadersSpec: WebClient.RequestHeadersSpec<*> = mockk()
    private val responseSpec: WebClient.ResponseSpec = mockk()
    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val rateLimitService: RateLimitService = mockk()
    private val auditLogger: AuditLogger = mockk()

    private lateinit var service: NGNCaseStudyService

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        service = NGNCaseStudyService(
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

    // ── generateCaseStudy ───────────────────────────────────────────

    @Nested
    inner class GenerateCaseStudy {

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns false

            assertThatThrownBy {
                service.generateCaseStudy("topic", listOf("bow_tie"), "medium", "user1")
            }.isInstanceOf(RateLimitException::class.java)
        }

        @Test
        fun `LLM success returns case study`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            val caseJson = """
                {
                    "title": "Heart Failure Case",
                    "scenario": "Patient presents...",
                    "tabs": [{"id":"1","label":"Notes","content":"Data","type":"nurses_notes"}],
                    "questions": [{
                        "type": "bow_tie",
                        "prompt": "Complete the diagram",
                        "data": {"conditions":[],"actions":[],"parameters":[],"correctLinks":{}},
                        "correctAnswer": null,
                        "rationale": "Explained",
                        "ncjmmStep": "analyze_cues",
                        "maxScore": 5
                    }]
                }
            """.trimIndent()

            val safetyJson = """{"safe":true,"issues":[],"confidence":0.95,"recommendation":"Looks good"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to caseJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to safetyJson))))
            )

            val result = service.generateCaseStudy("topic", listOf("bow_tie"), "medium", "user1")

            assertThat(result.title).isEqualTo("Heart Failure Case")
            assertThat(result.questions).hasSize(1)
            assertThat(result.safetyValidated).isTrue()
            verify { auditLogger.log(eq("NGN_CASE_GENERATED"), any(), any(), any(), any()) }
        }

        @Test
        fun `LLM fails falls back to template`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            // LLM call throws exception
            every { webClientBuilder.build() } throws RuntimeException("API down")

            val result = service.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", "user1")

            assertThat(result.title).isEqualTo("Heart Failure Exacerbation")
            assertThat(result.source).isEqualTo("OpenStax Template")
            assertThat(result.safetyValidated).isTrue()
        }

        @Test
        fun `LLM and template fail falls back to MC`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            // LLM call throws exception
            every { webClientBuilder.build() } throws RuntimeException("API down")

            // Use a topic that doesn't match any template
            val result = service.generateCaseStudy("obscure rare topic xyz", listOf("bow_tie"), "medium", "user1")

            assertThat(result.title).startsWith("Clinical Scenario:")
            assertThat(result.source).isEqualTo("Offline Fallback")
            assertThat(result.safetyValidated).isTrue()
        }
    }

    // ── safetyValidate ──────────────────────────────────────────────

    @Nested
    inner class SafetyValidate {

        @Test
        fun `success returns parsed safety result`() {
            val safetyJson = """{"safe":true,"issues":[],"confidence":0.95,"recommendation":"Safe"}"""
            mockClaudeCall(safetyJson)

            val caseStudy = CaseStudyResponse(
                id = "1", title = "Test", scenario = "Scenario",
                tabs = emptyList(), questions = emptyList(),
                topic = "topic", source = "test", safetyValidated = false,
                createdAt = "2024-01-01"
            )

            val result = service.safetyValidate(caseStudy)
            assertThat(result.safe).isTrue()
            assertThat(result.confidence).isCloseTo(0.95, org.assertj.core.data.Offset.offset(0.01))
        }

        @Test
        fun `API failure returns unsafe default result`() {
            every { webClientBuilder.build() } throws RuntimeException("API down")

            val caseStudy = CaseStudyResponse(
                id = "1", title = "Test", scenario = "Scenario",
                tabs = emptyList(), questions = emptyList(),
                topic = "topic", source = "test", safetyValidated = false,
                createdAt = "2024-01-01"
            )

            val result = service.safetyValidate(caseStudy)
            assertThat(result.safe).isFalse()
            assertThat(result.issues).contains("Safety validation service unavailable")
            assertThat(result.confidence).isEqualTo(0.0)
            assertThat(result.recommendation).isEqualTo("Manual review required")
        }
    }

    // ── getAvailableTemplates ───────────────────────────────────────

    @Nested
    inner class GetAvailableTemplates {

        @Test
        fun `returns template info correctly`() {
            val templates = service.getAvailableTemplates()
            assertThat(templates).isNotEmpty
            assertThat(templates).anyMatch { it.id == "hf-case-1" }
            assertThat(templates).anyMatch { it.id == "dka-case-1" }

            val hf = templates.first { it.id == "hf-case-1" }
            assertThat(hf.title).isEqualTo("Heart Failure Exacerbation")
            assertThat(hf.topic).isEqualTo("heart failure")
            assertThat(hf.questionTypes).isNotEmpty
        }
    }

    // ── callClaude edge cases ─────────────────────────────────────────

    @Nested
    inner class CallClaudeEdgeCases {

        @Test
        fun `blank API key throws ExternalServiceException`() {
            val serviceNoKey = NGNCaseStudyService(
                webClient = webClientBuilder,
                contentCacheRepository = contentCacheRepository,
                rateLimitService = rateLimitService,
                auditLogger = auditLogger,
                apiKey = "",
                apiUrl = "https://api.test.com",
                model = "test-model"
            )
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            // Will fall through to template fallback since LLM fails
            val result = serviceNoKey.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", "user1")
            assertThat(result.source).isEqualTo("OpenStax Template")
        }
    }

    // ── generateFromTemplate edge cases ────────────────────────────

    @Nested
    inner class GenerateFromTemplate {

        @Test
        fun `partial topic match finds template`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { webClientBuilder.build() } throws RuntimeException("API down")

            // "diabetic ketoacidosis" contains "diabetic ketoacidosis"
            val result = service.generateCaseStudy("diabetic ketoacidosis", listOf("matrix"), "medium", "user1")
            assertThat(result.title).isEqualTo("Diabetic Ketoacidosis Management")
        }
    }

    // ── parseSafetyResponse ─────────────────────────────────────────

    @Nested
    inner class ParseSafetyResponse {

        @Test
        fun `valid JSON parsed correctly`() {
            val safetyJson = """{"safe":false,"issues":["Bad dosage"],"confidence":0.7,"recommendation":"Fix dosage"}"""
            mockClaudeCall(safetyJson)

            val caseStudy = CaseStudyResponse(
                id = "1", title = "Test", scenario = "Scenario",
                tabs = emptyList(), questions = emptyList(),
                topic = "topic", source = "test", safetyValidated = false,
                createdAt = "2024-01-01"
            )

            val result = service.safetyValidate(caseStudy)
            assertThat(result.safe).isFalse()
            assertThat(result.issues).contains("Bad dosage")
            assertThat(result.recommendation).isEqualTo("Fix dosage")
        }

        @Test
        fun `malformed JSON returns fallback`() {
            mockClaudeCall("this is not valid json")

            val caseStudy = CaseStudyResponse(
                id = "1", title = "Test", scenario = "Scenario",
                tabs = emptyList(), questions = emptyList(),
                topic = "topic", source = "test", safetyValidated = false,
                createdAt = "2024-01-01"
            )

            val result = service.safetyValidate(caseStudy)
            assertThat(result.safe).isFalse()
            assertThat(result.issues).anyMatch { it.contains("Parse error") }
            assertThat(result.confidence).isEqualTo(0.0)
            assertThat(result.recommendation).isEqualTo("Manual review required")
        }

        @Test
        fun `JSON with missing fields uses defaults`() {
            // This covers the null-coalescing branches in parseSafetyResponse
            val safetyJson = """{}"""
            mockClaudeCall(safetyJson)

            val caseStudy = CaseStudyResponse(
                id = "1", title = "Test", scenario = "Scenario",
                tabs = emptyList(), questions = emptyList(),
                topic = "topic", source = "test", safetyValidated = false,
                createdAt = "2024-01-01"
            )

            val result = service.safetyValidate(caseStudy)
            assertThat(result.safe).isFalse() // default
            assertThat(result.issues).isEmpty() // default
            assertThat(result.confidence).isEqualTo(0.0) // default
            assertThat(result.recommendation).isEmpty() // default
        }
    }

    // ── parseCaseStudyResponse edge cases ────────────────────────────

    @Nested
    inner class ParseCaseStudyResponseEdgeCases {

        @Test
        fun `JSON with missing optional fields uses defaults`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            // JSON with no title, no scenario, minimal tabs/questions
            val caseJson = """
                {
                    "tabs": [{"type":"nurses_notes"}],
                    "questions": [{"data":{},"maxScore":1}]
                }
            """.trimIndent()

            val safetyJson = """{"safe":true,"issues":[],"confidence":0.9,"recommendation":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to caseJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to safetyJson))))
            )

            val result = service.generateCaseStudy("topic", listOf("bow_tie"), "medium", "user1")

            // title defaults to "Case Study: topic"
            assertThat(result.title).contains("topic")
            assertThat(result.scenario).isNotNull
        }

        @Test
        fun `JSON with null tabs and questions defaults to empty lists`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            // JSON with explicit null for tabs and questions
            val caseJson = """
                {
                    "title": "Test",
                    "scenario": "Scenario"
                }
            """.trimIndent()

            val safetyJson = """{"safe":true,"issues":[],"confidence":0.9,"recommendation":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to caseJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to safetyJson))))
            )

            val result = service.generateCaseStudy("topic", listOf("bow_tie"), "medium", "user1")

            assertThat(result.tabs).isEmpty()
            assertThat(result.questions).isEmpty()
        }

        @Test
        fun `valid UUID userId covers UUID fromString success branch`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            val caseJson = """
                {
                    "title": "Case",
                    "scenario": "Sc",
                    "tabs": [],
                    "questions": []
                }
            """.trimIndent()
            val safetyJson = """{"safe":true,"issues":[],"confidence":0.9,"recommendation":"ok"}"""

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returnsMany listOf(
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to caseJson)))),
                Mono.just(mapOf("content" to listOf(mapOf("type" to "text", "text" to safetyJson))))
            )

            // Use a valid UUID string to cover the UUID.fromString success branch
            val validUUID = java.util.UUID.randomUUID().toString()
            val result = service.generateCaseStudy("topic", listOf("bow_tie"), "medium", validUUID)

            assertThat(result).isNotNull
            verify { auditLogger.log(eq("NGN_CASE_GENERATED"), any(), any(), any(), any()) }
        }

        @Test
        fun `template fallback with valid UUID userId`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { webClientBuilder.build() } throws RuntimeException("API down")

            val validUUID = java.util.UUID.randomUUID().toString()
            val result = service.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", validUUID)

            assertThat(result.source).isEqualTo("OpenStax Template")
        }

        @Test
        fun `MC fallback with valid UUID userId`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { webClientBuilder.build() } throws RuntimeException("API down")

            val validUUID = java.util.UUID.randomUUID().toString()
            val result = service.generateCaseStudy("obscure rare topic xyz", listOf("bow_tie"), "medium", validUUID)

            assertThat(result.source).isEqualTo("Offline Fallback")
        }
    }

    // ── callClaude response edge cases ────────────────────────────────

    @Nested
    inner class CallClaudeResponseEdgeCases {

        @Test
        fun `response with invalid content format throws during generation`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            // content is not a List<Map>, it's a string
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to "not-a-list")
            )

            // LLM fails, falls back to template
            val result = service.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", "user1")
            assertThat(result.source).isEqualTo("OpenStax Template")
        }

        @Test
        fun `response with no text type in content falls back`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to listOf(mapOf("type" to "image", "url" to "http://...")))
            )

            val result = service.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", "user1")
            assertThat(result.source).isEqualTo("OpenStax Template")
        }

        @Test
        fun `empty response body falls back`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true

            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.empty()

            val result = service.generateCaseStudy("heart failure", listOf("bow_tie"), "medium", "user1")
            assertThat(result.source).isEqualTo("OpenStax Template")
        }
    }

    // ── generateFromTemplate partial match ────────────────────────────

    @Nested
    inner class GenerateFromTemplatePartial {

        @Test
        fun `topic that partially matches via contains finds template`() {
            every { rateLimitService.tryConsumeClaude(any()) } returns true
            every { webClientBuilder.build() } throws RuntimeException("API down")

            // "failure" partially matches "heart failure" template
            val result = service.generateCaseStudy("failure", listOf("bow_tie"), "medium", "user1")
            assertThat(result.title).isEqualTo("Heart Failure Exacerbation")
            assertThat(result.source).isEqualTo("OpenStax Template")
        }
    }
}
