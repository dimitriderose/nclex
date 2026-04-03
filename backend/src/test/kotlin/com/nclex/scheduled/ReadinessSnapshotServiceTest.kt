package com.nclex.scheduled

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import com.nclex.model.ReadinessSnapshot
import com.nclex.model.UserStats
import com.nclex.repository.ReadinessSnapshotRepository
import com.nclex.repository.UserStatsRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class ReadinessSnapshotServiceTest {

    private val userStatsRepository: UserStatsRepository = mockk()
    private val readinessSnapshotRepository: ReadinessSnapshotRepository = mockk()
    private val auditLogger: AuditLogger = mockk()

    private lateinit var service: ReadinessSnapshotService

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        service = ReadinessSnapshotService(
            userStatsRepository,
            readinessSnapshotRepository,
            auditLogger
        )
    }

    private fun createStats(
        readinessScore: Double = 75.0,
        userId: UUID = UUID.randomUUID()
    ) = UserStats(
        userId = userId,
        topicScores = mapOf("topic" to mapOf("correct" to 8, "total" to 10)),
        history = listOf(mapOf("q" to 1)),
        ncjmmScores = mapOf("step" to mapOf("correct" to 7, "total" to 10)),
        readinessScore = readinessScore,
        lastActiveAt = Instant.now()
    )

    // ── generateDailySnapshots ──────────────────────────────────────

    @Nested
    inner class GenerateDailySnapshots {

        @Test
        fun `creates snapshots for active users`() {
            val stats = createStats(readinessScore = 80.0)
            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats)
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(stats.userId, any()) } returns null

            val snapshotSlot = slot<ReadinessSnapshot>()
            every { readinessSnapshotRepository.save(capture(snapshotSlot)) } answers { snapshotSlot.captured }

            service.generateDailySnapshots()

            verify { readinessSnapshotRepository.save(any()) }
            assertThat(snapshotSlot.captured.userId).isEqualTo(stats.userId)
            assertThat(snapshotSlot.captured.readinessScore).isEqualTo(80.0)
            assertThat(snapshotSlot.captured.readinessBand).isEqualTo("High")
            assertThat(snapshotSlot.captured.questionsAnswered).isEqualTo(1)
            verify { auditLogger.log(eq("DAILY_SNAPSHOT_COMPLETE"), any(), any(), any(), any()) }
        }

        @Test
        fun `skips existing snapshots for today`() {
            val stats = createStats()
            val existingSnapshot = ReadinessSnapshot(
                userId = stats.userId,
                snapshotDate = LocalDate.now(),
                readinessScore = 70.0,
                readinessBand = "Borderline"
            )

            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats)
            every {
                readinessSnapshotRepository.findByUserIdAndSnapshotDate(stats.userId, any())
            } returns existingSnapshot

            service.generateDailySnapshots()

            verify(exactly = 0) { readinessSnapshotRepository.save(any()) }
        }

        @Test
        fun `handles failures for individual users`() {
            val stats1 = createStats(userId = UUID.randomUUID())
            val stats2 = createStats(userId = UUID.randomUUID())

            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats1, stats2)
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(stats1.userId, any()) } returns null
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(stats2.userId, any()) } returns null
            every { readinessSnapshotRepository.save(match { it.userId == stats1.userId }) } throws RuntimeException("DB error")
            every { readinessSnapshotRepository.save(match { it.userId == stats2.userId }) } answers { firstArg() }

            service.generateDailySnapshots()

            // stats2 should still be saved despite stats1 failure
            verify(exactly = 1) { readinessSnapshotRepository.save(match { it.userId == stats2.userId }) }
        }

        @Test
        fun `no active users completes without errors`() {
            every { userStatsRepository.findActiveUsersSince(any()) } returns emptyList()

            service.generateDailySnapshots()

            verify(exactly = 0) { readinessSnapshotRepository.save(any()) }
            verify { auditLogger.log(eq("DAILY_SNAPSHOT_COMPLETE"), any(), any(), any(), any()) }
        }

        @Test
        fun `band classification Very High for score gte 90`() {
            val stats = createStats(readinessScore = 95.0)
            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats)
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(any(), any()) } returns null

            val snapshotSlot = slot<ReadinessSnapshot>()
            every { readinessSnapshotRepository.save(capture(snapshotSlot)) } answers { snapshotSlot.captured }

            service.generateDailySnapshots()
            assertThat(snapshotSlot.captured.readinessBand).isEqualTo("Very High")
        }

        @Test
        fun `band classification Borderline for score gte 60 lt 75`() {
            val stats = createStats(readinessScore = 65.0)
            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats)
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(any(), any()) } returns null

            val snapshotSlot = slot<ReadinessSnapshot>()
            every { readinessSnapshotRepository.save(capture(snapshotSlot)) } answers { snapshotSlot.captured }

            service.generateDailySnapshots()
            assertThat(snapshotSlot.captured.readinessBand).isEqualTo("Borderline")
        }

        @Test
        fun `band classification Low for score lt 60`() {
            val stats = createStats(readinessScore = 45.0)
            every { userStatsRepository.findActiveUsersSince(any()) } returns listOf(stats)
            every { readinessSnapshotRepository.findByUserIdAndSnapshotDate(any(), any()) } returns null

            val snapshotSlot = slot<ReadinessSnapshot>()
            every { readinessSnapshotRepository.save(capture(snapshotSlot)) } answers { snapshotSlot.captured }

            service.generateDailySnapshots()
            assertThat(snapshotSlot.captured.readinessBand).isEqualTo("Low")
        }
    }
}
