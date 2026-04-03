package com.nclex.stats

import com.nclex.audit.AuditLogger
import com.nclex.exception.NotFoundException
import com.nclex.exception.UnauthorizedException
import com.nclex.model.AuditLog
import com.nclex.model.UserStats
import com.nclex.repository.UserStatsRepository
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID

class UserStatsControllerTest {

    private val userStatsRepository: UserStatsRepository = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: UserStatsController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        controller = UserStatsController(userStatsRepository, auditLogger)
    }

    private fun mockAuth() {
        every { httpRequest.getAttribute("userId") } returns userId
    }

    private fun createStats() = UserStats(
        userId = userId,
        topicScores = mapOf("Pharm" to mapOf("correct" to 5, "total" to 10)),
        history = listOf(mapOf<String, Any>("q" to 1)),
        streak = 3,
        readinessScore = 72.0,
        ncjmmScores = emptyMap(),
        lastActiveAt = Instant.now()
    )

    // ── extractUserId ───────────────────────────────────────────────

    @Nested
    inner class ExtractUserId {

        @Test
        fun `null userId throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns null

            assertThatThrownBy {
                controller.getStats(httpRequest)
            }.isInstanceOf(UnauthorizedException::class.java)
        }

        @Test
        fun `wrong type userId throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns "not-uuid"

            assertThatThrownBy {
                controller.getStats(httpRequest)
            }.isInstanceOf(UnauthorizedException::class.java)
        }
    }

    // ── getStats ────────────────────────────────────────────────────

    @Nested
    inner class GetStats {

        @Test
        fun `success returns stats`() {
            mockAuth()
            val stats = createStats()
            every { userStatsRepository.findByUserId(userId) } returns stats

            val result = controller.getStats(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.userId).isEqualTo(userId)
            assertThat(result.body!!.streak).isEqualTo(3)
            assertThat(result.body!!.readinessScore).isEqualTo(72.0)
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            every { userStatsRepository.findByUserId(userId) } returns null

            assertThatThrownBy {
                controller.getStats(httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
                .hasMessageContaining("Stats not found")
        }
    }

    // ── updateStats ─────────────────────────────────────────────────

    @Nested
    inner class UpdateStats {

        @Test
        fun `updates all provided fields`() {
            mockAuth()
            val stats = createStats()
            every { userStatsRepository.findByUserId(userId) } returns stats
            every { userStatsRepository.save(any()) } answers { firstArg() }

            val body = UpdateStatsRequest(
                topicScores = mapOf("Cardio" to mapOf("correct" to 8, "total" to 10)),
                history = listOf(mapOf("q" to 1), mapOf("q" to 2)),
                streak = 5,
                readinessScore = 85.0,
                ncjmmScores = mapOf("step" to mapOf("correct" to 7, "total" to 10))
            )

            val result = controller.updateStats(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(stats.topicScores).containsKey("Cardio")
            assertThat(stats.streak).isEqualTo(5)
            assertThat(stats.readinessScore).isEqualTo(85.0)
            assertThat(stats.lastActiveAt).isNotNull()
            verify { auditLogger.log(eq("STATS_UPDATED"), eq(userId), any(), any(), any()) }
        }

        @Test
        fun `updates only provided fields leaving others unchanged`() {
            mockAuth()
            val stats = createStats()
            val originalTopicScores = stats.topicScores
            every { userStatsRepository.findByUserId(userId) } returns stats
            every { userStatsRepository.save(any()) } answers { firstArg() }

            val body = UpdateStatsRequest(streak = 10) // only streak

            controller.updateStats(body, httpRequest)

            assertThat(stats.streak).isEqualTo(10)
            assertThat(stats.topicScores).isEqualTo(originalTopicScores) // unchanged
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            every { userStatsRepository.findByUserId(userId) } returns null

            assertThatThrownBy {
                controller.updateStats(UpdateStatsRequest(), httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }
    }

    // ── updateStreak ────────────────────────────────────────────────

    @Nested
    inner class UpdateStreak {

        @Test
        fun `updates streak value`() {
            mockAuth()
            val stats = createStats()
            every { userStatsRepository.findByUserId(userId) } returns stats
            every { userStatsRepository.save(any()) } answers { firstArg() }

            val result = controller.updateStreak(mapOf("streak" to 7), httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(stats.streak).isEqualTo(7)
            assertThat(stats.lastActiveAt).isNotNull()
        }

        @Test
        fun `missing streak key does not change streak`() {
            mockAuth()
            val stats = createStats()
            every { userStatsRepository.findByUserId(userId) } returns stats
            every { userStatsRepository.save(any()) } answers { firstArg() }

            controller.updateStreak(emptyMap(), httpRequest)

            assertThat(stats.streak).isEqualTo(3) // original value
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            every { userStatsRepository.findByUserId(userId) } returns null

            assertThatThrownBy {
                controller.updateStreak(mapOf("streak" to 1), httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }
    }

    // ── appendHistory ───────────────────────────────────────────────

    @Nested
    inner class AppendHistory {

        @Test
        fun `appends entry to history`() {
            mockAuth()
            val stats = createStats()
            val originalSize = stats.history.size
            every { userStatsRepository.findByUserId(userId) } returns stats
            every { userStatsRepository.save(any()) } answers { firstArg() }

            val entry = mapOf<String, Any>("question" to "q2", "correct" to true)
            val result = controller.appendHistory(entry, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(stats.history.size).isEqualTo(originalSize + 1)
            assertThat(stats.history.last()).isEqualTo(entry)
            verify { auditLogger.log(eq("HISTORY_APPENDED"), eq(userId), any(), any(), any()) }
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            every { userStatsRepository.findByUserId(userId) } returns null

            assertThatThrownBy {
                controller.appendHistory(mapOf<String, Any>("q" to 1), httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }
    }
}
