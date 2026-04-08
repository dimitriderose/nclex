package com.nclex.admin

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.security.Principal
import java.time.Instant
import java.util.UUID

class AdminControllerTest {

    private val adminService: AdminService = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val principal: Principal = mockk()

    private lateinit var controller: AdminController
    private val adminId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = AdminController(adminService, auditLogger)
        every { principal.name } returns adminId.toString()
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
    }

    // ── listUsers ──────────────────────────────────────────────────

    @Nested
    inner class ListUsers {

        @Test
        fun `returns paginated users`() {
            val result = mapOf<String, Any>("users" to emptyList<Any>(), "totalElements" to 0L)
            every { adminService.listUsers(null, 0, 25) } returns result

            val response = controller.listUsers(null, 0, 25)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body).isEqualTo(result)
        }

        @Test
        fun `with search param passes to service`() {
            val result = mapOf<String, Any>("users" to emptyList<Any>(), "totalElements" to 0L)
            every { adminService.listUsers("admin", 1, 10) } returns result

            val response = controller.listUsers("admin", 1, 10)

            assertThat(response.statusCode.value()).isEqualTo(200)
            verify { adminService.listUsers("admin", 1, 10) }
        }
    }

    // ── getUser ────────────────────────────────────────────────────

    @Nested
    inner class GetUser {

        @Test
        fun `returns user detail`() {
            val userId = UUID.randomUUID()
            val dto = AdminUserDto(userId, "test@test.com", "USER", Instant.now(), Instant.now(), null, null, 10, 75.0)
            every { adminService.getUserDetail(userId) } returns dto

            val response = controller.getUser(userId)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!.email).isEqualTo("test@test.com")
        }
    }

    // ── updateUserRole ─────────────────────────────────────────────

    @Nested
    inner class UpdateUserRole {

        @Test
        fun `updates role and logs audit`() {
            val userId = UUID.randomUUID()
            val dto = AdminUserDto(userId, "test@test.com", "ADMIN", Instant.now(), Instant.now(), null, null, 0, 0.0)
            every { adminService.updateRole(userId, "ADMIN") } returns dto

            val response = controller.updateUserRole(userId, RoleUpdateRequest("ADMIN"), principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!.role).isEqualTo("ADMIN")
            verify {
                auditLogger.log(
                    eventType = "ADMIN_ROLE_CHANGE",
                    userId = userId,
                    actorId = adminId,
                    metadata = mapOf("newRole" to "ADMIN")
                )
            }
        }
    }

    // ── softDeleteUser ─────────────────────────────────────────────

    @Nested
    inner class SoftDeleteUser {

        @Test
        fun `soft deletes and logs audit`() {
            val userId = UUID.randomUUID()
            every { adminService.softDeleteUser(userId) } just Runs

            val response = controller.softDeleteUser(userId, principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!["status"]).isEqualTo("soft_deleted")
            verify { auditLogger.log(eventType = "ADMIN_SOFT_DELETE", userId = userId, actorId = adminId) }
        }
    }

    // ── hardDeleteUser ─────────────────────────────────────────────

    @Nested
    inner class HardDeleteUser {

        @Test
        fun `confirmed hard delete succeeds`() {
            val userId = UUID.randomUUID()
            every { adminService.hardDeleteUser(userId) } just Runs

            val response = controller.hardDeleteUser(userId, true, principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!["status"]).isEqualTo("deleted")
            verify { adminService.hardDeleteUser(userId) }
            verify { auditLogger.log(eventType = "ADMIN_HARD_DELETE", userId = userId, actorId = adminId) }
        }

        @Test
        fun `unconfirmed hard delete returns 400`() {
            val userId = UUID.randomUUID()

            val response = controller.hardDeleteUser(userId, false, principal)

            assertThat(response.statusCode.value()).isEqualTo(400)
            assertThat(response.body!!["error"]).contains("confirm=true")
            verify(exactly = 0) { adminService.hardDeleteUser(any()) }
        }
    }

    // ── getAuditLog ────────────────────────────────────────────────

    @Nested
    inner class GetAuditLog {

        @Test
        fun `passes all params to service`() {
            val userId = UUID.randomUUID()
            val from = Instant.now().minusSeconds(3600)
            val to = Instant.now()
            val result = mapOf<String, Any>("logs" to emptyList<Any>(), "totalElements" to 0L)
            every { adminService.getAuditLog("TEST", userId, from, to, 0, 50) } returns result

            val response = controller.getAuditLog("TEST", userId, from, to, 0, 50)

            assertThat(response.statusCode.value()).isEqualTo(200)
        }

        @Test
        fun `null params work`() {
            val result = mapOf<String, Any>("logs" to emptyList<Any>(), "totalElements" to 0L)
            every { adminService.getAuditLog(null, null, null, null, 0, 50) } returns result

            val response = controller.getAuditLog(null, null, null, null, 0, 50)

            assertThat(response.statusCode.value()).isEqualTo(200)
        }
    }

    // ── exportAuditLog ─────────────────────────────────────────────

    @Nested
    inner class ExportAuditLog {

        @Test
        fun `returns CSV with correct headers`() {
            every { adminService.exportAuditLogCsv(null, null, null, null) } returns "id,event_type\n1,TEST\n"

            val response = controller.exportAuditLog(null, null, null, null)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.headers["Content-Disposition"]!![0]).contains("audit_log.csv")
            assertThat(response.headers.contentType?.toString()).contains("text/csv")
        }
    }

    // ── getReports ─────────────────────────────────────────────────

    @Nested
    inner class GetReports {

        @Test
        fun `returns paginated reports`() {
            val result = mapOf<String, Any>("reports" to emptyList<Any>(), "totalElements" to 0L)
            every { adminService.getReports("PENDING", 0, 25) } returns result

            val response = controller.getReports("PENDING", 0, 25)

            assertThat(response.statusCode.value()).isEqualTo(200)
        }
    }

    // ── updateReport ───────────────────────────────────────────────

    @Nested
    inner class UpdateReport {

        @Test
        fun `updates report and logs audit`() {
            val reportId = UUID.randomUUID()
            val result = mapOf<String, Any>("report" to "data", "status" to "updated")
            every { adminService.updateReport(reportId, "REVIEWED", "Notes") } returns result

            val response = controller.updateReport(reportId, ReportUpdateRequest("REVIEWED", "Notes"), principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            verify {
                auditLogger.log(
                    eventType = "ADMIN_REPORT_REVIEW",
                    actorId = adminId,
                    metadata = match { it["reportId"] == reportId.toString() && it["status"] == "REVIEWED" }
                )
            }
        }
    }

    // ── getContentCacheStatus ──────────────────────────────────────

    @Nested
    inner class GetContentCacheStatus {

        @Test
        fun `returns cache status list`() {
            val statuses = listOf(
                ContentCacheStatusDto("fda", 10, 2, Instant.now(), null, null)
            )
            every { adminService.getContentCacheStatus() } returns statuses

            val response = controller.getContentCacheStatus()

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body).hasSize(1)
        }
    }

    // ── triggerCacheRefresh ────────────────────────────────────────

    @Nested
    inner class TriggerCacheRefresh {

        @Test
        fun `with source triggers and logs`() {
            every { adminService.triggerCacheRefresh("fda_labels") } just Runs

            val response = controller.triggerCacheRefresh("fda_labels", principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!["status"]).isEqualTo("refresh_triggered")
            verify {
                auditLogger.log(
                    eventType = "ADMIN_CACHE_REFRESH",
                    actorId = adminId,
                    metadata = mapOf("source" to "fda_labels")
                )
            }
        }

        @Test
        fun `null source triggers all and logs`() {
            every { adminService.triggerCacheRefresh(null) } just Runs

            val response = controller.triggerCacheRefresh(null, principal)

            assertThat(response.statusCode.value()).isEqualTo(200)
            verify {
                auditLogger.log(
                    eventType = "ADMIN_CACHE_REFRESH",
                    actorId = adminId,
                    metadata = mapOf("source" to "all")
                )
            }
        }
    }

    // ── getKpis ────────────────────────────────────────────────────

    @Nested
    inner class GetKpis {

        @Test
        fun `returns KPI dto`() {
            val kpi = KpiDto(100, 25, 200, 50, 3, 5, 10, 72.5, 2, 1, 4)
            every { adminService.getKpis() } returns kpi

            val response = controller.getKpis()

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body!!.totalUsers).isEqualTo(100)
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `RoleUpdateRequest`() {
            val req = RoleUpdateRequest("ADMIN")
            assertThat(req.role).isEqualTo("ADMIN")
        }

        @Test
        fun `ReportUpdateRequest defaults`() {
            val req = ReportUpdateRequest("REVIEWED")
            assertThat(req.reviewNotes).isNull()
        }

        @Test
        fun `ContentCacheStatusDto`() {
            val dto = ContentCacheStatusDto("src", 10, 2, null, null, null)
            assertThat(dto.source).isEqualTo("src")
            assertThat(dto.lastIndexedAt).isNull()
        }

        @Test
        fun `KpiDto`() {
            val dto = KpiDto(1, 2, 3, 4, 5, 6, 7, 8.0, 9, 10, 11)
            assertThat(dto.totalUsers).isEqualTo(1)
            assertThat(dto.externalServiceErrorsToday).isEqualTo(11)
        }

        @Test
        fun `AdminUserDto`() {
            val now = Instant.now()
            val dto = AdminUserDto(UUID.randomUUID(), "e@e.com", "USER", now, now, null, null, 5, 50.0)
            assertThat(dto.email).isEqualTo("e@e.com")
            assertThat(dto.deletionRequestedAt).isNull()
        }
    }
}
