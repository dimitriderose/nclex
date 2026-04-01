package com.nclex.repository

import com.nclex.model.ExamSession
import com.nclex.model.ExamStatus
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface ExamSessionRepository : JpaRepository<ExamSession, UUID> {
    fun findByUserIdAndStatus(userId: UUID, status: ExamStatus): ExamSession?
    fun findByUserIdOrderByCreatedAtDesc(userId: UUID): List<ExamSession>
    fun countByUserId(userId: UUID): Long
}
