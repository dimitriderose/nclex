package com.nclex.admin

import com.nclex.model.*
import com.nclex.repository.*
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@Service
class AdminService(
    private val userRepository: UserRepository,
    private val userStatsRepository: UserStatsRepository,
    private val auditLogRepository: AuditLogRepository,
    private val contentCacheRepository: ContentCacheRepository,
    private val questionReportRepository: QuestionReportRepository,
    private val flaggedQuestionRepository: FlaggedQuestionRepository
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    // ── User Management ──────────────────────────────────────────────

    fun listUsers(search: String?, page: Int, size: Int): Map<String, Any> {
        val pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))
        val usersPage = if (search.isNullOrBlank()) {
            userRepository.findAll(pageable)
        } else {
            userRepository.searchByEmail(search, pageable)
        }

        val userDtos = usersPage.content.map { user ->
            val stats = userStatsRepository.findByUserId(user.id)
            AdminUserDto(
                id = user.id,
                email = user.email,
                role = user.role.name,
                createdAt = user.createdAt,
                updatedAt = user.updatedAt,
                deletionRequestedAt = user.deletionRequestedAt,
                lastActiveAt = stats?.lastActiveAt,
                questionsAnswered = (stats?.history?.size ?: 0),
                readinessScore = stats?.readinessScore ?: 0.0
            )
        }

        return mapOf(
            "users" to userDtos,
            "totalElements" to usersPage.totalElements,
            "totalPages" to usersPage.totalPages,
            "currentPage" to page
        )
    }

    fun getUserDetail(userId: UUID): AdminUserDto {
        val user = userRepository.findById(userId)
            .orElseThrow { IllegalArgumentException("User not found: $userId") }
        val stats = userStatsRepository.findByUserId(userId)
        return AdminUserDto(
            id = user.id,
            email = user.email,
            role = user.role.name,
            createdAt = user.createdAt,
            updatedAt = user.updatedAt,
            deletionRequestedAt = user.deletionRequestedAt,
            lastActiveAt = stats?.lastActiveAt,
            questionsAnswered = (stats?.history?.size ?: 0),
            readinessScore = stats?.readinessScore ?: 0.0
        )
    }

    @Transactional
    fun updateRole(userId: UUID, role: String): AdminUserDto {
        val user = userRepository.findById(userId)
            .orElseThrow { IllegalArgumentException("User not found: $userId") }
        user.role = UserRole.valueOf(role.uppercase())
        user.updatedAt = Instant.now()
        // Bump token version so existing tokens are invalidated
        user.tokenVersion++
        userRepository.save(user)
        return getUserDetail(userId)
    }

    @Transactional
    fun softDeleteUser(userId: UUID) {
        val user = userRepository.findById(userId)
            .orElseThrow { IllegalArgumentException("User not found: $userId") }
        user.deletionRequestedAt = Instant.now()
        user.updatedAt = Instant.now()
        user.tokenVersion++
        userRepository.save(user)
    }

    @Transactional
    fun hardDeleteUser(userId: UUID) {
        userStatsRepository.deleteByUserId(userId)
        flaggedQuestionRepository.deleteByUserId(userId)
        userRepository.deleteById(userId)
        logger.warn("Hard deleted user and related data: {}", userId)
    }

    // ── Audit Log ────────────────────────────────────────────────────

    fun getAuditLog(
        eventType: String?,
        userId: UUID?,
        from: Instant?,
        to: Instant?,
        page: Int,
        size: Int
    ): Map<String, Any> {
        val pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))
        val fromDate = from ?: Instant.EPOCH
        val toDate = to ?: Instant.now()

        val logsPage = auditLogRepository.findFiltered(
            eventType = eventType,
            userId = userId,
            fromDate = fromDate,
            toDate = toDate,
            pageable = pageable
        )

        return mapOf(
            "logs" to logsPage.content,
            "totalElements" to logsPage.totalElements,
            "totalPages" to logsPage.totalPages,
            "currentPage" to page
        )
    }

    fun exportAuditLogCsv(
        eventType: String?,
        userId: UUID?,
        from: Instant?,
        to: Instant?
    ): String {
        val fromDate = from ?: Instant.EPOCH
        val toDate = to ?: Instant.now()
        val logs = auditLogRepository.findAllFiltered(eventType, userId, fromDate, toDate)

        val sb = StringBuilder()
        sb.appendLine("id,event_type,user_id,actor_id,ip_address,created_at,metadata")
        for (log in logs) {
            sb.appendLine("${log.id},${log.eventType},${log.userId ?: ""},${log.actorId ?: ""},${log.ipAddress ?: ""},${log.createdAt},\"${log.metadata}\"")
        }
        return sb.toString()
    }

    // ── Question Reports ─────────────────────────────────────────────

    fun getReports(status: String, page: Int, size: Int): Map<String, Any> {
        val pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))
        val reportsPage = questionReportRepository.findByStatus(
            ReportStatus.valueOf(status.uppercase()), pageable
        )
        return mapOf(
            "reports" to reportsPage.content,
            "totalElements" to reportsPage.totalElements,
            "totalPages" to reportsPage.totalPages,
            "currentPage" to page
        )
    }

    @Transactional
    fun updateReport(reportId: UUID, status: String, reviewNotes: String?): Map<String, Any> {
        val report = questionReportRepository.findById(reportId)
            .orElseThrow { IllegalArgumentException("Report not found: $reportId") }
        report.status = ReportStatus.valueOf(status.uppercase())
        report.reviewNotes = reviewNotes
        report.reviewedAt = Instant.now()
        report.updatedAt = Instant.now()
        questionReportRepository.save(report)
        return mapOf("report" to report, "status" to "updated")
    }

    // ── Content Cache ────────────────────────────────────────────────

    fun getContentCacheStatus(): List<ContentCacheStatusDto> {
        val now = Instant.now()
        val sources = contentCacheRepository.findDistinctSources()
        return sources.map { source ->
            val stats = contentCacheRepository.getSourceStats(source, now)
            ContentCacheStatusDto(
                source = source,
                entryCount = stats["total"] as Long,
                expiredCount = stats["expired"] as Long,
                lastIndexedAt = stats["lastUpdated"] as Instant?,
                oldestEntry = stats["oldest"] as Instant?,
                newestEntry = stats["newest"] as Instant?
            )
        }
    }

    fun triggerCacheRefresh(source: String?) {
        // This will be implemented by ContentCacheRefreshService in Feature 2
        logger.info("Cache refresh triggered for source: {}", source ?: "all")
    }

    // ── KPIs ─────────────────────────────────────────────────────────

    fun getKpis(): KpiDto {
        val now = Instant.now()
        val startOfDay = now.truncatedTo(ChronoUnit.DAYS)
        val startOfWeek = now.minus(7, ChronoUnit.DAYS)

        val totalUsers = userRepository.count()
        val activeToday = userStatsRepository.countByLastActiveAtAfter(startOfDay)
        val signupsThisWeek = userRepository.countByCreatedAtAfter(startOfWeek)

        // Count audit events as proxies for API calls and errors
        val claudeCallsToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("CLAUDE_CHAT", startOfDay)
        val errorsToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("ERROR", startOfDay)
        val rateLimitHits = auditLogRepository.countByEventTypeAndCreatedAtAfter("RATE_LIMIT_HIT", startOfDay)

        // Questions answered from history entries today
        val questionsToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("QUESTION_ANSWERED", startOfDay)

        val avgReadiness = userStatsRepository.averageReadinessScore() ?: 0.0

        val clientErrorsToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("CLIENT_ERROR", startOfDay)
        val authFailuresToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("AUTH_FAILURE", startOfDay)
        val externalServiceErrorsToday = auditLogRepository.countByEventTypeAndCreatedAtAfter("EXTERNAL_SERVICE_ERROR", startOfDay)

        return KpiDto(
            totalUsers = totalUsers,
            activeUsersToday = activeToday,
            questionsAnsweredToday = questionsToday,
            claudeApiCallsToday = claudeCallsToday,
            errorCountToday = errorsToday,
            rateLimitHitsToday = rateLimitHits,
            signupsThisWeek = signupsThisWeek,
            avgReadinessScore = avgReadiness,
            clientErrorsToday = clientErrorsToday,
            authFailuresToday = authFailuresToday,
            externalServiceErrorsToday = externalServiceErrorsToday
        )
    }
}
