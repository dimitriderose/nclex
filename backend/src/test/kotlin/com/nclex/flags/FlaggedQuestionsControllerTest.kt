package com.nclex.flags

import com.nclex.audit.AuditLogger
import com.nclex.exception.NotFoundException
import com.nclex.exception.UnauthorizedException
import com.nclex.model.AuditLog
import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
import com.nclex.repository.FlaggedQuestionRepository
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.*

class FlaggedQuestionsControllerTest {

    private val flaggedQuestionRepository: FlaggedQuestionRepository = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: FlaggedQuestionsController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        controller = FlaggedQuestionsController(flaggedQuestionRepository, auditLogger)
    }

    private fun mockAuth() {
        every { httpRequest.getAttribute("userId") } returns userId
    }

    private fun createFlag(
        category: FlagCategory = FlagCategory.REVIEW,
        topic: String = "Pharmacology"
    ) = FlaggedQuestion(
        userId = userId,
        topic = topic,
        question = mapOf("stem" to "test question"),
        category = category,
        notes = "test notes"
    )

    // ── extractUserId ───────────────────────────────────────────────

    @Nested
    inner class ExtractUserId {

        @Test
        fun `no userId attribute throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns null

            assertThatThrownBy {
                controller.getFlags(null, null, httpRequest)
            }.isInstanceOf(UnauthorizedException::class.java)
        }

        @Test
        fun `wrong type attribute throws UnauthorizedException`() {
            every { httpRequest.getAttribute("userId") } returns "not-a-uuid"

            assertThatThrownBy {
                controller.getFlags(null, null, httpRequest)
            }.isInstanceOf(UnauthorizedException::class.java)
        }
    }

    // ── getFlags ────────────────────────────────────────────────────

    @Nested
    inner class GetFlags {

        @Test
        fun `by category filters correctly`() {
            mockAuth()
            val flags = listOf(createFlag(FlagCategory.BOOKMARK))
            every { flaggedQuestionRepository.findByUserIdAndCategory(userId, FlagCategory.BOOKMARK) } returns flags

            val result = controller.getFlags(FlagCategory.BOOKMARK, null, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
            verify { flaggedQuestionRepository.findByUserIdAndCategory(userId, FlagCategory.BOOKMARK) }
        }

        @Test
        fun `by topic filters correctly`() {
            mockAuth()
            val flags = listOf(createFlag(topic = "Cardiology"))
            every { flaggedQuestionRepository.findByUserIdAndTopic(userId, "Cardiology") } returns flags

            val result = controller.getFlags(null, "Cardiology", httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
            verify { flaggedQuestionRepository.findByUserIdAndTopic(userId, "Cardiology") }
        }

        @Test
        fun `no filter returns all flags`() {
            mockAuth()
            val flags = listOf(createFlag(), createFlag(FlagCategory.HARD))
            every { flaggedQuestionRepository.findByUserId(userId) } returns flags

            val result = controller.getFlags(null, null, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
            verify { flaggedQuestionRepository.findByUserId(userId) }
        }

        @Test
        fun `category takes precedence over topic when both provided`() {
            mockAuth()
            val flags = listOf(createFlag(FlagCategory.WRONG))
            every { flaggedQuestionRepository.findByUserIdAndCategory(userId, FlagCategory.WRONG) } returns flags

            val result = controller.getFlags(FlagCategory.WRONG, "Pharmacology", httpRequest)

            assertThat(result.body).hasSize(1)
            verify { flaggedQuestionRepository.findByUserIdAndCategory(userId, FlagCategory.WRONG) }
            verify(exactly = 0) { flaggedQuestionRepository.findByUserIdAndTopic(any(), any()) }
        }
    }

    // ── createFlag ──────────────────────────────────────────────────

    @Nested
    inner class CreateFlag {

        @Test
        fun `success returns 201`() {
            mockAuth()
            val body = CreateFlagRequest(
                topic = "Cardiology",
                question = mapOf("stem" to "test"),
                category = FlagCategory.REVIEW,
                notes = "review later"
            )

            every { flaggedQuestionRepository.save(any()) } answers { firstArg() }

            val result = controller.createFlag(body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(201)
            assertThat(result.body!!.topic).isEqualTo("Cardiology")
            assertThat(result.body!!.category).isEqualTo(FlagCategory.REVIEW)
            verify { auditLogger.log(eq("QUESTION_FLAGGED"), eq(userId), any(), any(), any()) }
        }
    }

    // ── updateFlag ──────────────────────────────────────────────────

    @Nested
    inner class UpdateFlag {

        @Test
        fun `success updates flag`() {
            mockAuth()
            val flagId = UUID.randomUUID()
            val flag = createFlag()
            val body = UpdateFlagRequest(category = FlagCategory.HARD, notes = "updated notes")

            every { flaggedQuestionRepository.findById(flagId) } returns Optional.of(flag)
            every { flaggedQuestionRepository.save(any()) } answers { firstArg() }

            val result = controller.updateFlag(flagId, body, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.category).isEqualTo(FlagCategory.HARD)
            assertThat(result.body!!.notes).isEqualTo("updated notes")
            verify { auditLogger.log(eq("FLAG_UPDATED"), eq(userId), any(), any(), any()) }
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            val flagId = UUID.randomUUID()
            val body = UpdateFlagRequest(notes = "test")

            every { flaggedQuestionRepository.findById(flagId) } returns Optional.empty()

            assertThatThrownBy {
                controller.updateFlag(flagId, body, httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }

        @Test
        fun `flag owned by different user throws NotFoundException`() {
            mockAuth()
            val flagId = UUID.randomUUID()
            val otherUserFlag = FlaggedQuestion(
                userId = UUID.randomUUID(), // different user
                topic = "Pharm",
                question = emptyMap(),
                category = FlagCategory.REVIEW
            )
            val body = UpdateFlagRequest(notes = "test")

            every { flaggedQuestionRepository.findById(flagId) } returns Optional.of(otherUserFlag)

            assertThatThrownBy {
                controller.updateFlag(flagId, body, httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }
    }

    // ── deleteFlag ──────────────────────────────────────────────────

    @Nested
    inner class DeleteFlag {

        @Test
        fun `success deletes and returns message`() {
            mockAuth()
            val flagId = UUID.randomUUID()

            every { flaggedQuestionRepository.deleteByIdAndUserId(flagId, userId) } returns 1L

            val result = controller.deleteFlag(flagId, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["message"]).isEqualTo("Deleted successfully")
            verify { auditLogger.log(eq("FLAG_DELETED"), eq(userId), any(), any(), any()) }
        }

        @Test
        fun `not found throws NotFoundException`() {
            mockAuth()
            val flagId = UUID.randomUUID()

            every { flaggedQuestionRepository.deleteByIdAndUserId(flagId, userId) } returns 0L

            assertThatThrownBy {
                controller.deleteFlag(flagId, httpRequest)
            }.isInstanceOf(NotFoundException::class.java)
        }
    }
}
