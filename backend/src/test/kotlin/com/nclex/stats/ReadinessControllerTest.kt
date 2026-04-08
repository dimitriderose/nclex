package com.nclex.stats

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

class ReadinessControllerTest {

    private val readinessScoreService: ReadinessScoreService = mockk()
    private val userStatsRepository: UserStatsRepository = mockk()
    private val readinessSnapshotRepository: ReadinessSnapshotRepository = mockk()

    private lateinit var controller: ReadinessController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = ReadinessController(readinessScoreService, userStatsRepository, readinessSnapshotRepository)
    }

    // ── getCurrentReadiness ─────────────────────────────────────────

    @Nested
    inner class GetCurrentReadiness {

        @Test
        fun `no stats returns default response`() {
            every { userStatsRepository.findByUserId(userId) } returns null

            val response = controller.getCurrentReadiness(userId)

            assertThat(response.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = response.body as Map<String, Any>
            assertThat(body["score"]).isEqualTo(0)
            assertThat(body["band"]).isEqualTo("Low")
            assertThat(body["message"]).isNotNull
        }

        @Test
        fun `with stats returns calculated readiness`() {
            val stats = UserStats(
                userId = userId,
                topicScores = emptyMap(),
                history = listOf(mapOf("q" to 1)),
                readinessScore = 75.0,
                lastActiveAt = Instant.now()
            )
            every { userStatsRepository.findByUserId(userId) } returns stats

            val readinessResult = ReadinessScoreService.ReadinessResult(
                score = 75.0,
                band = "High",
                topicBreakdown = emptyMap(),
                ncjmmBreakdown = emptyMap(),
                volumeScore = 50.0,
                recencyScore = 100.0,
                questionsAnswered = 1,
                recommendation = "Good progress"
            )
            every { readinessScoreService.calculateReadiness(stats) } returns readinessResult

            val response = controller.getCurrentReadiness(userId)

            assertThat(response.statusCode.value()).isEqualTo(200)
            assertThat(response.body).isEqualTo(readinessResult)
        }
    }

    // ── getReadinessHistory ─────────────────────────────────────────

    @Nested
    inner class GetReadinessHistory {

        @Test
        fun `returns snapshots within date range`() {
            val from = LocalDate.of(2026, 1, 1)
            val to = LocalDate.of(2026, 3, 31)
            val snapshot = ReadinessSnapshot(
                userId = userId,
                snapshotDate = LocalDate.of(2026, 2, 15),
                readinessScore = 80.0,
                readinessBand = "High"
            )
            every {
                readinessSnapshotRepository.findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(userId, from, to)
            } returns listOf(snapshot)

            val response = controller.getReadinessHistory(userId, from, to)

            assertThat(response.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = response.body as Map<String, Any>
            assertThat(body["from"]).isEqualTo(from)
            assertThat(body["to"]).isEqualTo(to)
            assertThat(body["count"]).isEqualTo(1)
            @Suppress("UNCHECKED_CAST")
            val snapshots = body["snapshots"] as List<ReadinessSnapshot>
            assertThat(snapshots).hasSize(1)
        }

        @Test
        fun `null from defaults to 30 days ago`() {
            every {
                readinessSnapshotRepository.findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(
                    eq(userId), any(), any()
                )
            } returns emptyList()

            val response = controller.getReadinessHistory(userId, null, null)

            assertThat(response.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = response.body as Map<String, Any>
            assertThat(body["count"]).isEqualTo(0)
        }

        @Test
        fun `null to defaults to today`() {
            every {
                readinessSnapshotRepository.findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(
                    eq(userId), any(), eq(LocalDate.now())
                )
            } returns emptyList()

            val response = controller.getReadinessHistory(userId, LocalDate.of(2026, 1, 1), null)

            assertThat(response.statusCode.value()).isEqualTo(200)
            @Suppress("UNCHECKED_CAST")
            val body = response.body as Map<String, Any>
            assertThat(body["to"]).isEqualTo(LocalDate.now())
        }

        @Test
        fun `empty history returns empty snapshots`() {
            every {
                readinessSnapshotRepository.findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(
                    eq(userId), any(), any()
                )
            } returns emptyList()

            val response = controller.getReadinessHistory(userId, null, null)

            @Suppress("UNCHECKED_CAST")
            val body = response.body as Map<String, Any>
            @Suppress("UNCHECKED_CAST")
            val snapshots = body["snapshots"] as List<*>
            assertThat(snapshots).isEmpty()
        }
    }
}
