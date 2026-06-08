package com.nclex.exam

import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Min
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import java.util.UUID

@RestController
@RequestMapping("/api/exam")
class ExamSimulationController(
    private val examSimulationService: ExamSimulationService
) {
    /**
     * POST /api/exam/start
     * Start a new timed exam simulation.
     */
    @PostMapping("/start")
    fun startExam(
        @AuthenticationPrincipal userId: UUID
    ): ResponseEntity<Any> {
        val session = examSimulationService.startExam(userId)
        return ResponseEntity.ok(mapOf(
            "sessionId" to session.id,
            "status" to session.status.name,
            "timeLimitMinutes" to session.timeLimitMinutes,
            "currentQuestion" to examSimulationService.getNextQuestion(session),
            "totalQuestions" to session.totalQuestions,
            "currentDifficulty" to session.currentDifficulty
        ))
    }

    /**
     * POST /api/exam/{id}/answer
     * Submit an answer to the current question.
     *
     * Two-step orchestration (Architect "Transaction boundaries" finding): submitAnswer
     * grades + persists everything in one short @Transactional and returns without a
     * `nextQuestion` when the exam continues; getNextQuestionForSession is then called
     * separately, *after* that transaction has committed, because it can fall through to
     * a multi-second blocking Claude call on a cold bank — which must never run while a
     * grading transaction holds a DB connection open. See ExamSimulationService.submitAnswer's
     * doc for the full reasoning.
     */
    @PostMapping("/{id}/answer")
    fun submitAnswer(
        @AuthenticationPrincipal userId: UUID,
        @PathVariable id: UUID,
        @Valid @RequestBody request: AnswerRequest
    ): ResponseEntity<Any> {
        val result = examSimulationService.submitAnswer(userId, id, request)
        val examContinues = result["examContinues"] as? Boolean ?: false
        val response = if (examContinues) {
            result + ("nextQuestion" to examSimulationService.getNextQuestionForSession(userId, id))
        } else {
            result
        }
        return ResponseEntity.ok(response)
    }

    /**
     * POST /api/exam/{id}/finish
     * Finish the exam (early stop or normal completion).
     */
    @PostMapping("/{id}/finish")
    fun finishExam(
        @AuthenticationPrincipal userId: UUID,
        @PathVariable id: UUID
    ): ResponseEntity<Any> {
        val results = examSimulationService.finishExam(userId, id)
        return ResponseEntity.ok(results)
    }

    /**
     * GET /api/exam/{id}
     * Get current exam state.
     */
    @GetMapping("/{id}")
    fun getExamState(
        @AuthenticationPrincipal userId: UUID,
        @PathVariable id: UUID
    ): ResponseEntity<Any> {
        val state = examSimulationService.getExamState(userId, id)
        return ResponseEntity.ok(state)
    }

    /**
     * GET /api/exam/history
     * Get all past exam sessions.
     */
    @GetMapping("/history")
    fun getExamHistory(
        @AuthenticationPrincipal userId: UUID
    ): ResponseEntity<Any> {
        val sessions = examSimulationService.getExamHistory(userId)
        return ResponseEntity.ok(sessions)
    }
}

data class AnswerRequest(
    @field:NotBlank(message = "questionId is required")
    val questionId: String,
    @field:NotBlank(message = "selectedAnswer is required")
    val selectedAnswer: String,
    @field:Min(0, message = "timeSpentSeconds must be >= 0")
    val timeSpentSeconds: Int = 0
)
