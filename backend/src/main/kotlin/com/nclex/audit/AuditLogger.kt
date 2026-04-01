package com.nclex.audit

import com.nclex.model.AuditLog
import com.nclex.repository.AuditLogRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * Centralized audit logging utility.
 * Wraps AuditLogRepository with convenience methods for structured logging.
 */
@Component
class AuditLogger(
    private val auditLogRepository: AuditLogRepository
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun log(
        eventType: String,
        userId: UUID? = null,
        actorId: UUID? = null,
        ipAddress: String? = null,
        metadata: Map<String, Any> = emptyMap()
    ): AuditLog {
        val auditLog = AuditLog(
            eventType = eventType,
            userId = userId,
            actorId = actorId,
            ipAddress = ipAddress,
            metadata = metadata
        )
        return runCatching {
            auditLogRepository.save(auditLog)
        }.onFailure { ex ->
            // Never let audit logging failures break the main flow
            logger.error("Failed to write audit log [{}]: {}", eventType, ex.message)
        }.getOrDefault(auditLog)
    }

    fun logUserAction(
        eventType: String,
        userId: UUID,
        ipAddress: String? = null,
        metadata: Map<String, Any> = emptyMap()
    ): AuditLog = log(
        eventType = eventType,
        userId = userId,
        actorId = userId,
        ipAddress = ipAddress,
        metadata = metadata
    )

    fun logAdminAction(
        eventType: String,
        actorId: UUID,
        targetUserId: UUID? = null,
        ipAddress: String? = null,
        metadata: Map<String, Any> = emptyMap()
    ): AuditLog = log(
        eventType = eventType,
        userId = targetUserId,
        actorId = actorId,
        ipAddress = ipAddress,
        metadata = metadata
    )

    fun logSystemEvent(
        eventType: String,
        metadata: Map<String, Any> = emptyMap()
    ): AuditLog = log(
        eventType = eventType,
        metadata = metadata
    )
}
