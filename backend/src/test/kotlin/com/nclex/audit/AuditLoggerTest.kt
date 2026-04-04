package com.nclex.audit

import com.nclex.model.AuditLog
import com.nclex.repository.AuditLogRepository
import io.mockk.*
import io.mockk.impl.annotations.MockK
import io.mockk.junit5.MockKExtension
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import java.util.UUID

@ExtendWith(MockKExtension::class)
class AuditLoggerTest {

    @MockK
    private lateinit var auditLogRepository: AuditLogRepository

    private lateinit var auditLogger: AuditLogger

    @BeforeEach
    fun setUp() {
        auditLogger = AuditLogger(auditLogRepository)
    }

    // -- log() --

    @Test
    fun `log saves to repository and returns saved AuditLog`() {
        val savedLog = AuditLog(eventType = "LOGIN")
        every { auditLogRepository.save(any()) } returns savedLog

        val result = auditLogger.log(eventType = "LOGIN")

        assertThat(result).isSameAs(savedLog)
        verify(exactly = 1) { auditLogRepository.save(match { it.eventType == "LOGIN" }) }
    }

    @Test
    fun `log with all optional params passes them through`() {
        val userId = UUID.randomUUID()
        val actorId = UUID.randomUUID()
        val metadata = mapOf<String, Any>("key" to "value", "count" to 42)

        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.log(
            eventType = "ADMIN_ACTION",
            userId = userId,
            actorId = actorId,
            ipAddress = "10.0.0.1",
            metadata = metadata
        )

        assertThat(result.eventType).isEqualTo("ADMIN_ACTION")
        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.actorId).isEqualTo(actorId)
        assertThat(result.ipAddress).isEqualTo("10.0.0.1")
        assertThat(result.metadata).isEqualTo(metadata)
    }

    @Test
    fun `log with default optional params uses nulls and empty map`() {
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.log(eventType = "SYSTEM")

        assertThat(result.userId).isNull()
        assertThat(result.actorId).isNull()
        assertThat(result.ipAddress).isNull()
        assertThat(result.metadata).isEmpty()
    }

    @Test
    fun `log when save throws exception catches it and returns default AuditLog`() {
        every { auditLogRepository.save(any()) } throws RuntimeException("DB down")

        val result = auditLogger.log(eventType = "TEST_EVENT")

        // Should not throw; returns the default (the original unsaved AuditLog)
        assertThat(result).isNotNull
        assertThat(result.eventType).isEqualTo("TEST_EVENT")
    }

    @Test
    fun `log when save throws does not rethrow`() {
        every { auditLogRepository.save(any()) } throws RuntimeException("DB error")

        // Should complete without exception
        val result = auditLogger.log(eventType = "FAIL_SAFE")
        assertThat(result.eventType).isEqualTo("FAIL_SAFE")
    }

    // -- logUserAction --

    @Test
    fun `logUserAction sets userId and actorId to same value`() {
        val userId = UUID.randomUUID()
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logUserAction(
            eventType = "USER_ACTION",
            userId = userId,
            ipAddress = "1.2.3.4",
            metadata = mapOf("action" to "click")
        )

        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.actorId).isEqualTo(userId)
        assertThat(result.ipAddress).isEqualTo("1.2.3.4")
        assertThat(result.metadata).containsEntry("action", "click")
    }

    @Test
    fun `logUserAction with defaults`() {
        val userId = UUID.randomUUID()
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logUserAction(eventType = "VIEW", userId = userId)

        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.actorId).isEqualTo(userId)
        assertThat(result.ipAddress).isNull()
        assertThat(result.metadata).isEmpty()
    }

    // -- logAdminAction --

    @Test
    fun `logAdminAction passes targetUserId as userId`() {
        val actorId = UUID.randomUUID()
        val targetUserId = UUID.randomUUID()
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logAdminAction(
            eventType = "ADMIN_BAN",
            actorId = actorId,
            targetUserId = targetUserId,
            ipAddress = "10.0.0.5",
            metadata = mapOf("reason" to "spam")
        )

        assertThat(result.userId).isEqualTo(targetUserId)
        assertThat(result.actorId).isEqualTo(actorId)
        assertThat(result.ipAddress).isEqualTo("10.0.0.5")
    }

    @Test
    fun `logAdminAction with null targetUserId`() {
        val actorId = UUID.randomUUID()
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logAdminAction(
            eventType = "ADMIN_CONFIG",
            actorId = actorId
        )

        assertThat(result.userId).isNull()
        assertThat(result.actorId).isEqualTo(actorId)
    }

    // -- logSystemEvent --

    @Test
    fun `logSystemEvent has no userId or actorId`() {
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logSystemEvent(
            eventType = "CRON_JOB",
            metadata = mapOf("job" to "cleanup")
        )

        assertThat(result.userId).isNull()
        assertThat(result.actorId).isNull()
        assertThat(result.eventType).isEqualTo("CRON_JOB")
        assertThat(result.metadata).containsEntry("job", "cleanup")
    }

    @Test
    fun `logSystemEvent with default metadata`() {
        every { auditLogRepository.save(any()) } answers { firstArg() }

        val result = auditLogger.logSystemEvent(eventType = "STARTUP")

        assertThat(result.metadata).isEmpty()
    }
}
