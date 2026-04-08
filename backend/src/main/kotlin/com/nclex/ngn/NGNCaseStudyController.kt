package com.nclex.ngn

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/ngn")
class NGNCaseStudyController(
    private val ngnCaseStudyService: NGNCaseStudyService
) {
    @PostMapping("/generate")
    fun generateCaseStudy(
        @Valid @RequestBody body: GenerateCaseRequest,
        request: HttpServletRequest
    ): ResponseEntity<CaseStudyResponse> {
        val userId = request.getAttribute("userId")?.toString()
            ?: throw IllegalStateException("Missing userId")
        val caseStudy = ngnCaseStudyService.generateCaseStudy(
            topic = body.topic,
            questionTypes = body.questionTypes ?: listOf("bow_tie", "matrix_multiple_choice"),
            difficulty = body.difficulty ?: "medium",
            userId = userId
        )
        return ResponseEntity.ok(caseStudy)
    }

    @PostMapping("/validate")
    fun validateCaseStudy(
        @RequestBody body: ValidateCaseRequest,
        request: HttpServletRequest
    ): ResponseEntity<SafetyValidationResult> {
        val result = ngnCaseStudyService.safetyValidate(body.caseStudy)
        return ResponseEntity.ok(result)
    }

    @GetMapping("/templates")
    fun getTemplates(): ResponseEntity<List<CaseTemplateInfo>> {
        return ResponseEntity.ok(ngnCaseStudyService.getAvailableTemplates())
    }

    @GetMapping("/types")
    fun getQuestionTypes(): ResponseEntity<List<NGNTypeInfo>> {
        return ResponseEntity.ok(NGN_QUESTION_TYPES)
    }
}

data class GenerateCaseRequest(
    @field:NotBlank val topic: String,
    val questionTypes: List<String>? = null,
    val difficulty: String? = "medium"
)

data class ValidateCaseRequest(
    val caseStudy: CaseStudyResponse
)

data class CaseStudyResponse(
    val id: String,
    val title: String,
    val scenario: String,
    val tabs: List<CaseTabDTO>,
    val questions: List<CaseQuestionDTO>,
    val topic: String,
    val source: String,
    val safetyValidated: Boolean,
    val createdAt: String
)

data class CaseTabDTO(
    val id: String,
    val label: String,
    val content: String,
    val type: String
)

data class CaseQuestionDTO(
    val id: String,
    val type: String,
    val prompt: String,
    val data: Map<String, Any>,
    val correctAnswer: Any?,
    val rationale: String,
    val ncjmmStep: String,
    val maxScore: Int
)

data class SafetyValidationResult(
    val safe: Boolean,
    val issues: List<String>,
    val confidence: Double,
    val recommendation: String
)

data class CaseTemplateInfo(
    val id: String,
    val title: String,
    val topic: String,
    val questionTypes: List<String>
)

data class NGNTypeInfo(
    val type: String,
    val label: String,
    val description: String
)

val NGN_QUESTION_TYPES = listOf(
    NGNTypeInfo("matrix_multiple_choice", "Matrix Multiple Choice", "Select one answer per row in a matrix"),
    NGNTypeInfo("matrix_multiple_response", "Matrix Multiple Response", "Select multiple answers per row in a matrix"),
    NGNTypeInfo("multiple_response_grouping", "Multiple Response Grouping", "Group items into categories"),
    NGNTypeInfo("cloze_drop_down", "Cloze Drop-Down", "Fill in blanks using drop-down menus"),
    NGNTypeInfo("enhanced_hot_spot", "Enhanced Hot Spot", "Click on relevant areas of an image or table"),
    NGNTypeInfo("bow_tie", "Bow-Tie", "Connect conditions, actions, and parameters"),
    NGNTypeInfo("trend", "Trend", "Identify trends in sequential data"),
    NGNTypeInfo("drag_and_drop_cloze", "Drag & Drop Cloze", "Drag items into blanks in text"),
    NGNTypeInfo("drag_and_drop_rationale", "Drag & Drop Rationale", "Drag rationale items to match actions"),
    NGNTypeInfo("drop_down_cloze", "Drop-Down Cloze", "Select from drop-down in sentence context"),
    NGNTypeInfo("drop_down_rationale", "Drop-Down Rationale", "Select rationale from drop-downs"),
    NGNTypeInfo("drop_down_table", "Drop-Down Table", "Complete a table using drop-down selections"),
    NGNTypeInfo("highlight_text", "Highlight Text", "Highlight relevant portions of text"),
    NGNTypeInfo("highlight_table", "Highlight Table", "Highlight relevant cells in a table")
)
