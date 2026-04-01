package com.nclex.repository

import com.nclex.model.AuditLog
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface AuditLogRepository : JpaRepository<AuditLog, UUID> {
    fun findByUserIdOrderByCreatedAtDesc(userId: UUID): List<AuditLog>
    fun findByEventTypeOrderByCreatedAtDesc(eventType: String): List<AuditLog>
}
