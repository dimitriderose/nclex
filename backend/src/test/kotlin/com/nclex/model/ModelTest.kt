package com.nclex.model

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class ModelTest {

    // ── WebAuthnCredential ─────────────────────────────────────────

    @Nested
    inner class WebAuthnCredentialTest {

        @Test
        fun `defaults are applied`() {
            val userId = UUID.randomUUID()
            val cred = WebAuthnCredential(
                userId = userId,
                credentialId = "cred-123",
                publicKey = "pk-abc"
            )
            assertThat(cred.signCount).isEqualTo(0)
            assertThat(cred.deviceName).isNull()
            assertThat(cred.lastUsedAt).isNull()
            assertThat(cred.createdAt).isNotNull
        }

        @Test
        fun `mutable fields can be updated`() {
            val cred = WebAuthnCredential(
                userId = UUID.randomUUID(),
                credentialId = "c1",
                publicKey = "pk"
            )
            cred.signCount = 5
            cred.lastUsedAt = Instant.now()

            assertThat(cred.signCount).isEqualTo(5)
            assertThat(cred.lastUsedAt).isNotNull
        }

        @Test
        fun `with all fields`() {
            val now = Instant.now()
            val cred = WebAuthnCredential(
                userId = UUID.randomUUID(),
                credentialId = "c1",
                publicKey = "pk",
                signCount = 10,
                deviceName = "iPhone",
                lastUsedAt = now
            )
            assertThat(cred.deviceName).isEqualTo("iPhone")
            assertThat(cred.signCount).isEqualTo(10)
        }
    }

    // ── ContentCache ───────────────────────────────────────────────

    @Nested
    inner class ContentCacheTest {

        @Test
        fun `defaults applied`() {
            val cc = ContentCache(
                contentKey = "k",
                source = "s",
                expiresAt = Instant.now().plusSeconds(3600)
            )
            assertThat(cc.data).isEmpty()
            assertThat(cc.ttlDays).isEqualTo(7)
        }

        @Test
        fun `data can be mutated`() {
            val cc = ContentCache(
                contentKey = "k",
                source = "s",
                expiresAt = Instant.now().plusSeconds(3600)
            )
            cc.data = mapOf("key" to "value")
            assertThat(cc.data).containsEntry("key", "value")
        }

        @Test
        fun `updatedAt can be mutated`() {
            val cc = ContentCache(
                contentKey = "k",
                source = "s",
                expiresAt = Instant.now().plusSeconds(3600)
            )
            val now = Instant.now()
            cc.updatedAt = now
            assertThat(cc.updatedAt).isEqualTo(now)
        }
    }

    // ── QuestionReport ─────────────────────────────────────────────

    @Nested
    inner class QuestionReportTest {

        @Test
        fun `defaults applied`() {
            val qr = QuestionReport(
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong"
            )
            assertThat(qr.status).isEqualTo(ReportStatus.PENDING)
            assertThat(qr.reviewNotes).isNull()
            assertThat(qr.reviewedAt).isNull()
            assertThat(qr.userNotes).isNull()
            assertThat(qr.questionData).isEmpty()
        }

        @Test
        fun `mutable fields update correctly`() {
            val qr = QuestionReport(
                userId = UUID.randomUUID(),
                questionTopic = "Pharm",
                reportReason = "Wrong"
            )
            qr.status = ReportStatus.REVIEWED
            qr.reviewNotes = "Confirmed issue"
            qr.reviewedAt = Instant.now()
            qr.updatedAt = Instant.now()

            assertThat(qr.status).isEqualTo(ReportStatus.REVIEWED)
            assertThat(qr.reviewNotes).isEqualTo("Confirmed issue")
        }

        @Test
        fun `ReportStatus enum has all values`() {
            assertThat(ReportStatus.values()).containsExactly(
                ReportStatus.PENDING, ReportStatus.REVIEWED, ReportStatus.DISMISSED, ReportStatus.FIXED
            )
        }
    }

    // ── ReadinessSnapshot ──────────────────────────────────────────

    @Nested
    inner class ReadinessSnapshotTest {

        @Test
        fun `defaults applied`() {
            val rs = ReadinessSnapshot(
                userId = UUID.randomUUID(),
                snapshotDate = LocalDate.now(),
                readinessScore = 85.0,
                readinessBand = "High"
            )
            assertThat(rs.topicBreakdown).isEmpty()
            assertThat(rs.ncjmmBreakdown).isEmpty()
            assertThat(rs.questionsAnswered).isEqualTo(0)
        }

        @Test
        fun `all fields populated`() {
            val rs = ReadinessSnapshot(
                userId = UUID.randomUUID(),
                snapshotDate = LocalDate.of(2026, 1, 1),
                readinessScore = 92.0,
                readinessBand = "Very High",
                topicBreakdown = mapOf("Pharm" to 90),
                ncjmmBreakdown = mapOf("Recognize Cues" to 88),
                questionsAnswered = 150
            )
            assertThat(rs.readinessScore).isEqualTo(92.0)
            assertThat(rs.questionsAnswered).isEqualTo(150)
        }
    }

    // ── User ───────────────────────────────────────────────────────

    @Nested
    inner class UserTest {

        @Test
        fun `defaults applied`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            assertThat(user.role).isEqualTo(UserRole.USER)
            assertThat(user.tokenVersion).isEqualTo(0)
            assertThat(user.deletionRequestedAt).isNull()
        }

        @Test
        fun `UserRole enum has USER and ADMIN`() {
            assertThat(UserRole.values()).containsExactly(UserRole.USER, UserRole.ADMIN)
        }

        @Test
        fun `mutable fields`() {
            val user = User(email = "test@test.com", passwordHash = "hash")
            user.role = UserRole.ADMIN
            user.tokenVersion = 5
            user.deletionRequestedAt = Instant.now()
            user.updatedAt = Instant.now()
            user.passwordHash = "newhash"

            assertThat(user.role).isEqualTo(UserRole.ADMIN)
            assertThat(user.tokenVersion).isEqualTo(5)
            assertThat(user.deletionRequestedAt).isNotNull
            assertThat(user.passwordHash).isEqualTo("newhash")
        }
    }

    // ── FlaggedQuestion ────────────────────────────────────────────

    @Nested
    inner class FlaggedQuestionTest {

        @Test
        fun `FlagCategory enum has all values`() {
            assertThat(FlagCategory.values()).containsExactly(
                FlagCategory.REVIEW, FlagCategory.WRONG, FlagCategory.BOOKMARK, FlagCategory.HARD
            )
        }

        @Test
        fun `defaults`() {
            val fq = FlaggedQuestion(
                userId = UUID.randomUUID(),
                topic = "Pharm",
                category = FlagCategory.REVIEW
            )
            assertThat(fq.question).isEmpty()
            assertThat(fq.notes).isNull()
        }

        @Test
        fun `mutable fields`() {
            val fq = FlaggedQuestion(
                userId = UUID.randomUUID(),
                topic = "Pharm",
                category = FlagCategory.REVIEW
            )
            fq.category = FlagCategory.HARD
            fq.notes = "Difficult"
            fq.question = mapOf("stem" to "test")
            fq.updatedAt = Instant.now()

            assertThat(fq.category).isEqualTo(FlagCategory.HARD)
            assertThat(fq.notes).isEqualTo("Difficult")
        }
    }

    // ── Bookmark ───────────────────────────────────────────────────

    @Nested
    inner class BookmarkTest {

        @Test
        fun `defaults`() {
            val b = Bookmark(
                userId = UUID.randomUUID(),
                contentKey = "ck",
                page = 1,
                clientId = "c1"
            )
            assertThat(b.label).isNull()
            assertThat(b.deletedAt).isNull()
        }

        @Test
        fun `mutable fields`() {
            val b = Bookmark(
                userId = UUID.randomUUID(),
                contentKey = "ck",
                page = 1,
                clientId = "c1"
            )
            b.label = "Chapter 1"
            b.deletedAt = Instant.now()
            b.updatedAt = Instant.now()
            b.clientId = "c2"

            assertThat(b.label).isEqualTo("Chapter 1")
            assertThat(b.deletedAt).isNotNull
            assertThat(b.clientId).isEqualTo("c2")
        }
    }

    // ── UserHighlight ──────────────────────────────────────────────

    @Nested
    inner class UserHighlightTest {

        @Test
        fun `defaults`() {
            val h = UserHighlight(
                userId = UUID.randomUUID(),
                contentKey = "ck",
                clientId = "c1",
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
        fun `mutable fields`() {
            val h = UserHighlight(
                userId = UUID.randomUUID(),
                contentKey = "ck",
                clientId = "c1",
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
            h.deletedAt = Instant.now()
            h.updatedAt = Instant.now()

            assertThat(h.color).isEqualTo("blue")
            assertThat(h.text).isEqualTo("new text")
            assertThat(h.note).isEqualTo("Important")
        }
    }

    // ── ReadingPosition ────────────────────────────────────────────

    @Nested
    inner class ReadingPositionTest {

        @Test
        fun `defaults`() {
            val rp = ReadingPosition(
                userId = UUID.randomUUID(),
                contentKey = "ck"
            )
            assertThat(rp.position).isEmpty()
        }

        @Test
        fun `mutable fields`() {
            val rp = ReadingPosition(
                userId = UUID.randomUUID(),
                contentKey = "ck"
            )
            rp.position = mapOf("page" to 5, "scroll" to 0.75)
            rp.updatedAt = Instant.now()

            assertThat(rp.position).containsEntry("page", 5)
        }
    }

    // ── UserStats ──────────────────────────────────────────────────

    @Nested
    inner class UserStatsTest {

        @Test
        fun `defaults`() {
            val us = UserStats(userId = UUID.randomUUID())
            assertThat(us.topicScores).isEmpty()
            assertThat(us.history).isEmpty()
            assertThat(us.streak).isEqualTo(0)
            assertThat(us.readinessScore).isEqualTo(0.0)
            assertThat(us.ncjmmScores).isEmpty()
            assertThat(us.lastActiveAt).isNull()
        }

        @Test
        fun `mutable fields`() {
            val us = UserStats(userId = UUID.randomUUID())
            us.topicScores = mapOf("Pharm" to mapOf("correct" to 5, "total" to 10))
            us.history = listOf(mapOf("q" to 1))
            us.streak = 7
            us.readinessScore = 82.5
            us.ncjmmScores = mapOf("Recognize Cues" to mapOf("correct" to 3, "total" to 5))
            us.lastActiveAt = Instant.now()
            us.updatedAt = Instant.now()

            assertThat(us.streak).isEqualTo(7)
            assertThat(us.readinessScore).isEqualTo(82.5)
        }
    }

    // ── ExamSession ────────────────────────────────────────────────

    @Nested
    inner class ExamSessionTest {

        @Test
        fun `defaults`() {
            val es = ExamSession(userId = UUID.randomUUID())
            assertThat(es.status).isEqualTo(ExamStatus.IN_PROGRESS)
            assertThat(es.totalQuestions).isEqualTo(0)
            assertThat(es.correctCount).isEqualTo(0)
            assertThat(es.currentDifficulty).isEqualTo(0.5)
            assertThat(es.questionHistory).isEmpty()
            assertThat(es.topicBreakdown).isEmpty()
            assertThat(es.timeLimitMinutes).isEqualTo(300)
            assertThat(es.elapsedSeconds).isEqualTo(0)
            assertThat(es.passPrediction).isNull()
            assertThat(es.confidenceLevel).isNull()
            assertThat(es.completedAt).isNull()
        }

        @Test
        fun `ExamStatus enum has all values`() {
            assertThat(ExamStatus.values()).containsExactly(
                ExamStatus.IN_PROGRESS, ExamStatus.COMPLETED, ExamStatus.TIMED_OUT, ExamStatus.ABANDONED
            )
        }

        @Test
        fun `mutable fields`() {
            val es = ExamSession(userId = UUID.randomUUID())
            es.status = ExamStatus.COMPLETED
            es.totalQuestions = 80
            es.correctCount = 50
            es.currentDifficulty = 0.7
            es.questionHistory = listOf(mapOf("q" to 1))
            es.topicBreakdown = mapOf("Pharm" to mapOf("correct" to 5))
            es.elapsedSeconds = 3600
            es.passPrediction = true
            es.confidenceLevel = 0.95
            es.completedAt = Instant.now()
            es.updatedAt = Instant.now()

            assertThat(es.status).isEqualTo(ExamStatus.COMPLETED)
            assertThat(es.passPrediction).isTrue()
        }
    }

    // ── AuditLog ───────────────────────────────────────────────────

    @Nested
    inner class AuditLogTest {

        @Test
        fun `defaults`() {
            val al = AuditLog(eventType = "TEST")
            assertThat(al.userId).isNull()
            assertThat(al.actorId).isNull()
            assertThat(al.metadata).isEmpty()
            assertThat(al.ipAddress).isNull()
        }

        @Test
        fun `all fields populated`() {
            val userId = UUID.randomUUID()
            val al = AuditLog(
                eventType = "LOGIN",
                userId = userId,
                actorId = userId,
                metadata = mapOf("key" to "value"),
                ipAddress = "10.0.0.1"
            )
            assertThat(al.eventType).isEqualTo("LOGIN")
            assertThat(al.userId).isEqualTo(userId)
            assertThat(al.ipAddress).isEqualTo("10.0.0.1")
        }
    }
}
