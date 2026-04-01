package com.nclex.repository

import com.nclex.model.QuestionReport
import com.nclex.model.ReportStatus
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface QuestionReportRepository : JpaRepository<QuestionReport, UUID> {
    fun findByStatus(status: ReportStatus, pageable: Pageable): Page<QuestionReport>
    fun findByUserId(userId: UUID): List<QuestionReport>
    fun countByStatus(status: ReportStatus): Long
}
