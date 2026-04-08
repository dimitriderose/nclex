package com.nclex.cache

import com.nclex.exception.NotFoundException
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class ContentCacheControllerTest {

    private val contentCacheRepository: ContentCacheRepository = mockk()
    private lateinit var controller: ContentCacheController

    @BeforeEach
    fun setUp() {
        controller = ContentCacheController(contentCacheRepository)
    }

    // ── getByKey ───────────────────────────────────────────────────

    @Nested
    inner class GetByKey {

        @Test
        fun `found and not expired returns 200`() {
            val cache = ContentCache(
                contentKey = "test-key",
                source = "fda",
                data = mapOf("info" to "data"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("test-key") } returns cache

            val result = controller.getByKey("test-key")

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.contentKey).isEqualTo("test-key")
        }

        @Test
        fun `not found throws NotFoundException`() {
            every { contentCacheRepository.findByContentKey("missing") } returns null

            assertThatThrownBy { controller.getByKey("missing") }
                .isInstanceOf(NotFoundException::class.java)
                .hasMessageContaining("Cache entry not found")
        }

        @Test
        fun `expired entry throws NotFoundException`() {
            val cache = ContentCache(
                contentKey = "expired-key",
                source = "fda",
                data = mapOf("info" to "old data"),
                expiresAt = Instant.now().minusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("expired-key") } returns cache

            assertThatThrownBy { controller.getByKey("expired-key") }
                .isInstanceOf(NotFoundException::class.java)
                .hasMessageContaining("Cache entry expired")
        }
    }

    // ── upsert ─────────────────────────────────────────────────────

    @Nested
    inner class Upsert {

        @Test
        fun `new entry creates and returns 200`() {
            every { contentCacheRepository.findByContentKey("new-key") } returns null
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = CacheEntryRequest(
                contentKey = "new-key",
                source = "rxnorm",
                data = mapOf("drug" to "metoprolol"),
                ttlDays = 14
            )
            val result = controller.upsert(request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            verify { contentCacheRepository.save(match { it.contentKey == "new-key" && it.source == "rxnorm" }) }
        }

        @Test
        fun `existing entry updates data and returns 200`() {
            val existing = ContentCache(
                contentKey = "existing-key",
                source = "fda",
                data = mapOf("old" to "data"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("existing-key") } returns existing
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = CacheEntryRequest(
                contentKey = "existing-key",
                source = "fda",
                data = mapOf("new" to "data"),
                ttlDays = 7
            )
            val result = controller.upsert(request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(existing.data).isEqualTo(mapOf("new" to "data"))
        }

        @Test
        fun `default ttlDays is 7`() {
            every { contentCacheRepository.findByContentKey("key") } returns null
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = CacheEntryRequest(contentKey = "key", source = "src", data = emptyMap())
            controller.upsert(request)

            verify { contentCacheRepository.save(match { it.ttlDays == 7 }) }
        }
    }

    // ── deleteExpired ──────────────────────────────────────────────

    @Nested
    inner class DeleteExpired {

        @Test
        fun `returns count of deleted entries`() {
            every { contentCacheRepository.deleteExpired(any()) } returns 5

            val result = controller.deleteExpired()

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["deleted"]).isEqualTo(5)
        }

        @Test
        fun `zero deletions returns zero`() {
            every { contentCacheRepository.deleteExpired(any()) } returns 0

            val result = controller.deleteExpired()

            assertThat(result.body!!["deleted"]).isEqualTo(0)
        }
    }
}
