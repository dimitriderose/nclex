package com.nclex.admin

import com.nclex.model.*
import com.nclex.repository.*
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import java.time.Instant
import java.util.*

class AdminServiceTest {

    private val userRepository: UserRepository = mockk()
    private val userStatsRepository: UserStatsRepository = mockk()
    private val auditLogRepository: AuditLogRepository = mockk()
    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val questionReportRepository: QuestionReportRepository = mockk()
    private val flaggedQuestionRepository: FlaggedQuestionRepository = mockk()

    private lateinit var service: AdminService

    @BeforeEach
    fun setUp() {
        service = AdminService(
            userRepository,
            userStatsRepository,
            auditLogRepository,
            contentCacheRepository,
            questionReportRepository,
            flaggedQuestionRepository
        )
    }

    private fun createUser(
        id: UUID = UUID.randomUUID(),
        email: String = "test@test.com",
        role: UserRole = UserRole.USER
    ) = User(
        id = id,
        email = email,
        passwordHash = "hash",
        role = role,
        tokenVersion = 0
    )

    private fun createStats(userId: UUID) = UserStats(
        userId = userId,
        topicScores = emptyMap(),
        history = listOf(mapOf("q" to 1), mapOf("q" to 2)),
        readinessScore = 75.0,
        lastActiveAt = Instant.now()
    )

    // ── listUsers ───────────────────────────────────────────────────

    @Nested
    inner class ListUsers {

        @Test
        fun `without search returns all users`() {
            val user = createUser()
            val stats = createStats(user.id)
            val page = PageImpl(listOf(user), PageRequest.of(0, 25), 1)

            every { userRepository.findAll(any<Pageable>()) } returns page
            every { userStatsRepository.findByUserId(user.id) } returns stats

            val result = service.listUsers(null, 0, 25)

            @Suppress("UNCHECKED_CAST")
            val users = result["users"] as List<AdminUserDto>
            assertThat(users).hasSize(1)
            assertThat(users[0].email).isEqualTo("test@test.com")
            assertThat(users[0].questionsAnswered).isEqualTo(2)
            assertThat(users[0].readinessScore).isEqualTo(75.0)
            assertThat(result["totalElements"]).isEqualTo(1L)
        }

        @Test
        fun `with search calls searchByEmail`() {
            val user = createUser(email = "admin@test.com")
            val page = PageImpl(listOf(user), PageRequest.of(0, 25), 1)

            every { userRepository.searchByEmail("admin", any()) } returns page
            every { userStatsRepository.findByUserId(user.id) } returns null

            val result = service.listUsers("admin", 0, 25)

            @Suppress("UNCHECKED_CAST")
            val users = result["users"] as List<AdminUserDto>
            assertThat(users).hasSize(1)
            assertThat(users[0].questionsAnswered).isEqualTo(0) // null stats
            assertThat(users[0].readinessScore).isEqualTo(0.0)
            assertThat(users[0].lastActiveAt).isNull()
            verify { userRepository.searchByEmail("admin", any()) }
        }

        @Test
        fun `handles null stats gracefully`() {
            val user = createUser()
            val page = PageImpl(listOf(user), PageRequest.of(0, 25), 1)

            every { userRepository.findAll(any<Pageable>()) } returns page
            every { userStatsRepository.findByUserId(user.id) } returns null

            val result = service.listUsers(null, 0, 25)

            @Suppress("UNCHECKED_CAST")
            val users = result["users"] as List<AdminUserDto>
            assertThat(users[0].questionsAnswered).isEqualTo(0)
            assertThat(users[0].readinessScore).isEqualTo(0.0)
        }

        @Test
        fun `blank search treated as no search`() {
            val page = PageImpl(emptyList<User>(), PageRequest.of(0, 25), 0)
            every { userRepository.findAll(any<Pageable>()) } returns page

            service.listUsers("  ", 0, 25)
            verify { userRepository.findAll(any<Pageable>()) }
        }
    }

    // ── getUserDetail ───────────────────────────────────────────────

    @Nested
    inner class GetUserDetail {

        @Test
        fun `found returns AdminUserDto`() {
            val userId = UUID.randomUUID()
            val user = createUser(id = userId)
            val stats = createStats(userId)

            every { userRepository.findById(userId) } returns Optional.of(user)
            every { userStatsRepository.findByUserId(userId) } returns stats

            val result = service.getUserDetail(userId)
            assertThat(result.id).isEqualTo(userId)
            assertThat(result.questionsAnswered).isEqualTo(2)
        }

        @Test
        fun `not found throws IllegalArgumentException`() {
            val userId = UUID.randomUUID()
            every { userRepository.findById(userId) } returns Optional.empty()

            assertThatThrownBy { service.getUserDetail(userId) }
                .isInstanceOf(IllegalArgumentException::class.java)
                .hasMessageContaining("User not found")
        }
    }

    // ── updateRole ──────────────────────────────────────────────────

    @Nested
    inner class UpdateRole {

        @Test
        fun `success updates role and bumps tokenVersion`() {
            val userId = UUID.randomUUID()
            val user = createUser(id = userId)
            val stats = createStats(userId)

            every { userRepository.findById(userId) } returns Optional.of(user)
            every { userRepository.save(any()) } returnsArg 0
            every { userStatsRepository.findByUserId(userId) } returns stats

            val result = service.updateRole(userId, "ADMIN")

            assertThat(result.role).isEqualTo("ADMIN")
            assertThat(user.tokenVersion).isEqualTo(1)
            verify { userRepository.save(user) }
        }

        @Test
        fun `not found throws IllegalArgumentException`() {
            val userId = UUID.randomUUID()
            every { userRepository.findById(userId) } returns Optional.empty()

            assertThatThrownBy { service.updateRole(userId, "ADMIN") }
                .isInstanceOf(IllegalArgumentException::class.java)
        }
    }

    // ── softDeleteUser ──────────────────────────────────────────────

    @Nested
    inner class SoftDeleteUser {

        @Test
        fun `sets deletionRequestedAt`() {
            val userId = UUID.randomUUID()
            val user = createUser(id = userId)

            every { userRepository.findById(userId) } returns Optional.of(user)
            every { userRepository.save(any()) } returnsArg 0

            service.softDeleteUser(userId)

            assertThat(user.deletionRequestedAt).isNotNull()
            assertThat(user.tokenVersion).isEqualTo(1)
            verify { userRepository.save(user) }
        }

        @Test
        fun `not found throws IllegalArgumentException`() {
            val userId = UUID.randomUUID()
            every { userRepository.findById(userId) } returns Optional.empty()

            assertThatThrownBy { service.softDeleteUser(userId) }
                .isInstanceOf(IllegalArgumentException::class.java)
        }
    }

    // ── hardDeleteUser ──────────────────────────────────────────────

    @Nested
    inner class HardDeleteUser {

        @Test
        fun `deletes user stats and flags`() {
            val userId = UUID.randomUUID()

            every { userStatsRepository.deleteByUserId(userId) } just Runs
            every { flaggedQuestionRepository.deleteByUserId(userId) } just Runs
            every { userRepository.deleteById(userId) } just Runs

            service.hardDeleteUser(userId)

            verify { userStatsRepository.deleteByUserId(userId) }
            verify { flaggedQuestionRepository.deleteByUserId(userId) }
            verify { userRepository.deleteById(userId) }
        }
    }

    // ── getAuditLog ─────────────────────────────────────────────────

    @Nested
    inner class GetAuditLog {

        @Test
        fun `filters applied and pagination works`() {
            val userId = UUID.randomUUID()
            val log = AuditLog(eventType = "TEST", userId = userId)
            val page = PageImpl(listOf(log))

            every {
                auditLogRepository.findFiltered(
                    eq("TEST"), eq(userId), any(), any(), any()
                )
            } returns page

            val result = service.getAuditLog("TEST", userId, null, null, 0, 50)

            @Suppress("UNCHECKED_CAST")
            val logs = result["logs"] as List<AuditLog>
            assertThat(logs).hasSize(1)
            assertThat(result["currentPage"]).isEqualTo(0)
        }

        @Test
        fun `null filters use defaults`() {
            val page = PageImpl(emptyList<AuditLog>())

            every {
                auditLogRepository.findFiltered(isNull(), isNull(), any(), any(), any())
            } returns page

            val result = service.getAuditLog(null, null, null, null, 0, 50)
            assertThat(result["totalElements"]).isEqualTo(0L)
        }
    }

    // ── exportAuditLogCsv ───────────────────────────────────────────

    @Nested
    inner class ExportAuditLogCsv {

        @Test
        fun `correct CSV format`() {
            val userId = UUID.randomUUID()
            val log = AuditLog(
                eventType = "TEST",
                userId = userId,
                actorId = userId,
                ipAddress = "127.0.0.1",
                metadata = mapOf("key" to "value")
            )

            every { auditLogRepository.findAllFiltered(any(), any(), any(), any()) } returns listOf(log)

            val csv = service.exportAuditLogCsv(null, null, null, null)

            assertThat(csv).contains("id,event_type,user_id,actor_id,ip_address,created_at,metadata")
            assertThat(csv).contains("TEST")
            assertThat(csv).contains(userId.toString())
            assertThat(csv).contains("127.0.0.1")
        }

        @Test
        fun `handles null fields in CSV`() {
            val log = AuditLog(
                eventType = "TEST",
                userId = null,
                actorId = null,
                ipAddress = null
            )

            every { auditLogRepository.findAllFiltered(any(), any(), any(), any()) } returns listOf(log)

            val csv = service.exportAuditLogCsv(null, null, null, null)
            assertThat(csv).contains("TEST")
        }
    }

    // ── getReports ──────────────────────────────────────────────────

    @Nested
    inner class GetReports {

        @Test
        fun `by status returns paginated reports`() {
            val report = QuestionReport(
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong answer",
                status = ReportStatus.PENDING
            )
            val page = PageImpl(listOf(report))

            every { questionReportRepository.findByStatus(ReportStatus.PENDING, any()) } returns page

            val result = service.getReports("PENDING", 0, 25)

            @Suppress("UNCHECKED_CAST")
            val reports = result["reports"] as List<QuestionReport>
            assertThat(reports).hasSize(1)
        }
    }

    // ── updateReport ────────────────────────────────────────────────

    @Nested
    inner class UpdateReport {

        @Test
        fun `success updates report`() {
            val reportId = UUID.randomUUID()
            val report = QuestionReport(
                id = reportId,
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong",
                status = ReportStatus.PENDING
            )

            every { questionReportRepository.findById(reportId) } returns Optional.of(report)
            every { questionReportRepository.save(any()) } returnsArg 0

            val result = service.updateReport(reportId, "REVIEWED", "Looks correct")

            assertThat(result["status"]).isEqualTo("updated")
            assertThat(report.status).isEqualTo(ReportStatus.REVIEWED)
            assertThat(report.reviewNotes).isEqualTo("Looks correct")
            assertThat(report.reviewedAt).isNotNull()
        }

        @Test
        fun `not found throws IllegalArgumentException`() {
            val reportId = UUID.randomUUID()
            every { questionReportRepository.findById(reportId) } returns Optional.empty()

            assertThatThrownBy { service.updateReport(reportId, "REVIEWED", null) }
                .isInstanceOf(IllegalArgumentException::class.java)
                .hasMessageContaining("Report not found")
        }
    }

    // ── getContentCacheStatus ───────────────────────────────────────

    @Nested
    inner class GetContentCacheStatus {

        @Test
        fun `maps source stats correctly`() {
            val now = Instant.now()
            every { contentCacheRepository.findDistinctSources() } returns listOf("fda_labels", "rxnorm")
            every { contentCacheRepository.getSourceStats("fda_labels", any()) } returns mapOf(
                "total" to 10L,
                "expired" to 2L,
                "lastUpdated" to now,
                "oldest" to now.minusSeconds(3600),
                "newest" to now
            )
            every { contentCacheRepository.getSourceStats("rxnorm", any()) } returns mapOf(
                "total" to 5L,
                "expired" to 0L,
                "lastUpdated" to null,
                "oldest" to null,
                "newest" to null
            )

            val result = service.getContentCacheStatus()

            assertThat(result).hasSize(2)
            assertThat(result[0].source).isEqualTo("fda_labels")
            assertThat(result[0].entryCount).isEqualTo(10L)
            assertThat(result[0].expiredCount).isEqualTo(2L)
            assertThat(result[1].source).isEqualTo("rxnorm")
            assertThat(result[1].lastIndexedAt).isNull()
        }
    }

    // ── getKpis ─────────────────────────────────────────────────────

    @Nested
    inner class GetKpis {

        @Test
        fun `counts correct event types`() {
            every { userRepository.count() } returns 100L
            every { userStatsRepository.countByLastActiveAtAfter(any()) } returns 25L
            every { userRepository.countByCreatedAtAfter(any()) } returns 10L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("CLAUDE_CHAT", any()) } returns 50L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("ERROR", any()) } returns 3L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("RATE_LIMIT_HIT", any()) } returns 5L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("QUESTION_ANSWERED", any()) } returns 200L
            every { userStatsRepository.averageReadinessScore() } returns 72.5
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("CLIENT_ERROR", any()) } returns 2L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("AUTH_FAILURE", any()) } returns 1L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter("EXTERNAL_SERVICE_ERROR", any()) } returns 4L

            val result = service.getKpis()

            assertThat(result.totalUsers).isEqualTo(100L)
            assertThat(result.activeUsersToday).isEqualTo(25L)
            assertThat(result.questionsAnsweredToday).isEqualTo(200L)
            assertThat(result.claudeApiCallsToday).isEqualTo(50L)
            assertThat(result.errorCountToday).isEqualTo(3L)
            assertThat(result.rateLimitHitsToday).isEqualTo(5L)
            assertThat(result.signupsThisWeek).isEqualTo(10L)
            assertThat(result.avgReadinessScore).isEqualTo(72.5)
            assertThat(result.clientErrorsToday).isEqualTo(2L)
            assertThat(result.authFailuresToday).isEqualTo(1L)
            assertThat(result.externalServiceErrorsToday).isEqualTo(4L)
        }

        @Test
        fun `null average readiness defaults to 0`() {
            every { userRepository.count() } returns 0L
            every { userStatsRepository.countByLastActiveAtAfter(any()) } returns 0L
            every { userRepository.countByCreatedAtAfter(any()) } returns 0L
            every { auditLogRepository.countByEventTypeAndCreatedAtAfter(any(), any()) } returns 0L
            every { userStatsRepository.averageReadinessScore() } returns null

            val result = service.getKpis()
            assertThat(result.avgReadinessScore).isEqualTo(0.0)
        }
    }
}
