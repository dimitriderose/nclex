package com.nclex.claude

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.exception.UnauthorizedException
import com.nclex.exception.ValidationException
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Size
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.slf4j.LoggerFactory
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.reactive.function.client.bodyToMono
import java.util.UUID

data class ClaudeMessage(
    val role: String,
    @field:Size(max = 100000, message = "Message content too long")
    val content: String
)

data class ClaudeRequest(
    @field:NotEmpty(message = "Messages cannot be empty")
    @field:Size(max = 50, message = "Too many messages")
    val messages: List<ClaudeMessage>
)

@RestController
@RequestMapping("/api/claude")
class ClaudeProxyController(
    private val rateLimitService: RateLimitService,
    private val auditLogger: AuditLogger,
    @Value("\${nclex.claude.api-key}") private val apiKey: String,
    @Value("\${nclex.claude.api-url}") private val apiUrl: String,
    @Value("\${nclex.claude.model}") private val model: String,
    @Value("\${nclex.claude.max-tokens}") private val maxTokens: Int
) {

    private val logger = LoggerFactory.getLogger(javaClass)

    private val webClient = WebClient.builder()
        .baseUrl(apiUrl)
        .defaultHeader("x-api-key", apiKey)
        .defaultHeader("anthropic-version", "2023-06-01")
        .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
        .codecs { it.defaultCodecs().maxInMemorySize(2 * 1024 * 1024) }
        .build()

    companion object {
        private const val SYSTEM_PROMPT = """You are an NCLEX exam tutor. Help nursing students prepare for the NCLEX-RN exam. Provide accurate, evidence-based nursing knowledge. When generating practice questions, follow NCLEX-style format with clinical scenarios and rationales for all answer choices."""
    }

    @PostMapping("/chat")
    fun chat(
        @Valid @RequestBody request: ClaudeRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<Map<String, Any>> {
        val userId = httpRequest.getAttribute("userId") as? UUID
            ?: throw UnauthorizedException()

        if (!rateLimitService.tryConsumeClaude(userId.toString())) {
            throw RateLimitException("Claude API rate limit exceeded. Try again later.")
        }

        // Validate message roles
        request.messages.forEach { msg ->
            if (msg.role !in listOf("user", "assistant")) {
                throw ValidationException("Invalid message role: ${msg.role}")
            }
        }

        val apiPayload = mapOf(
            "model" to model,
            "max_tokens" to maxTokens,
            "system" to SYSTEM_PROMPT,
            "messages" to request.messages.map { mapOf("role" to it.role, "content" to it.content) }
        )

        val response = try {
            webClient.post()
                .bodyValue(apiPayload)
                .retrieve()
                .bodyToMono<Map<String, Any>>()
                .block()
                ?: throw ExternalServiceException("Empty response from Claude API")
        } catch (e: ExternalServiceException) {
            throw e
        } catch (e: Exception) {
            logger.error("Claude API communication failed", e)
            throw ExternalServiceException("Failed to communicate with Claude API")
        }

        auditLogger.log(
            "CLAUDE_CHAT",
            userId,
            metadata = mapOf(
                "messageCount" to request.messages.size,
                "model" to model
            )
        )

        return ResponseEntity.ok(response)
    }
}
