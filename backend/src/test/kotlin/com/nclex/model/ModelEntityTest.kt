package com.nclex.model

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class ModelEntityTest {

    // ── User ────────────────────────────────────────────────────────

    @Nested
    inner class UserTest {

        @Test
        fun `default role is USER`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.role).isEqualTo(UserRole.USER)
        }

        @Test
        fun `default tokenVersion is 0`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.tokenVersion).isEqualTo(0)
        }

        @Test
        fun `deletionRequestedAt is null by default`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.deletionRequestedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            user.role = UserRole.ADMIN
            user.tokenVersion = 5
            user.deletionRequestedAt = Instant.now()
            user.updatedAt = Instant.now()
            user.passwordHash = "new-hash"

            assertThat(user.role).isEqualTo(UserRole.ADMIN)
            assertThat(user.tokenVersion).isEqualTo(5)
            assertThat(user.deletionRequestedAt).isNotNull()
        }

        @Test
        fun `id is generated`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.id).isNotNull()
        }

        @Test
        fun `createdAt is set on construction`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.createdAt).isNotNull()
        }
    }

    // ── UserRole ────────────────────────────────────────────────────

    @Nested
    inner class UserRoleTest {

        @Test
        fun `USER and ADMIN values exist`() {
            assertThat(UserRole.values()).contains(UserRole.USER, UserRole.ADMIN)
        }

        @Test
        fun `valueOf works`() {
            assertThat(UserRole.valueOf("USER")).isEqualTo(UserRole.USER)
            assertThat(UserRole.valueOf("ADMIN")).isEqualTo(UserRole.ADMIN)
        }
    }

    // ── UserStats ───────────────────────────────────────────────────

    @Nested
    inner class UserStatsTest {

        @Test
        fun `defaults are correct`() {
            val stats = UserStats(userId = UUID.randomUUID())
            assertThat(stats.topicScores).isEmpty()
            assertThat(stats.history).isEmpty()
            assertThat(stats.streak).isEqualTo(0)
            assertThat(stats.readinessScore).isEqualTo(0.0)
            assertThat(stats.ncjmmScores).isEmpty()
            assertThat(stats.lastActiveAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val stats = UserStats(userId = UUID.randomUUID())
            stats.topicScores = mapOf("Pharm" to mapOf("correct" to 5, "total" to 10))
            stats.history = listOf(mapOf("q" to 1))
            stats.streak = 7
            stats.readinessScore = 85.0
            stats.ncjmmScores = mapOf("step" to mapOf("correct" to 8))
            stats.lastActiveAt = Instant.now()
            stats.updatedAt = Instant.now()

            assertThat(stats.streak).isEqualTo(7)
            assertThat(stats.readinessScore).isEqualTo(85.0)
        }
    }

    // ── ContentCache ────────────────────────────────────────────────

    @Nested
    inner class ContentCacheTest {

        @Test
        fun `defaults are correct`() {
            val cache = ContentCache(
                contentKey = "key",
                source = "source",
                expiresAt = Instant.now().plusSeconds(3600)
            )
            assertThat(cache.data).isEmpty()
            assertThat(cache.ttlDays).isEqualTo(7)
        }

        @Test
        fun `mutable fields can be updated`() {
            val cache = ContentCache(
                contentKey = "key",
                source = "source",
                expiresAt = Instant.now().plusSeconds(3600)
            )
            cache.data = mapOf("updated" to "data")
            cache.updatedAt = Instant.now()

            assertThat(cache.data).containsKey("updated")
        }
    }

    // ── AuditLog ────────────────────────────────────────────────────

    @Nested
    inner class AuditLogTest {

        @Test
        fun `defaults are correct`() {
            val log = AuditLog(eventType = "TEST")
            assertThat(log.userId).isNull()
            assertThat(log.actorId).isNull()
            assertThat(log.metadata).isEmpty()
            assertThat(log.ipAddress).isNull()
            assertThat(log.createdAt).isNotNull()
        }

        @Test
        fun `all fields can be set`() {
            val userId = UUID.randomUUID()
            val actorId = UUID.randomUUID()
            val log = AuditLog(
                eventType = "USER_LOGIN",
                userId = userId,
                actorId = actorId,
                metadata = mapOf("key" to "value"),
                ipAddress = "10.0.0.1"
            )

            assertThat(log.eventType).isEqualTo("USER_LOGIN")
            assertThat(log.userId).isEqualTo(userId)
            assertThat(log.actorId).isEqualTo(actorId)
            assertThat(log.ipAddress).isEqualTo("10.0.0.1")
        }
    }

    // ── ExamSession ─────────────────────────────────────────────────

    @Nested
    inner class ExamSessionTest {

        @Test
        fun `defaults are correct`() {
            val session = ExamSession(userId = UUID.randomUUID())
            assertThat(session.status).isEqualTo(ExamStatus.IN_PROGRESS)
            assertThat(session.totalQuestions).isEqualTo(0)
            assertThat(session.correctCount).isEqualTo(0)
            assertThat(session.currentDifficulty).isEqualTo(0.5)
            assertThat(session.questionHistory).isEmpty()
            assertThat(session.topicBreakdown).isEmpty()
            assertThat(session.timeLimitMinutes).isEqualTo(300)
            assertThat(session.elapsedSeconds).isEqualTo(0L)
            assertThat(session.passPrediction).isNull()
            assertThat(session.confidenceLevel).isNull()
            assertThat(session.completedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val session = ExamSession(userId = UUID.randomUUID())
            session.status = ExamStatus.COMPLETED
            session.totalQuestions = 80
            session.correctCount = 50
            session.currentDifficulty = 0.7
            session.questionHistory = listOf(mapOf("q" to "1"))
            session.topicBreakdown = mapOf("topic" to mapOf("correct" to 5))
            session.elapsedSeconds = 3600
            session.passPrediction = true
            session.confidenceLevel = 0.95
            session.completedAt = Instant.now()
            session.updatedAt = Instant.now()

            assertThat(session.status).isEqualTo(ExamStatus.COMPLETED)
            assertThat(session.passPrediction).isTrue()
        }
    }

    // ── ExamStatus ──────────────────────────────────────────────────

    @Nested
    inner class ExamStatusTest {

        @Test
        fun `all values exist`() {
            assertThat(ExamStatus.values()).contains(
                ExamStatus.IN_PROGRESS,
                ExamStatus.COMPLETED,
                ExamStatus.TIMED_OUT,
                ExamStatus.ABANDONED
            )
        }
    }

    // ── QuestionReport ──────────────────────────────────────────────

    @Nested
    inner class QuestionReportTest {

        @Test
        fun `defaults are correct`() {
            val report = QuestionReport(
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong"
            )
            assertThat(report.questionData).isEmpty()
            assertThat(report.userNotes).isNull()
            assertThat(report.status).isEqualTo(ReportStatus.PENDING)
            assertThat(report.reviewNotes).isNull()
            assertThat(report.reviewedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val report = QuestionReport(
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong"
            )
            report.status = ReportStatus.REVIEWED
            report.reviewNotes = "Fixed"
            report.reviewedAt = Instant.now()
            report.updatedAt = Instant.now()

            assertThat(report.status).isEqualTo(ReportStatus.REVIEWED)
            assertThat(report.reviewNotes).isEqualTo("Fixed")
        }
    }

    // ── ReportStatus ────────────────────────────────────────────────

    @Nested
    inner class ReportStatusTest {

        @Test
        fun `all values exist`() {
            assertThat(ReportStatus.values()).contains(
                ReportStatus.PENDING,
                ReportStatus.REVIEWED,
                ReportStatus.DISMISSED,
                ReportStatus.FIXED
            )
        }
    }

    // ── ReadinessSnapshot ───────────────────────────────────────────

    @Nested
    inner class ReadinessSnapshotTest {

        @Test
        fun `defaults are correct`() {
            val snapshot = ReadinessSnapshot(
                userId = UUID.randomUUID(),
                snapshotDate = LocalDate.now(),
                readinessScore = 80.0,
                readinessBand = "High"
            )
            assertThat(snapshot.topicBreakdown).isEmpty()
            assertThat(snapshot.ncjmmBreakdown).isEmpty()
            assertThat(snapshot.questionsAnswered).isEqualTo(0)
        }

        @Test
        fun `all fields can be set`() {
            val snapshot = ReadinessSnapshot(
                userId = UUID.randomUUID(),
                snapshotDate = LocalDate.of(2026, 4, 1),
                readinessScore = 90.0,
                readinessBand = "Very High",
                topicBreakdown = mapOf("Pharm" to mapOf("accuracy" to 95.0)),
                ncjmmBreakdown = mapOf("Recognize Cues" to 88.0),
                questionsAnswered = 50
            )
            assertThat(snapshot.readinessBand).isEqualTo("Very High")
            assertThat(snapshot.questionsAnswered).isEqualTo(50)
        }
    }

    // ── FlaggedQuestion ─────────────────────────────────────────────

    @Nested
    inner class FlaggedQuestionTest {

        @Test
        fun `defaults are correct`() {
            val fq = FlaggedQuestion(
                userId = UUID.randomUUID(),
                topic = "Pharm",
                category = FlagCategory.REVIEW
            )
            assertThat(fq.question).isEmpty()
            assertThat(fq.notes).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val fq = FlaggedQuestion(
                userId = UUID.randomUUID(),
                topic = "Pharm",
                category = FlagCategory.REVIEW
            )
            fq.question = mapOf("stem" to "question")
            fq.category = FlagCategory.WRONG
            fq.notes = "Note"
            fq.updatedAt = Instant.now()

            assertThat(fq.category).isEqualTo(FlagCategory.WRONG)
            assertThat(fq.notes).isEqualTo("Note")
        }
    }

    // ── FlagCategory ────────────────────────────────────────────────

    @Nested
    inner class FlagCategoryTest {

        @Test
        fun `all values exist`() {
            assertThat(FlagCategory.values()).contains(
                FlagCategory.REVIEW,
                FlagCategory.WRONG,
                FlagCategory.BOOKMARK,
                FlagCategory.HARD
            )
        }
    }

    // ── ReadingPosition ─────────────────────────────────────────────

    @Nested
    inner class ReadingPositionTest {

        @Test
        fun `defaults are correct`() {
            val rp = ReadingPosition(
                userId = UUID.randomUUID(),
                contentKey = "book-1"
            )
            assertThat(rp.position).isEmpty()
        }

        @Test
        fun `mutable fields can be updated`() {
            val rp = ReadingPosition(
                userId = UUID.randomUUID(),
                contentKey = "book-1"
            )
            rp.position = mapOf("page" to 42, "cfi" to "/4/2/1")
            rp.updatedAt = Instant.now()

            assertThat(rp.position["page"]).isEqualTo(42)
        }
    }

    // ── WebAuthnCredential ──────────────────────────────────────────

    @Nested
    inner class WebAuthnCredentialTest {

        @Test
        fun `defaults are correct`() {
            val cred = WebAuthnCredential(
                userId = UUID.randomUUID(),
                credentialId = "cred-123",
                publicKey = "pk-data"
            )
            assertThat(cred.signCount).isEqualTo(0L)
            assertThat(cred.deviceName).isNull()
            assertThat(cred.lastUsedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val cred = WebAuthnCredential(
                userId = UUID.randomUUID(),
                credentialId = "cred-123",
                publicKey = "pk-data"
            )
            cred.signCount = 5
            cred.lastUsedAt = Instant.now()

            assertThat(cred.signCount).isEqualTo(5L)
            assertThat(cred.lastUsedAt).isNotNull()
        }
    }

    // ── UserHighlight ───────────────────────────────────────────────

    @Nested
    inner class UserHighlightTest {

        @Test
        fun `defaults are correct`() {
            val h = UserHighlight(
                userId = UUID.randomUUID(),
                contentKey = "book-1",
                clientId = "client-1",
                color = "yellow",
                text = "highlighted text",
                startXpath = "/div[1]",
                startOffset = 0,
                endXpath = "/div[1]",
                endOffset = 10
            )
            assertThat(h.note).isNull()
            assertThat(h.deletedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val h = UserHighlight(
                userId = UUID.randomUUID(),
                contentKey = "book-1",
                clientId = "client-1",
                color = "yellow",
                text = "text",
                startXpath = "/div",
                startOffset = 0,
                endXpath = "/div",
                endOffset = 5
            )
            h.color = "blue"
            h.text = "new text"
            h.note = "Important"
            h.updatedAt = Instant.now()
            h.deletedAt = Instant.now()

            assertThat(h.color).isEqualTo("blue")
            assertThat(h.note).isEqualTo("Important")
            assertThat(h.deletedAt).isNotNull()
        }
    }

    // ── Bookmark ────────────────────────────────────────────────────

    @Nested
    inner class BookmarkTest {

        @Test
        fun `defaults are correct`() {
            val b = Bookmark(
                userId = UUID.randomUUID(),
                contentKey = "book-1",
                page = 42,
                clientId = "client-1"
            )
            assertThat(b.label).isNull()
            assertThat(b.deletedAt).isNull()
        }

        @Test
        fun `mutable fields can be updated`() {
            val b = Bookmark(
                userId = UUID.randomUUID(),
                contentKey = "book-1",
                page = 42,
                clientId = "client-1"
            )
            b.label = "Chapter 5"
            b.clientId = "client-2"
            b.updatedAt = Instant.now()
            b.deletedAt = Instant.now()

            assertThat(b.label).isEqualTo("Chapter 5")
            assertThat(b.clientId).isEqualTo("client-2")
            assertThat(b.deletedAt).isNotNull()
        }
    }
}
