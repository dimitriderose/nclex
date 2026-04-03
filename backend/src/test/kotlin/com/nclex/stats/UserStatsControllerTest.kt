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
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.*

class UserStatsControllerTest {

    private val repository = mockk<UserStatsRepository>()
    private val auditLogger = mockk<AuditLogger>()
    private val request = mockk<HttpServletRequest>()
    private val userId = UUID.randomUUID()

    private lateinit var controller: UserStatsController

    @BeforeEach
    fun setup() {
        every { auditLogger.logUserAction(any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        controller = UserStatsController(repository, auditLogger)
        every { request.getAttribute("userId") } returns userId
    }

    private fun createStats() = UserStats(
        userId = userId,
        topicScores = emptyMap(),
        history = emptyList(),
        readinessScore = 75.0,
        lastActiveAt = Instant.now()
    )

    @Test
    fun `getStats returns stats when found`() {
        val stats = createStats()
        every { repository.findByUserId(userId) } returns stats

        val result = controller.getStats(request)
        assertThat(result.statusCode.value()).isEqualTo(200)
    }

    @Test
    fun `getStats throws NotFoundException when not found`() {
        every { repository.findByUserId(userId) } returns null

        assertThatThrownBy { controller.getStats(request) }
            .isInstanceOf(NotFoundException::class.java)
    }

    @Test
    fun `updateStats updates provided fields`() {
        val stats = createStats()
        every { repository.findByUserId(userId) } returns stats
        every { repository.save(any()) } returns stats

        val body = UpdateStatsRequest(streak = 10, readinessScore = 85.0)
        val result = controller.updateStats(body, request)
        assertThat(result.statusCode.value()).isEqualTo(200)
        assertThat(stats.streak).isEqualTo(10)
        assertThat(stats.readinessScore).isEqualTo(85.0)
        verify { auditLogger.logUserAction(eq("STATS_UPDATED"), eq(userId), isNull(), any()) }
    }

    @Test
    fun `updateStats ignores null fields`() {
        val stats = createStats()
        stats.streak = 5
        every { repository.findByUserId(userId) } returns stats
        every { repository.save(any()) } returns stats

        val body = UpdateStatsRequest() // all null
        controller.updateStats(body, request)
        assertThat(stats.streak).isEqualTo(5) // unchanged
    }

    @Test
    fun `updateStreak updates streak value`() {
        val stats = createStats()
        every { repository.findByUserId(userId) } returns stats
        every { repository.save(any()) } returns stats

        controller.updateStreak(mapOf("streak" to 7), request)
        assertThat(stats.streak).isEqualTo(7)
    }

    @Test
    fun `appendHistory appends entry to list`() {
        val stats = createStats()
        every { repository.findByUserId(userId) } returns stats
        every { repository.save(any()) } returns stats

        val entry = mapOf("topic" to "pharma", "correct" to true)
        controller.appendHistory(entry, request)
        assertThat(stats.history).hasSize(1)
        assertThat(stats.history[0]["topic"]).isEqualTo("pharma")
    }

    @Test
    fun `no userId throws UnauthorizedException`() {
        every { request.getAttribute("userId") } returns null
        assertThatThrownBy { controller.getStats(request) }
            .isInstanceOf(UnauthorizedException::class.java)
    }
}
