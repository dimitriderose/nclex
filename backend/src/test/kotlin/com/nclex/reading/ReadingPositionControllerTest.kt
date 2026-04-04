package com.nclex.reading

import com.nclex.audit.AuditLogger
import com.nclex.exception.UnauthorizedException
import com.nclex.model.AuditLog
import com.nclex.model.ReadingPosition
import com.nclex.repository.ReadingPositionRepository
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.*

class ReadingPositionControllerTest {

    private val repository: ReadingPositionRepository = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: ReadingPositionController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        controller = ReadingPositionController(repository, auditLogger)
    }

    private fun mockAuth() {
        every { httpRequest.getAttribute("userId") } returns userId
    }

    // ── extractUserId ───────────────────────────────────────────────

    @Test
    fun `no userId attribute throws UnauthorizedException`() {
        every { httpRequest.getAttribute("userId") } returns null

        assertThatThrownBy {
            controller.getAll(httpRequest)
        }.isInstanceOf(UnauthorizedException::class.java)
    }

    @Test
    fun `wrong type attribute throws UnauthorizedException`() {
        every { httpRequest.getAttribute("userId") } returns "string-not-uuid"

        assertThatThrownBy {
            controller.getAll(httpRequest)
        }.isInstanceOf(UnauthorizedException::class.java)
    }

    // ── getAll ──────────────────────────────────────────────────────

    @Nested
    inner class GetAll {

        @Test
        fun `returns all positions for user`() {
            mockAuth()
            val positions = listOf(
                ReadingPosition(userId = userId, contentKey = "ch1", position = mapOf("page" to 5)),
                ReadingPosition(userId = userId, contentKey = "ch2", position = mapOf("page" to 10))
            )
            every { repository.findByUserId(userId) } returns positions

            val result = controller.getAll(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `returns empty list when no positions`() {
            mockAuth()
            every { repository.findByUserId(userId) } returns emptyList()

            val result = controller.getAll(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).isEmpty()
        }
    }

    // ── getByKey ────────────────────────────────────────────────────

    @Nested
    inner class GetByKey {

        @Test
        fun `returns position when found`() {
            mockAuth()
            val pos = ReadingPosition(userId = userId, contentKey = "ch1", position = mapOf("page" to 5))
            every { repository.findByUserIdAndContentKey(userId, "ch1") } returns pos

            val result = controller.getByKey("ch1", httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.contentKey).isEqualTo("ch1")
        }

        @Test
        fun `returns null when not found`() {
            mockAuth()
            every { repository.findByUserIdAndContentKey(userId, "ch99") } returns null

            val result = controller.getByKey("ch99", httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).isNull()
        }
    }

    // ── upsert ──────────────────────────────────────────────────────

    @Nested
    inner class Upsert {

        @Test
        fun `creates new reading position when none exists`() {
            mockAuth()
            val body = ReadingPositionRequest(contentKey = "ch1", position = mapOf("page" to 3))

            every { repository.findByUserIdAndContentKey(userId, "ch1") } returns null
            every { repository.save(any()) } answers { firstArg() }

            val result = controller.upsert(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.contentKey).isEqualTo("ch1")
            assertThat(result.body!!.position).isEqualTo(mapOf("page" to 3))
            verify { auditLogger.log(eq("READING_POSITION_SAVED"), eq(userId), any(), any(), any()) }
        }

        @Test
        fun `updates existing reading position`() {
            mockAuth()
            val existing = ReadingPosition(userId = userId, contentKey = "ch1", position = mapOf("page" to 1))
            val body = ReadingPositionRequest(contentKey = "ch1", position = mapOf("page" to 15))

            every { repository.findByUserIdAndContentKey(userId, "ch1") } returns existing
            every { repository.save(any()) } answers { firstArg() }

            val result = controller.upsert(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(existing.position).isEqualTo(mapOf("page" to 15))
            verify { auditLogger.log(eq("READING_POSITION_SAVED"), eq(userId), any(), any(), any()) }
        }
    }
}
