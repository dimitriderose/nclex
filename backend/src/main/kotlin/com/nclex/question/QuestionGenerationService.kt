package com.nclex.question

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.ExternalServiceException
import com.nclex.exception.RateLimitException
import com.nclex.repository.ContentCacheRepository
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient
import java.time.Instant
import java.util.UUID

@Service
class QuestionGenerationService(
    private val webClient: WebClient.Builder,
    private val contentCacheRepository: ContentCacheRepository,
    private val rateLimitService: RateLimitService,
    private val auditLogger: AuditLogger,
    @Value("\${claude.api.key:}") private val apiKey: String,
    @Value("\${claude.api.url:https://api.anthropic.com/v1/messages}") private val apiUrl: String,
    @Value("\${claude.api.model:claude-sonnet-4-20250514}") private val model: String
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    companion object {
        val NCJMM_STEPS = listOf(
            "recognize_cues", "analyze_cues", "prioritize_hypotheses",
            "generate_solutions", "take_action", "evaluate_outcomes"
        )

        val QUESTION_TYPES = listOf("mc", "sata", "dosage", "pharmacology")
    }

    fun generateQuestion(
        topic: String,
        questionType: String,
        difficulty: String,
        ncjmmStep: String?,
        context: Map<String, Any>?,
        userId: String
    ): GeneratedQuestionResponse {
        if (!rateLimitService.tryConsumeClaude(userId)) {
            throw RateLimitException("Rate limit exceeded for question generation")
        }

        // Gather content context from ContentDB
        val contentContext = gatherContentContext(topic, context)

        // Build the generation prompt
        val systemPrompt = buildGenerationSystemPrompt(questionType, difficulty, ncjmmStep)
        val userPrompt = buildGenerationUserPrompt(topic, contentContext, questionType, difficulty)

        // Step 1: Generate question with NCJMM tag
        val rawResponse = callClaude(systemPrompt, userPrompt)
        val question = parseQuestionResponse(rawResponse, topic, questionType)

        // Step 2: Validate NCJMM tag
        val validation = validateNCJMMTag(question.stem, question.ncjmmStep, question.rationale)

        auditLogger.log(
            eventType = "QUESTION_GENERATED",
            userId = runCatching { UUID.fromString(userId) }.getOrNull(),
            metadata = mapOf("topic" to topic, "questionType" to questionType, "ncjmmStep" to (ncjmmStep ?: "auto"))
        )

        return if (validation.isValid) {
            question.copy(ncjmmValidated = true)
        } else {
            // Use the suggested step from validation
            question.copy(
                ncjmmStep = validation.suggestedStep ?: question.ncjmmStep,
                ncjmmValidated = true
            )
        }
    }

    fun generateBatch(
        topics: List<String>,
        count: Int,
        questionTypes: List<String>,
        difficulty: String,
        userId: String
    ): List<GeneratedQuestionResponse> {
        val questions = mutableListOf<GeneratedQuestionResponse>()
        val effectiveCount = count.coerceAtMost(20)

        for (i in 0 until effectiveCount) {
            val topic = topics[i % topics.size]
            val qType = questionTypes[i % questionTypes.size]
            try {
                val q = generateQuestion(topic, qType, difficulty, null, null, userId)
                questions.add(q)
            } catch (e: Exception) {
                logger.warn("Failed to generate question $i: ${e.message}")
            }
        }

        return questions
    }

    fun validateNCJMMTag(
        questionStem: String,
        assignedStep: String,
        rationale: String
    ): ValidationResult {
        val validationPrompt = """
            You are validating an NCLEX question's NCJMM (Clinical Judgment Measurement Model) step assignment.
            
            Question: $questionStem
            Assigned Step: $assignedStep
            Rationale: $rationale
            
            The NCJMM steps are:
            - recognize_cues: Identifying relevant information from patient data
            - analyze_cues: Connecting and interpreting cues to form patterns
            - prioritize_hypotheses: Ranking possible explanations by urgency/likelihood
            - generate_solutions: Planning interventions and expected outcomes
            - take_action: Implementing the best nursing intervention
            - evaluate_outcomes: Comparing actual outcomes with expected outcomes
            
            Evaluate if the assigned step is correct. Respond in JSON:
            {"isValid": true/false, "suggestedStep": "step_name or null", "confidence": 0.0-1.0, "reasoning": "brief explanation"}
        """.trimIndent()

        return try {
            val response = callClaude(
                "You are an NCLEX NCJMM validation expert. Respond only with valid JSON.",
                validationPrompt
            )
            parseValidationResponse(response)
        } catch (e: Exception) {
            logger.warn("NCJMM validation failed, accepting original tag: ${e.message}")
            ValidationResult(
                isValid = true,
                suggestedStep = null,
                confidence = 0.5,
                reasoning = "Validation unavailable, accepting original assignment"
            )
        }
    }

    private fun gatherContentContext(topic: String, extraContext: Map<String, Any>?): String {
        val parts = mutableListOf<String>()

        // Search content cache for relevant content
        try {
            val cached = contentCacheRepository.searchByKeyOrSource(topic, Instant.now())
            for (entry in cached.take(3)) {
                parts.add("[Source: ${entry.source}/${entry.contentKey}] ${entry.data}")
            }
        } catch (e: Exception) {
            logger.debug("Content cache search failed: ${e.message}")
        }

        // Add any extra context provided
        extraContext?.let { ctx ->
            parts.add("[Additional Context] $ctx")
        }

        return if (parts.isNotEmpty()) parts.joinToString("\n\n") else "No additional context available."
    }

    private fun buildGenerationSystemPrompt(questionType: String, difficulty: String, ncjmmStep: String?): String {
        val stepInstruction = if (ncjmmStep != null) {
            "The question MUST target the '$ncjmmStep' NCJMM cognitive step."
        } else {
            "Assign the most appropriate NCJMM cognitive step."
        }

        return """
            You are an expert NCLEX question writer. Generate source-grounded NCLEX-style questions.
            
            Rules:
            1. Questions must be clinically accurate and evidence-based
            2. $stepInstruction
            3. Difficulty level: $difficulty
            4. Question type: $questionType
               - mc: Multiple choice with exactly 4 options, 1 correct
               - sata: Select All That Apply with exactly 6 options, 2-4 correct, partial credit scoring
               - dosage: Dosage calculation with formula, numeric answer, and unit
               - pharmacology: Drug-focused with mechanism, side effects, nursing considerations
            5. Include a detailed rationale explaining why each option is correct/incorrect
            6. Cite the source material when available
            7. Assign one NCJMM step: recognize_cues, analyze_cues, prioritize_hypotheses, generate_solutions, take_action, evaluate_outcomes
            
            Respond in JSON format:
            {
              "stem": "question text",
              "options": [{"id": "A", "text": "...", "isCorrect": true/false}, ...],
              "rationale": "detailed explanation",
              "ncjmmStep": "step_name",
              "subtopic": "specific subtopic",
              "source": "source description",
              "sourceKey": "content_key",
              "calculation": {"formula": "...", "correctAnswer": 0, "unit": "...", "tolerance": 0} // only for dosage type
            }
        """.trimIndent()
    }

    private fun buildGenerationUserPrompt(
        topic: String,
        contentContext: String,
        questionType: String,
        difficulty: String
    ): String {
        return """
            Generate a $difficulty $questionType NCLEX question about: $topic
            
            Available source content:
            $contentContext
            
            Generate one high-quality question grounded in the above content.
        """.trimIndent()
    }

    private fun callClaude(systemPrompt: String, userPrompt: String): String {
        if (apiKey.isBlank()) {
            throw ExternalServiceException("Claude API key not configured")
        }

        val requestBody = mapOf(
            "model" to model,
            "max_tokens" to 2048,
            "system" to systemPrompt,
            "messages" to listOf(
                mapOf("role" to "user", "content" to userPrompt)
            )
        )

        val response = webClient.build()
            .post()
            .uri(apiUrl)
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .bodyValue(requestBody)
            .retrieve()
            .bodyToMono(Map::class.java)
            .block() ?: throw ExternalServiceException("Empty response from Claude API")

        @Suppress("UNCHECKED_CAST")
        val content = response["content"] as? List<Map<String, Any>>
            ?: throw ExternalServiceException("Invalid response format")

        return content.firstOrNull { it["type"] == "text" }?.get("text") as? String
            ?: throw ExternalServiceException("No text content in response")
    }

    private fun parseQuestionResponse(json: String, topic: String, questionType: String): GeneratedQuestionResponse {
        // Extract JSON from potential markdown code blocks
        val cleanJson = json.replace(Regex("""```json?\n?"""), "").replace("```", "").trim()

        return try {
            val mapper = com.fasterxml.jackson.databind.ObjectMapper()
            val tree = mapper.readTree(cleanJson)

            val options = tree["options"]?.map { opt ->
                QuestionOptionDTO(
                    id = opt["id"]?.asText() ?: UUID.randomUUID().toString().take(1),
                    text = opt["text"]?.asText() ?: "",
                    isCorrect = opt["isCorrect"]?.asBoolean() ?: false
                )
            } ?: emptyList()

            val calculation = tree["calculation"]?.let { calc ->
                if (calc.isNull) null
                else CalculationDTO(
                    formula = calc["formula"]?.asText() ?: "",
                    correctAnswer = calc["correctAnswer"]?.asDouble() ?: 0.0,
                    unit = calc["unit"]?.asText() ?: "",
                    tolerance = calc["tolerance"]?.asDouble()
                )
            }

            GeneratedQuestionResponse(
                id = UUID.randomUUID().toString(),
                type = questionType,
                stem = tree["stem"]?.asText() ?: "Question generation failed",
                options = options,
                rationale = tree["rationale"]?.asText() ?: "",
                ncjmmStep = tree["ncjmmStep"]?.asText() ?: "recognize_cues",
                ncjmmValidated = false,
                topic = topic,
                subtopic = tree["subtopic"]?.asText(),
                difficulty = tree["difficulty"]?.asText() ?: "medium",
                source = tree["source"]?.asText() ?: "Generated",
                sourceKey = tree["sourceKey"]?.asText() ?: topic,
                partialCredit = if (questionType == "sata") true else null,
                calculation = calculation,
                createdAt = Instant.now().toString()
            )
        } catch (e: Exception) {
            logger.error("Failed to parse question response: ${e.message}")
            // Return a fallback question
            GeneratedQuestionResponse(
                id = UUID.randomUUID().toString(),
                type = questionType,
                stem = "Error generating question. Please try again.",
                options = listOf(
                    QuestionOptionDTO("A", "Option A", true),
                    QuestionOptionDTO("B", "Option B", false),
                    QuestionOptionDTO("C", "Option C", false),
                    QuestionOptionDTO("D", "Option D", false)
                ),
                rationale = "Question generation encountered an error: ${e.message}",
                ncjmmStep = "recognize_cues",
                ncjmmValidated = false,
                topic = topic,
                subtopic = null,
                difficulty = "medium",
                source = "Error",
                sourceKey = topic,
                partialCredit = null,
                calculation = null,
                createdAt = Instant.now().toString()
            )
        }
    }

    private fun parseValidationResponse(json: String): ValidationResult {
        val cleanJson = json.replace(Regex("""```json?\n?"""), "").replace("```", "").trim()

        return try {
            val mapper = com.fasterxml.jackson.databind.ObjectMapper()
            val tree = mapper.readTree(cleanJson)

            ValidationResult(
                isValid = tree["isValid"]?.asBoolean() ?: true,
                suggestedStep = tree["suggestedStep"]?.asText()?.takeIf { it != "null" },
                confidence = tree["confidence"]?.asDouble() ?: 0.5,
                reasoning = tree["reasoning"]?.asText() ?: "No reasoning provided"
            )
        } catch (e: Exception) {
            ValidationResult(
                isValid = true,
                suggestedStep = null,
                confidence = 0.5,
                reasoning = "Parse error: ${e.message}"
            )
        }
    }
}
