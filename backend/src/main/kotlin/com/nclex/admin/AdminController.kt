package com.nclex.admin

import com.nclex.audit.AuditLogger
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.*
import java.security.Principal
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
class AdminController(
    private val adminService: AdminService,
    private val auditLogger: AuditLogger
) {

    // ── User Management ──────────────────────────────────────────────

    @GetMapping("/users")
    fun listUsers(
        @RequestParam(required = false) @Size(max = 100, message = "Search must be at most 100 characters") search: String?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "25") size: Int
    ): ResponseEntity<Map<String, Any>> {
        val result = adminService.listUsers(search, page, size)
        return ResponseEntity.ok(result)
    }

    @GetMapping("/users/{userId}")
    fun getUser(@PathVariable userId: UUID): ResponseEntity<AdminUserDto> {
        val user = adminService.getUserDetail(userId)
        return ResponseEntity.ok(user)
    }

    @PatchMapping("/users/{userId}/role")
    fun updateUserRole(
        @PathVariable userId: UUID,
        @Valid @RequestBody body: RoleUpdateRequest,
        principal: Principal
    ): ResponseEntity<AdminUserDto> {
        val updated = adminService.updateRole(userId, body.role)
        auditLogger.log(
            eventType = "ADMIN_ROLE_CHANGE",
            userId = userId,
            actorId = UUID.fromString(principal.name),
            metadata = mapOf("newRole" to body.role)
        )
        return ResponseEntity.ok(updated)
    }

    @PostMapping("/users/{userId}/soft-delete")
    fun softDeleteUser(
        @PathVariable userId: UUID,
        principal: Principal
    ): ResponseEntity<Map<String, String>> {
        adminService.softDeleteUser(userId)
        auditLogger.log(
            eventType = "ADMIN_SOFT_DELETE",
            userId = userId,
            actorId = UUID.fromString(principal.name)
        )
        return ResponseEntity.ok(mapOf("status" to "soft_deleted"))
    }

    @DeleteMapping("/users/{userId}")
    fun hardDeleteUser(
        @PathVariable userId: UUID,
        @RequestParam confirm: Boolean,
        principal: Principal
    ): ResponseEntity<Map<String, String>> {
        if (!confirm) {
            return ResponseEntity.badRequest().body(mapOf("error" to "Must confirm=true to hard delete"))
        }
        adminService.hardDeleteUser(userId)
        auditLogger.log(
            eventType = "ADMIN_HARD_DELETE",
            userId = userId,
            actorId = UUID.fromString(principal.name)
        )
        return ResponseEntity.ok(mapOf("status" to "deleted"))
    }

    // ── Audit Log ────────────────────────────────────────────────────

    @GetMapping("/audit-log")
    fun getAuditLog(
        @RequestParam(required = false) eventType: String?,
        @RequestParam(required = false) userId: UUID?,
        @RequestParam(required = false) from: Instant?,
        @RequestParam(required = false) to: Instant?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") size: Int
    ): ResponseEntity<Map<String, Any>> {
        val result = adminService.getAuditLog(eventType, userId, from, to, page, size)
        return ResponseEntity.ok(result)
    }

    @GetMapping("/audit-log/export")
    fun exportAuditLog(
        @RequestParam(required = false) eventType: String?,
        @RequestParam(required = false) userId: UUID?,
        @RequestParam(required = false) from: Instant?,
        @RequestParam(required = false) to: Instant?
    ): ResponseEntity<ByteArray> {
        val csv = adminService.exportAuditLogCsv(eventType, userId, from, to)
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=audit_log.csv")
            .contentType(MediaType.parseMediaType("text/csv"))
            .body(csv.toByteArray())
    }

    // ── Question Reports ─────────────────────────────────────────────

    @GetMapping("/reports")
    fun getReports(
        @RequestParam(defaultValue = "PENDING") status: String,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "25") size: Int
    ): ResponseEntity<Map<String, Any>> {
        val result = adminService.getReports(status, page, size)
        return ResponseEntity.ok(result)
    }

    @PatchMapping("/reports/{reportId}")
    fun updateReport(
        @PathVariable reportId: UUID,
        @Valid @RequestBody body: ReportUpdateRequest,
        principal: Principal
    ): ResponseEntity<Map<String, Any>> {
        val updated = adminService.updateReport(reportId, body.status, body.reviewNotes)
        auditLogger.log(
            eventType = "ADMIN_REPORT_REVIEW",
            actorId = UUID.fromString(principal.name),
            metadata = mapOf("reportId" to reportId.toString(), "status" to body.status)
        )
        return ResponseEntity.ok(updated)
    }

    // ── Content Cache ────────────────────────────────────────────────

    @GetMapping("/content-cache")
    fun getContentCacheStatus(): ResponseEntity<List<ContentCacheStatusDto>> {
        return ResponseEntity.ok(adminService.getContentCacheStatus())
    }

    @PostMapping("/content-cache/refresh")
    fun triggerCacheRefresh(
        @RequestParam(required = false) source: String?,
        principal: Principal
    ): ResponseEntity<Map<String, String>> {
        adminService.triggerCacheRefresh(source)
        auditLogger.log(
            eventType = "ADMIN_CACHE_REFRESH",
            actorId = UUID.fromString(principal.name),
            metadata = mapOf("source" to (source ?: "all"))
        )
        return ResponseEntity.ok(mapOf("status" to "refresh_triggered"))
    }

    // ── KPIs ─────────────────────────────────────────────────────────

    @GetMapping("/kpis")
    fun getKpis(): ResponseEntity<KpiDto> {
        return ResponseEntity.ok(adminService.getKpis())
    }
}

// ── DTOs ──────────────────────────────────────────────────────────────

data class AdminUserDto(
    val id: UUID,
    val email: String,
    val role: String,
    val createdAt: Instant,
    val updatedAt: Instant,
    val deletionRequestedAt: Instant?,
    val lastActiveAt: Instant?,
    val questionsAnswered: Int,
    val readinessScore: Double
)

data class RoleUpdateRequest(
    @field:NotBlank(message = "role is required")
    val role: String
)

data class ReportUpdateRequest(
    @field:NotBlank(message = "status is required")
    val status: String,
    @field:Size(max = 1000, message = "reviewNotes must be at most 1000 characters")
    val reviewNotes: String? = null
)

data class ContentCacheStatusDto(
    val source: String,
    val entryCount: Long,
    val expiredCount: Long,
    val lastIndexedAt: Instant?,
    val oldestEntry: Instant?,
    val newestEntry: Instant?
)

data class KpiDto(
    val totalUsers: Long,
    val activeUsersToday: Long,
    val questionsAnsweredToday: Long,
    val claudeApiCallsToday: Long,
    val errorCountToday: Long,
    val rateLimitHitsToday: Long,
    val signupsThisWeek: Long,
    val avgReadinessScore: Double,
    val clientErrorsToday: Long,
    val authFailuresToday: Long,
    val externalServiceErrorsToday: Long
)
