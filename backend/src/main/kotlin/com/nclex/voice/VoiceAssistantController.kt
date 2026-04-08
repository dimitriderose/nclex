package com.nclex.voice

import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.repository.ContentCacheRepository
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.reactive.function.client.WebClient
import java.time.Instant

@RestController
@RequestMapping("/api/voice")
class VoiceAssistantController(
    private val webClient: WebClient.Builder,
    private val contentCacheRepository: ContentCacheRepository,
    private val rateLimitService: RateLimitService,
    @Value("\${nclex.claude.api-key:}") private val apiKey: String,
    @Value("\${nclex.claude.api-url:https://api.anthropic.com/v1/messages}") private val apiUrl: String,
    @Value("\${nclex.claude.model-sonnet}") private val model: String
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    companion object {
        val NCLEX_TOPICS = setOf(
            "pharmacology", "medication", "drug", "nursing", "patient", "assessment",
            "intervention", "diagnosis", "lab", "vital", "electrolyte", "fluid",
            "cardiac", "respiratory", "gi", "renal", "neuro", "endo", "hematology",
            "infection", "immunity", "maternal", "pediatric", "mental health", "psych",
            "delegation", "priority", "safety", "nclex", "ncjmm", "clinical",
            "anatomy", "physiology", "pathophysiology", "nutrition", "wound",
            "pain", "cancer", "diabetes", "hypertension", "heart failure",
            "copd", "asthma", "pneumonia", "uti", "ckd", "liver", "gi bleed",
            "stroke", "seizure", "burns", "shock", "sepsis", "dvt", "pe"
        )
    }

    @PostMapping("/ask")
    fun ask(
        @RequestBody body: VoiceRequest,
        request: HttpServletRequest
    ): ResponseEntity<VoiceResponse> {
        val userId = request.getAttribute("userId")?.toString()
            ?: throw IllegalStateException("Missing userId")

        if (!rateLimitService.tryConsumeClaude(userId)) {
            throw RateLimitException("Rate limit exceeded")
        }

        // NCLEX focus enforcement
        val isNCLEXRelated = isNCLEXQuestion(body.question)
        if (!isNCLEXRelated) {
            return ResponseEntity.ok(VoiceResponse(
                answer = "I'm focused on helping you study for the NCLEX. Could you ask me a nursing or clinical question instead?",
                source = null,
                withheld = false
            ))
        }

        // Answer withholding during active questions
        if (body.isQuestionActive) {
            val mightRevealAnswer = containsAnswerRequest(body.question)
            if (mightRevealAnswer) {
                return ResponseEntity.ok(VoiceResponse(
                    answer = "I can't give you the answer while you're working on a question. Try your best, and I'll explain the rationale after you submit!",
                    source = null,
                    withheld = true
                ))
            }
        }

        // Search ContentDB for grounding context
        val context = searchContentForContext(body.question)

        val systemPrompt = """
            You are an NCLEX study voice assistant. You help nursing students prepare for the NCLEX exam.
            
            Rules:
            1. Only answer NCLEX-related nursing/clinical questions
            2. Cite your sources when referencing specific content
            3. Keep responses concise (2-3 sentences for voice) but accurate
            4. If a question is active, do NOT reveal answers
            5. Use the provided content context to ground your responses
            
            Available content context:
            $context
        """.trimIndent()

        val conversationMessages = body.conversationHistory.map {
            mapOf("role" to it["role"], "content" to it["content"])
        }.toMutableList()
        conversationMessages.add(mapOf("role" to "user", "content" to body.question))

        return try {
            val answer = callClaude(systemPrompt, conversationMessages)
            val source = if (context.contains("[Source:")) {
                context.substringAfter("[Source: ").substringBefore("]").takeIf { it.isNotBlank() }
            } else null

            ResponseEntity.ok(VoiceResponse(
                answer = answer,
                source = source,
                withheld = false
            ))
        } catch (e: Exception) {
            logger.error("Voice assistant error: ${e.message}")
            ResponseEntity.ok(VoiceResponse(
                answer = "I'm having trouble processing that right now. Could you try rephrasing?",
                source = null,
                withheld = false
            ))
        }
    }

    private fun isNCLEXQuestion(question: String): Boolean {
        val lower = question.lowercase()
        return NCLEX_TOPICS.any { lower.contains(it) } ||
            lower.contains("what is") || lower.contains("explain") ||
            lower.contains("how does") || lower.contains("why") ||
            lower.contains("when should") || lower.contains("nurse")
    }

    private fun containsAnswerRequest(question: String): Boolean {
        val lower = question.lowercase()
        return lower.contains("what is the answer") ||
            lower.contains("tell me the answer") ||
            lower.contains("which option") ||
            lower.contains("correct answer") ||
            lower.contains("is it a, b, c") ||
            lower.contains("what should i pick")
    }

    private fun searchContentForContext(question: String): String {
        return try {
            val keywords = question.split(" ").filter { it.length > 3 }.take(3)
            val results = mutableListOf<String>()
            for (kw in keywords) {
                val cached = contentCacheRepository.searchByKeyOrSource(kw, Instant.now())
                for (entry in cached.take(2)) {
                    results.add("[Source: ${entry.source}/${entry.contentKey}] ${entry.data.entries.take(5).joinToString("; ") { "${it.key}: ${it.value}" }}")
                }
            }
            if (results.isEmpty()) "No specific content found in database."
            else results.joinToString("\n")
        } catch (e: Exception) {
            "Content search unavailable."
        }
    }

    private fun callClaude(systemPrompt: String, messages: List<Map<String, Any?>>): String {
        if (apiKey.isBlank()) throw ExternalServiceException("Claude API key not configured")

        val requestBody = mapOf(
            "model" to model,
            "max_tokens" to 512,
            "system" to systemPrompt,
            "messages" to messages
        )

        val response = webClient.build()
            .post().uri(apiUrl)
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .bodyValue(requestBody)
            .retrieve()
            .bodyToMono(Map::class.java)
            .block() ?: throw ExternalServiceException("Empty response")

        @Suppress("UNCHECKED_CAST")
        val content = response["content"] as? List<Map<String, Any>>
            ?: throw ExternalServiceException("Invalid format")

        return content.firstOrNull { it["type"] == "text" }?.get("text") as? String
            ?: throw ExternalServiceException("No text")
    }
}

data class VoiceRequest(
    val question: String,
    val isQuestionActive: Boolean = false,
    val conversationHistory: List<Map<String, Any>> = emptyList()
)

data class VoiceResponse(
    val answer: String,
    val source: String?,
    val withheld: Boolean
)
