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
    }
}
