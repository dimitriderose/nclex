package com.nclex.repository

import com.nclex.model.AuditLog
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface AuditLogRepository : JpaRepository<AuditLog, UUID> {
    fun findByUserIdOrderByCreatedAtDesc(userId: UUID): List<AuditLog>
    fun findByEventTypeOrderByCreatedAtDesc(eventType: String): List<AuditLog>

    @Query("""
        SELECT a FROM AuditLog a
        WHERE (:eventType IS NULL OR a.eventType = :eventType)
          AND (:userId IS NULL OR a.userId = :userId)
          AND a.createdAt BETWEEN :fromDate AND :toDate
        ORDER BY a.createdAt DESC
    """)
    fun findFiltered(
        eventType: String?,
        userId: UUID?,
        fromDate: Instant,
        toDate: Instant,
        pageable: Pageable
    ): Page<AuditLog>

    @Query("""
        SELECT a FROM AuditLog a
        WHERE (:eventType IS NULL OR a.eventType = :eventType)
          AND (:userId IS NULL OR a.userId = :userId)
          AND a.createdAt BETWEEN :fromDate AND :toDate
        ORDER BY a.createdAt DESC
    """)
    fun findAllFiltered(
        eventType: String?,
        userId: UUID?,
        fromDate: Instant,
        toDate: Instant
    ): List<AuditLog>

    fun countByEventTypeAndCreatedAtAfter(eventType: String, after: Instant): Long
}
