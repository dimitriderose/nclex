package com.nclex.question

import com.nclex.config.extractUserId
import com.nclex.exception.NotFoundException
import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
import com.nclex.model.GeneratedQuestion
import com.nclex.model.QuestionAttempt
import com.nclex.repository.FlaggedQuestionRepository
import com.nclex.repository.GeneratedQuestionRepository
import com.nclex.repository.QuestionAttemptRepository
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.Size
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.util.UUID

@RestController
@RequestMapping("/api/questions")
class QuestionGenerationController(
    private val questionGenerationService: QuestionGenerationService,
    private val questionBankService: QuestionBankService,
    private val generatedQuestionRepository: GeneratedQuestionRepository,
    private val questionAttemptRepository: QuestionAttemptRepository,
    private val flaggedQuestionRepository: FlaggedQuestionRepository
) {
    /**
     * Bank-first single-question fetch (Phase 1): delegates to [QuestionBankService] so
     * results are durable/reusable rather than throwaway HTTP responses. Falls back to a
     * direct Claude call only if the bank service can't satisfy even one question (e.g.
     * generation failure on a cold topic) — mirrors generateBatch's "may return fewer than
     * requested" contract by guaranteeing this endpoint still returns exactly one.
     */
    @PostMapping("/generate")
    fun generateQuestion(
        @Valid @RequestBody body: GenerateRequest,
        request: HttpServletRequest
    ): ResponseEntity<GeneratedQuestionResponse> {
        val userId = extractUserId(request)
        val difficulty = body.difficulty ?: "medium"
        val fromBank = questionBankService.getQuestions(
            topic = body.topic,
            questionType = body.questionType,
            difficulty = difficulty,
            userId = userId,
            count = 1
        )
        val question = fromBank.firstOrNull() ?: questionGenerationService.generateQuestion(
            topic = body.topic,
            questionType = body.questionType,
            difficulty = difficulty,
            ncjmmStep = body.ncjmmStep,
            context = body.context,
            userId = userId.toString()
        )
        return ResponseEntity.ok(question)
    }

    /**
     * Bank-first batch fetch (Phase 1): same orchestration as [generateQuestion], one
     * [QuestionBankService.getQuestions] call per (topic, questionType) pairing so each
     * pairing gets its own bank-first lookup + shortfall generation, mirroring how
     * [QuestionGenerationService.generateBatch] cycled topics/types per index.
     */
    @PostMapping("/generate/batch")
    fun generateBatch(
        @Valid @RequestBody body: BatchGenerateRequest,
        request: HttpServletRequest
    ): ResponseEntity<List<GeneratedQuestionResponse>> {
        val userId = extractUserId(request)
        val difficulty = body.difficulty ?: "medium"
        val effectiveCount = body.count.coerceAtMost(20)

        val questions = mutableListOf<GeneratedQuestionResponse>()
        var i = 0
        while (i < effectiveCount) {
            val topic = body.topics[i % body.topics.size]
            val qType = body.questionTypes[i % body.questionTypes.size]
            // Group consecutive indices that share the same (topic, type) into one bank
            // request so the ~70% cap and bank lookup operate on a meaningful batch size
            // rather than degenerating into N single-question calls.
            var groupSize = 1
            while (i + groupSize < effectiveCount &&
                body.topics[(i + groupSize) % body.topics.size] == topic &&
                body.questionTypes[(i + groupSize) % body.questionTypes.size] == qType
            ) {
                groupSize++
            }
            questions.addAll(
                questionBankService.getQuestions(
                    topic = topic,
                    questionType = qType,
                    difficulty = difficulty,
                    userId = userId,
                    count = groupSize
                )
            )
            i += groupSize
        }

        return ResponseEntity.ok(questions)
    }

    @PostMapping("/validate")
    fun validateQuestion(
        @Valid @RequestBody body: ValidateRequest,
        request: HttpServletRequest
    ): ResponseEntity<ValidationResult> {
        val result = questionGenerationService.validateNCJMMTag(
            questionStem = body.questionStem,
            assignedStep = body.assignedStep,
            rationale = body.rationale
        )
        return ResponseEntity.ok(result)
    }

    /**
     * POST /api/questions/{id}/attempt — records a per-user attempt against a bank question
     * (Phase 4: "record every attempt in question_attempts"). `id` must reference an existing
     * `generated_questions` row (FK constraint) — 404 if it doesn't, so a stale/placeholder
     * id can't silently create an orphaned attempt row.
     *
     * Also implements Phase 4's "when the answer is incorrect, auto-create a
     * `flagged_questions` entry with `category = WRONG` linked via `question_id`" — the
     * frontend (question-service.ts: recordAttempt doc) deliberately does NOT duplicate this
     * logic client-side ("the client doesn't need to duplicate that logic"), so it must live
     * here for the contract to actually be fulfilled end to end.
     */
    @PostMapping("/{id}/attempt")
    @Transactional
    fun recordAttempt(
        @PathVariable id: UUID,
        @Valid @RequestBody body: RecordAttemptRequest,
        request: HttpServletRequest
    ): ResponseEntity<Map<String, Any>> {
        val userId = extractUserId(request)
        val question = generatedQuestionRepository.findById(id)
            .orElseThrow { NotFoundException("Question not found: $id") }
        val attempt = questionAttemptRepository.save(
            QuestionAttempt(
                userId = userId,
                questionId = id,
                correct = body.correct,
                source = body.source ?: "practice"
            )
        )

        if (!body.correct) {
            autoFlagWrongAnswer(userId, question)
        }

        return ResponseEntity.status(201).body(
            mapOf(
                "id" to attempt.id,
                "questionId" to attempt.questionId,
                "correct" to attempt.correct,
                "source" to attempt.source,
                "attemptedAt" to attempt.attemptedAt.toString()
            )
        )
    }

    /**
     * Auto-creates a WRONG-category flag linked via question_id when the user misses a
     * bank question — feeds "questions that gave you trouble" directly into the existing,
     * tested ReviewQueue/SM-2 flow (plan's Phase 4) rather than building a parallel feature.
     * Idempotent per (user, question): skips creation if a WRONG flag for this question
     * already exists, so repeatedly missing the same question doesn't spam duplicate rows
     * (SM-2's repetitionCount/easinessFactor already capture "keeps getting this wrong").
     */
    private fun autoFlagWrongAnswer(userId: UUID, question: GeneratedQuestion) {
        if (flaggedQuestionRepository.existsByUserIdAndQuestionIdAndCategory(userId, question.id, FlagCategory.WRONG)) {
            return
        }
        flaggedQuestionRepository.save(
            FlaggedQuestion(
                userId = userId,
                topic = question.topic,
                question = mapOf(
                    "stem" to question.stem,
                    "options" to question.options,
                    "rationale" to question.rationale,
                    "type" to question.questionType,
                    "difficulty" to question.difficulty
                ),
                category = FlagCategory.WRONG,
                questionId = question.id
            )
        )
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
    @field:Size(min = 1, message = "At least one topic is required")
    val topics: List<String>,
    @field:Min(1, message = "count must be >= 1")
    @field:Max(20, message = "count must be <= 20")
    val count: Int = 5,
    val questionTypes: List<String> = listOf("mc"),
    val difficulty: String? = "medium"
)

data class RecordAttemptRequest(
    val correct: Boolean,
    // Discriminator so practice/exam history stay queryable from one table (plan's
    // "Coordination with issue #22") — defaults to "practice" since this endpoint's
    // primary caller is Practice mode; exam attempts are written server-side by
    // ExamSimulationService with source = "exam".
    val source: String? = "practice"
)

data class ValidateRequest(
    @field:NotBlank(message = "questionStem is required")
    val questionStem: String,
    @field:NotBlank(message = "assignedStep is required")
    val assignedStep: String,
    @field:NotBlank(message = "rationale is required")
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
