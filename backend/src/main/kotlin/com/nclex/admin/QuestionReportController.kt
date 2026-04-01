package com.nclex.admin

import com.nclex.model.QuestionReport
import com.nclex.repository.QuestionReportRepository
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.security.Principal
import java.util.UUID

/**
 * Public endpoint for users to submit question reports.
 * Report review is handled in AdminController.
 */
@RestController
@RequestMapping("/api/reports")
class QuestionReportController(
    private val questionReportRepository: QuestionReportRepository
) {

    @PostMapping
    fun submitReport(
        @RequestBody body: SubmitReportRequest,
        principal: Principal
    ): ResponseEntity<QuestionReport> {
        val report = QuestionReport(
            userId = UUID.fromString(principal.name),
            questionTopic = body.questionTopic,
            questionData = body.questionData,
            reportReason = body.reportReason,
            userNotes = body.userNotes
        )
        val saved = questionReportRepository.save(report)
        return ResponseEntity.ok(saved)
    }

    @GetMapping
    fun myReports(principal: Principal): ResponseEntity<List<QuestionReport>> {
        val reports = questionReportRepository.findByUserId(UUID.fromString(principal.name))
        return ResponseEntity.ok(reports)
    }
}

data class SubmitReportRequest(
    val questionTopic: String,
    val questionData: Map<String, Any>,
    val reportReason: String,
    val userNotes: String? = null
)
