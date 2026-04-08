package com.nclex.voice

import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono
import java.time.Instant
import java.util.UUID

class VoiceAssistantControllerTest {

    private val webClientBuilder: WebClient.Builder = mockk()
    private val webClient: WebClient = mockk()
    private val requestBodyUriSpec: WebClient.RequestBodyUriSpec = mockk()
    private val requestBodySpec: WebClient.RequestBodySpec = mockk()
    private val requestHeadersSpec: WebClient.RequestHeadersSpec<*> = mockk()
    private val responseSpec: WebClient.ResponseSpec = mockk()
    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val rateLimitService: RateLimitService = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: VoiceAssistantController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = VoiceAssistantController(
            webClient = webClientBuilder,
            contentCacheRepository = contentCacheRepository,
            rateLimitService = rateLimitService,
            apiKey = "test-key",
            apiUrl = "https://api.test.com",
            model = "test-model"
        )
    }

    private fun mockAuth() {
        every { httpRequest.getAttribute("userId") } returns userId.toString()
    }

    private fun mockClaudeCall(responseText: String) {
        every { webClientBuilder.build() } returns webClient
        every { webClient.post() } returns requestBodyUriSpec
        every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
        every { requestBodySpec.header(any(), any()) } returns requestBodySpec
        every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
        every { requestHeadersSpec.retrieve() } returns responseSpec
        every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
            mapOf("content" to listOf(mapOf("type" to "text", "text" to responseText)))
        )
    }

    // ── Missing userId ─────────────────────────────────────────────

    @Nested
    inner class MissingUserId {

        @Test
        fun `null userId throws IllegalStateException`() {
            every { httpRequest.getAttribute("userId") } returns null

            val body = VoiceRequest(question = "What is nursing?")
            assertThatThrownBy { controller.ask(body, httpRequest) }
                .isInstanceOf(IllegalStateException::class.java)
                .hasMessageContaining("Missing userId")
        }
    }

    // ── Rate Limiting ──────────────────────────────────────────────

    @Nested
    inner class RateLimiting {

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns false

            val body = VoiceRequest(question = "What is nursing assessment?")
            assertThatThrownBy { controller.ask(body, httpRequest) }
                .isInstanceOf(RateLimitException::class.java)
        }
    }

    // ── NCLEX Focus Enforcement ────────────────────────────────────

    @Nested
    inner class NCLEXFocusEnforcement {

        @Test
        fun `non-NCLEX question returns redirect response`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            // A question with no NCLEX keywords and no generic triggers
            val body = VoiceRequest(question = "Hello there")
            val result = controller.ask(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.answer).contains("focused on helping you study for the NCLEX")
            assertThat(result.body!!.withheld).isFalse()
            assertThat(result.body!!.source).isNull()
        }

        @Test
        fun `NCLEX keyword question passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("The nursing assessment involves...")

            val body = VoiceRequest(question = "Tell me about nursing assessment")
            val result = controller.ask(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.answer).isEqualTo("The nursing assessment involves...")
        }

        @Test
        fun `question with 'what is' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Answer about something")

            val body = VoiceRequest(question = "what is something")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Answer about something")
        }

        @Test
        fun `question with 'explain' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Explanation here")

            val body = VoiceRequest(question = "explain this concept")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Explanation here")
        }

        @Test
        fun `question with 'how does' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("How it works")

            val body = VoiceRequest(question = "how does this work")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("How it works")
        }

        @Test
        fun `question with 'why' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Because...")

            val body = VoiceRequest(question = "why is that")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Because...")
        }

        @Test
        fun `question with 'when should' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("When you should...")

            val body = VoiceRequest(question = "when should I do this")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("When you should...")
        }

        @Test
        fun `question with 'nurse' passes focus check`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Nurse answer")

            val body = VoiceRequest(question = "as a nurse, what do I do")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Nurse answer")
        }

        @Test
        fun `question with pharmacology topic passes`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Pharmacology answer")

            val body = VoiceRequest(question = "Tell me about pharmacology interactions")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Pharmacology answer")
        }
    }

    // ── Answer Withholding ─────────────────────────────────────────

    @Nested
    inner class AnswerWithholding {

        @Test
        fun `active question with answer request returns withheld response`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "what is the answer to this nursing question",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
            assertThat(result.body!!.answer).contains("can't give you the answer")
        }

        @Test
        fun `active question with 'tell me the answer' withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "can you tell me the answer please about medication",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
        }

        @Test
        fun `active question with 'which option' withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "which option is right for this drug question",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
        }

        @Test
        fun `active question with 'correct answer' withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "tell me the correct answer to this patient question",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
        }

        @Test
        fun `active question with 'is it a, b, c' withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "is it a, b, c or d for this nursing question",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
        }

        @Test
        fun `active question with 'what should i pick' withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val body = VoiceRequest(
                question = "what should i pick for this medication question",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isTrue()
        }

        @Test
        fun `active question without answer keywords not withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Helpful explanation")

            val body = VoiceRequest(
                question = "explain the nursing assessment process",
                isQuestionActive = true
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isFalse()
        }

        @Test
        fun `inactive question with answer keywords not withheld`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("The answer is...")

            val body = VoiceRequest(
                question = "what is the answer about nursing assessment",
                isQuestionActive = false
            )
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.withheld).isFalse()
        }
    }

    // ── Content Context Search ─────────────────────────────────────

    @Nested
    inner class ContentContextSearch {

        @Test
        fun `content cache results are used`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            val cache = ContentCache(
                contentKey = "pharm-101",
                source = "OpenStax",
                data = mapOf("info" to "drug details"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns listOf(cache)
            mockClaudeCall("Answer with context")

            val body = VoiceRequest(question = "Tell me about pharmacology medication effects")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Answer with context")
            verify(atLeast = 1) { contentCacheRepository.searchByKeyOrSource(any(), any()) }
        }

        @Test
        fun `content cache exception handled gracefully`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } throws RuntimeException("DB error")
            mockClaudeCall("Answer without context")

            val body = VoiceRequest(question = "Tell me about nursing assessment")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Answer without context")
        }

        @Test
        fun `empty cache results uses fallback message`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            mockClaudeCall("Generated answer")

            val body = VoiceRequest(question = "Tell me about nursing patient care")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).isEqualTo("Generated answer")
        }
    }

    // ── Source Extraction ──────────────────────────────────────────

    @Nested
    inner class SourceExtraction {

        @Test
        fun `source extracted from context containing Source tag`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            val cache = ContentCache(
                contentKey = "pharm-101",
                source = "OpenStax",
                data = mapOf("info" to "drug details"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns listOf(cache)
            mockClaudeCall("Answer with source")

            val body = VoiceRequest(question = "Tell me about pharmacology drugs")
            val result = controller.ask(body, httpRequest)

            // Source should be extracted from the context that contains [Source: OpenStax/pharm-101]
            assertThat(result.body!!.source).isNotNull()
        }
    }

    // ── Claude API Error Handling ──────────────────────────────────

    @Nested
    inner class ClaudeAPIErrors {

        @Test
        fun `Claude API error returns friendly error response`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            every { webClientBuilder.build() } throws RuntimeException("Connection refused")

            val body = VoiceRequest(question = "Tell me about nursing assessment")
            val result = controller.ask(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.answer).contains("trouble processing")
            assertThat(result.body!!.withheld).isFalse()
            assertThat(result.body!!.source).isNull()
        }

        @Test
        fun `blank API key throws ExternalServiceException caught in error handler`() {
            val controllerNoKey = VoiceAssistantController(
                webClient = webClientBuilder,
                contentCacheRepository = contentCacheRepository,
                rateLimitService = rateLimitService,
                apiKey = "",
                apiUrl = "https://api.test.com",
                model = "test-model"
            )
            every { httpRequest.getAttribute("userId") } returns userId.toString()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val body = VoiceRequest(question = "Tell me about nursing patient safety")
            // The ExternalServiceException is caught by the catch block, returning friendly message
            val result = controllerNoKey.ask(body, httpRequest)

            assertThat(result.body!!.answer).contains("trouble processing")
        }

        @Test
        fun `empty response from Claude returns error`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.empty()

            val body = VoiceRequest(question = "Tell me about nursing assessment concepts")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).contains("trouble processing")
        }

        @Test
        fun `invalid response format returns error`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(mapOf("no_content_key" to "value"))

            val body = VoiceRequest(question = "Tell me about nursing clinical care")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).contains("trouble processing")
        }

        @Test
        fun `response with no text content returns error`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(any()) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to listOf(mapOf("type" to "image", "data" to "base64")))
            )

            val body = VoiceRequest(question = "Tell me about nursing drug interactions")
            val result = controller.ask(body, httpRequest)

            assertThat(result.body!!.answer).contains("trouble processing")
        }
    }

    // ── Conversation History ──────────────────────────────────────

    @Nested
    inner class ConversationHistory {

        @Test
        fun `conversation history is included in Claude call`() {
            mockAuth()
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true
            every { contentCacheRepository.searchByKeyOrSource(any(), any()) } returns emptyList()

            val capturedBodies = mutableListOf<Any>()
            every { webClientBuilder.build() } returns webClient
            every { webClient.post() } returns requestBodyUriSpec
            every { requestBodyUriSpec.uri(any<String>()) } returns requestBodySpec
            every { requestBodySpec.header(any(), any()) } returns requestBodySpec
            every { requestBodySpec.bodyValue(capture(capturedBodies)) } returns requestHeadersSpec
            every { requestHeadersSpec.retrieve() } returns responseSpec
            every { responseSpec.bodyToMono(Map::class.java) } returns Mono.just(
                mapOf("content" to listOf(mapOf("type" to "text", "text" to "Response")))
            )

            val history = listOf<Map<String, Any>>(
                mapOf("role" to "user", "content" to "Previous question"),
                mapOf("role" to "assistant", "content" to "Previous answer")
            )
            val body = VoiceRequest(
                question = "Follow-up about nursing",
                conversationHistory = history
            )
            controller.ask(body, httpRequest)

            @Suppress("UNCHECKED_CAST")
            val requestBody = capturedBodies[0] as Map<String, Any>
            @Suppress("UNCHECKED_CAST")
            val messages = requestBody["messages"] as List<Map<String, Any?>>
            assertThat(messages).hasSize(3) // 2 history + 1 current
            assertThat(messages[0]["role"]).isEqualTo("user")
            assertThat(messages[0]["content"]).isEqualTo("Previous question")
            assertThat(messages[2]["role"]).isEqualTo("user")
            assertThat(messages[2]["content"]).isEqualTo("Follow-up about nursing")
        }
    }

    // ── NCLEX_TOPICS companion ────────────────────────────────────

    @Nested
    inner class NCLEXTopics {

        @Test
        fun `companion NCLEX_TOPICS is not empty`() {
            assertThat(VoiceAssistantController.NCLEX_TOPICS).isNotEmpty
            assertThat(VoiceAssistantController.NCLEX_TOPICS).contains("pharmacology")
            assertThat(VoiceAssistantController.NCLEX_TOPICS).contains("nursing")
            assertThat(VoiceAssistantController.NCLEX_TOPICS).contains("nclex")
        }
    }

    // ── VoiceRequest / VoiceResponse data classes ─────────────────

    @Nested
    inner class DataClasses {

        @Test
        fun `VoiceRequest defaults`() {
            val req = VoiceRequest(question = "test")
            assertThat(req.isQuestionActive).isFalse()
            assertThat(req.conversationHistory).isEmpty()
        }

        @Test
        fun `VoiceResponse fields`() {
            val resp = VoiceResponse(answer = "a", source = "s", withheld = true)
            assertThat(resp.answer).isEqualTo("a")
            assertThat(resp.source).isEqualTo("s")
            assertThat(resp.withheld).isTrue()
        }
    }
}
