package com.nclex.question

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/questions")
class QuestionGenerationController(
    private val questionGenerationService: QuestionGenerationService
) {
    @PostMapping("/generate")
    fun generateQuestion(
        @Valid @RequestBody body: GenerateRequest,
        request: HttpServletRequest
    ): ResponseEntity<GeneratedQuestionResponse> {
        val userId = request.getAttribute("userId") as String
        val question = questionGenerationService.generateQuestion(
            topic = body.topic,
            questionType = body.questionType,
            difficulty = body.difficulty ?: "medium",
            ncjmmStep = body.ncjmmStep,
            context = body.context,
            userId = userId
        )
        return ResponseEntity.ok(question)
    }

    @PostMapping("/generate/batch")
    fun generateBatch(
        @Valid @RequestBody body: BatchGenerateRequest,
        request: HttpServletRequest
    ): ResponseEntity<List<GeneratedQuestionResponse>> {
        val userId = request.getAttribute("userId") as String
        val questions = questionGenerationService.generateBatch(
            topics = body.topics,
            count = body.count,
            questionTypes = body.questionTypes,
            difficulty = body.difficulty ?: "medium",
            userId = userId
        )
        return ResponseEntity.ok(questions)
    }

    @PostMapping("/validate")
    fun validateQuestion(
        @RequestBody body: ValidateRequest,
        request: HttpServletRequest
    ): ResponseEntity<ValidationResult> {
        val result = questionGenerationService.validateNCJMMTag(
            questionStem = body.questionStem,
            assignedStep = body.assignedStep,
            rationale = body.rationale
        )
        return ResponseEntity.ok(result)
    }
}

data class GenerateRequest(
    @field:NotBlank val topic: String,
    val questionType: String = "mc",
    val difficulty: String? = "medium",
    val ncjmmStep: String? = null,
    val context: Map<String, Any>? = null
)

data class BatchGenerateRequest(
    val topics: List<String>,
    val count: Int = 5,
    val questionTypes: List<String> = listOf("mc"),
    val difficulty: String? = "medium"
)

data class ValidateRequest(
    val questionStem: String,
    val assignedStep: String,
    val rationale: String
)

data class GeneratedQuestionResponse(
    val id: String,
    val type: String,
    val stem: String,
    val options: List<QuestionOptionDTO>,
    val rationale: String,
    val ncjmmStep: String,
    val ncjmmValidated: Boolean,
    val topic: String,
    val subtopic: String?,
    val difficulty: String,
    val source: String,
    val sourceKey: String,
    val partialCredit: Boolean?,
    val calculation: CalculationDTO?,
    val createdAt: String
)

data class QuestionOptionDTO(
    val id: String,
    val text: String,
    val isCorrect: Boolean
)

data class CalculationDTO(
    val formula: String,
    val correctAnswer: Double,
    val unit: String,
    val tolerance: Double?
)

data class ValidationResult(
    val isValid: Boolean,
    val suggestedStep: String?,
    val confidence: Double,
    val reasoning: String
)
