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
}
