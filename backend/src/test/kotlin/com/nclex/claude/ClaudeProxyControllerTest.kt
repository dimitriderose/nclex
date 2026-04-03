package com.nclex.claude

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.RateLimitException
import com.nclex.exception.UnauthorizedException
import com.nclex.exception.ValidationException
import com.nclex.model.AuditLog
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.*

class ClaudeProxyControllerTest {

    private val rateLimitService = mockk<RateLimitService>()
    private val auditLogger = mockk<AuditLogger>()
    private val request = mockk<HttpServletRequest>()
    private val userId = UUID.randomUUID()

    private lateinit var controller: ClaudeProxyController

    @BeforeEach
    fun setup() {
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

    @Test
    fun `throws UnauthorizedException when no userId`() {
        every { request.getAttribute("userId") } returns null

        val chatRequest = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
        assertThatThrownBy { controller.chat(chatRequest, request) }
            .isInstanceOf(UnauthorizedException::class.java)
    }

    @Test
    fun `throws RateLimitException when rate limit exceeded`() {
        every { request.getAttribute("userId") } returns userId
        every { rateLimitService.tryConsumeClaude(userId.toString()) } returns false

        val chatRequest = ClaudeRequest(listOf(ClaudeMessage("user", "hello")))
        assertThatThrownBy { controller.chat(chatRequest, request) }
            .isInstanceOf(RateLimitException::class.java)
    }

    @Test
    fun `throws ValidationException for invalid message role`() {
        every { request.getAttribute("userId") } returns userId
        every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

        val chatRequest = ClaudeRequest(listOf(ClaudeMessage("system", "hello")))
        assertThatThrownBy { controller.chat(chatRequest, request) }
            .isInstanceOf(ValidationException::class.java)
            .hasMessageContaining("Invalid message role")
    }

    @Test
    fun `accepts valid user and assistant roles`() {
        every { request.getAttribute("userId") } returns userId
        every { rateLimitService.tryConsumeClaude(userId.toString()) } returns true

        val chatRequest = ClaudeRequest(listOf(
            ClaudeMessage("user", "hello"),
            ClaudeMessage("assistant", "hi")
        ))

        // This will fail at the WebClient call (no real API), but validates roles first
        try {
            controller.chat(chatRequest, request)
        } catch (e: Exception) {
            // Expected: ExternalServiceException from WebClient
            assertThat(e).isNotInstanceOf(ValidationException::class.java)
        }
    }
}
