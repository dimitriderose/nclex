package com.nclex.audit

import com.nclex.model.AuditLog
import com.nclex.repository.AuditLogRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Component
import java.util.UUID

@Component
class AuditLogger(
    private val auditLogRepository: AuditLogRepository
) {

    private val logger = LoggerFactory.getLogger(javaClass)

    @Async
    fun log(
        eventType: String,
        userId: UUID? = null,
        actorId: UUID? = null,
        metadata: Map<String, Any> = emptyMap(),
        ip: String? = null
    ) {
        try {
            auditLogRepository.save(
                AuditLog(
                    eventType = eventType,
                    userId = userId,
                    actorId = actorId ?: userId,
                    metadata = metadata,
                    ipAddress = ip
                )
            )
            logger.info("AUDIT [{}] user={} actor={} meta={}", eventType, userId, actorId ?: userId, metadata)
        } catch (e: Exception) {
            logger.error("Failed to write audit log: {} - {}", eventType, e.message)
        }
    }
}
