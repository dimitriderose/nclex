package com.nclex.question

import com.nclex.repository.GeneratedQuestionRepository
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID

class QuestionBankPersistenceTest {

    private val generatedQuestionRepository: GeneratedQuestionRepository = mockk(relaxed = true)
    private val persistence = QuestionBankPersistence(generatedQuestionRepository)

    @Test
    fun `bumpUsage with empty id list never reaches the repository`() {
        persistence.bumpUsage(emptyList())

        verify(exactly = 0) { generatedQuestionRepository.bumpUsage(any(), any()) }
    }

    @Test
    fun `bumpUsage sorts ids before delegating to the repository`() {
        val a = UUID.fromString("00000000-0000-0000-0000-000000000001")
        val b = UUID.fromString("00000000-0000-0000-0000-000000000002")
        val c = UUID.fromString("00000000-0000-0000-0000-000000000003")
        val idsSlot = slot<List<UUID>>()
        val nowSlot = slot<Instant>()

        persistence.bumpUsage(listOf(c, a, b))

        verify(exactly = 1) { generatedQuestionRepository.bumpUsage(capture(idsSlot), capture(nowSlot)) }
        org.assertj.core.api.Assertions.assertThat(idsSlot.captured).containsExactly(a, b, c)
    }
}
