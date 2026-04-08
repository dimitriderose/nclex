package com.nclex.claude

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.exception.UnauthorizedException
import com.nclex.exception.ValidationException
import com.nclex.model.AuditLog
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.core.ParameterizedTypeReference
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono
import java.util.*

class ClaudeProxyControllerTest {

    private val rateLimitService: RateLimitService = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()
    private val userId = UUID.randomUUID()

    private lateinit var controller: ClaudeProxyController

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        controller = ClaudeProxyController(
            rateLimitService = rateLimitService,
            auditLogger = auditLogger,
            apiKey = "test-key",
            apiUrl = "https://api.anthropic.com/v1/messages",
            model = "claude-sonnet-4-20250514",
            maxTokens = 4096
        )
    }

    // ── no userId ───────────────────────────────────────────────────

    @Nested
    inner class NoUserId {

        @Test
        fun `null userId throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns null

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(UnauthorizedException::class.java)
        }

        @Test
        fun `wrong type userId throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns "string-not-uuid"

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(UnauthorizedException::class.java)
        }
    }

    // ── rate limit ──────────────────────────────────────────────────

    @Nested
    inner class RateLimit {

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns false

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(RateLimitException::class.java)
                .hasMessageContaining("rate limit exceeded")
        }
    }

    // ── invalid role ────────────────────────────────────────────────

    @Nested
    inner class InvalidRole {

        @Test
        fun `system role throws ValidationException`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val request = ClaudeRequest(listOf(ClaudeMessage("system", "prompt")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ValidationException::class.java)
                .hasMessageContaining("Invalid message role: system")
        }

        @Test
        fun `unknown role throws ValidationException`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val request = ClaudeRequest(listOf(ClaudeMessage("tool", "content")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ValidationException::class.java)
                .hasMessageContaining("Invalid message role: tool")
        }
    }

    // ── successful chat ─────────────────────────────────────────────

    @Nested
    inner class SuccessfulChat {

        @Test
        fun `valid user and assistant roles pass validation`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val request = ClaudeRequest(listOf(
                ClaudeMessage("user", "hello"),
                ClaudeMessage("assistant", "hi there"),
                ClaudeMessage("user", "another question")
            ))

            // Will fail at WebClient call since no real API, but should NOT be auth/rate-limit/validation
            try {
                controller.chat(request, httpRequest)
            } catch (e: Exception) {
                assertThat(e).isNotInstanceOf(UnauthorizedException::class.java)
                assertThat(e).isNotInstanceOf(RateLimitException::class.java)
                assertThat(e).isNotInstanceOf(ValidationException::class.java)
                // Should be ExternalServiceException from the WebClient call
                assertThat(e).isInstanceOf(ExternalServiceException::class.java)
            }
        }

        @Test
        fun `single user message passes validation`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "What is hypertension?")))

            // Will fail at WebClient but proves validation pipeline works
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ExternalServiceException::class.java)
        }
    }

    // ── WebClient exception handling ────────────────────────────────

    @Nested
    inner class WebClientExceptions {

        @Test
        fun `ExternalServiceException from WebClient is rethrown`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))

            // The WebClient call in the real controller will throw ExternalServiceException
            // when it encounters a connection error (wrapped in the catch block)
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("Failed to communicate with Claude API")
        }
    }

    // ── successful chat with mocked WebClient ──────────────────────

    @Nested
    inner class SuccessfulChatWithMockedWebClient {

        @Test
        fun `successful API call returns response and logs audit`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val mockResponse = mapOf<String, Any>(
                "id" to "msg_123",
                "content" to listOf(mapOf("type" to "text", "text" to "Hello!")),
                "model" to "claude-sonnet-4-20250514",
                "role" to "assistant"
            )

            // Create controller with a mocked WebClient using reflection
            val webClientField = ClaudeProxyController::class.java.getDeclaredField("webClient")
            webClientField.isAccessible = true

            val mockWebClient = mockk<WebClient>()
            val mockRequestBodyUriSpec = mockk<WebClient.RequestBodyUriSpec>()
            val mockRequestBodySpec = mockk<WebClient.RequestBodySpec>()
            val mockResponseSpec = mockk<WebClient.ResponseSpec>()
            val mockMono = mockk<Mono<Map<String, Any>>>()

            every { mockWebClient.post() } returns mockRequestBodyUriSpec
            every { mockRequestBodyUriSpec.bodyValue(any()) } returns mockRequestBodySpec
            every { mockRequestBodySpec.retrieve() } returns mockResponseSpec
            every { mockResponseSpec.bodyToMono(any<ParameterizedTypeReference<Map<String, Any>>>()) } returns mockMono
            every { mockMono.block() } returns mockResponse

            webClientField.set(controller, mockWebClient)

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            val result = controller.chat(request, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).isNotNull
            assertThat(result.body!!["id"]).isEqualTo("msg_123")

            verify {
                auditLogger.log(
                    eq("CLAUDE_CHAT"),
                    eq(userId),
                    any(),
                    any(),
                    match<Map<String, Any>> {
                        it["messageCount"] == 1 && it["model"] == "claude-sonnet-4-20250514"
                    }
                )
            }
        }

        @Test
        fun `null response from API throws ExternalServiceException`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val webClientField = ClaudeProxyController::class.java.getDeclaredField("webClient")
            webClientField.isAccessible = true

            val mockWebClient = mockk<WebClient>()
            val mockRequestBodyUriSpec = mockk<WebClient.RequestBodyUriSpec>()
            val mockRequestBodySpec = mockk<WebClient.RequestBodySpec>()
            val mockResponseSpec = mockk<WebClient.ResponseSpec>()
            val mockMono = mockk<Mono<Map<String, Any>>>()

            every { mockWebClient.post() } returns mockRequestBodyUriSpec
            every { mockRequestBodyUriSpec.bodyValue(any()) } returns mockRequestBodySpec
            every { mockRequestBodySpec.retrieve() } returns mockResponseSpec
            every { mockResponseSpec.bodyToMono(any<ParameterizedTypeReference<Map<String, Any>>>()) } returns mockMono
            every { mockMono.block() } returns null

            webClientField.set(controller, mockWebClient)

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("Empty response from Claude API")
        }

        @Test
        fun `ExternalServiceException thrown from block is rethrown directly`() {
            every { httpRequest.getAttribute("userId") } returns userId
            every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

            val webClientField = ClaudeProxyController::class.java.getDeclaredField("webClient")
            webClientField.isAccessible = true

            val mockWebClient = mockk<WebClient>()
            val mockRequestBodyUriSpec = mockk<WebClient.RequestBodyUriSpec>()
            val mockRequestBodySpec = mockk<WebClient.RequestBodySpec>()
            val mockResponseSpec = mockk<WebClient.ResponseSpec>()
            val mockMono = mockk<Mono<Map<String, Any>>>()

            every { mockWebClient.post() } returns mockRequestBodyUriSpec
            every { mockRequestBodyUriSpec.bodyValue(any()) } returns mockRequestBodySpec
            every { mockRequestBodySpec.retrieve() } returns mockResponseSpec
            every { mockResponseSpec.bodyToMono(any<ParameterizedTypeReference<Map<String, Any>>>()) } returns mockMono
            every { mockMono.block() } throws ExternalServiceException("Upstream error")

            webClientField.set(controller, mockWebClient)

            val request = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
            assertThatThrownBy { controller.chat(request, httpRequest) }
                .isInstanceOf(ExternalServiceException::class.java)
                .hasMessageContaining("Upstream error")
        }
    }
}
