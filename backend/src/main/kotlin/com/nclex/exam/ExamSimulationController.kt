package com.nclex.exam

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
     */
    @PostMapping("/{id}/answer")
    fun submitAnswer(
        @AuthenticationPrincipal userId: UUID,
        @PathVariable id: UUID,
        @RequestBody request: AnswerRequest
    ): ResponseEntity<Any> {
        val result = examSimulationService.submitAnswer(userId, id, request)
        return ResponseEntity.ok(result)
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
    val questionId: String,
    val selectedAnswer: String,
    val timeSpentSeconds: Int = 0
)
