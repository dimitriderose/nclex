package com.nclex.content

import com.nclex.exception.NotFoundException
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID

class ContentControllerTest {

    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val httpRequest: HttpServletRequest = mockk()
    private lateinit var controller: ContentController

    @BeforeEach
    fun setUp() {
        controller = ContentController(contentCacheRepository)
    }

    // ── getContent ─────────────────────────────────────────────────

    @Nested
    inner class GetContent {

        @Test
        fun `found and not expired returns 200`() {
            val cache = ContentCache(
                contentKey = "key1",
                source = "openstax",
                data = mapOf("chapter" to "1"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("key1") } returns cache

            val result = controller.getContent("key1", httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.contentKey).isEqualTo("key1")
        }

        @Test
        fun `not found throws NotFoundException`() {
            every { contentCacheRepository.findByContentKey("missing") } returns null

            assertThatThrownBy { controller.getContent("missing", httpRequest) }
                .isInstanceOf(NotFoundException::class.java)
                .hasMessageContaining("Content not found")
        }

        @Test
        fun `expired content deletes and throws NotFoundException`() {
            val cache = ContentCache(
                contentKey = "expired",
                source = "src",
                data = emptyMap(),
                expiresAt = Instant.now().minusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("expired") } returns cache
            every { contentCacheRepository.delete(cache) } just Runs

            assertThatThrownBy { controller.getContent("expired", httpRequest) }
                .isInstanceOf(NotFoundException::class.java)
                .hasMessageContaining("Content expired")

            verify { contentCacheRepository.delete(cache) }
        }
    }

    // ── upsertContent ──────────────────────────────────────────────

    @Nested
    inner class UpsertContent {

        @Test
        fun `new content creates entry`() {
            every { contentCacheRepository.findByContentKey("new-key") } returns null
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = UpsertContentRequest(
                contentKey = "new-key",
                source = "openstax",
                data = mapOf("chapter" to "2"),
                ttlDays = 14
            )
            val result = controller.upsertContent(request, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            verify { contentCacheRepository.save(match { it.contentKey == "new-key" && it.ttlDays == 14 }) }
        }

        @Test
        fun `existing content updates entry`() {
            val existing = ContentCache(
                contentKey = "existing-key",
                source = "old-src",
                data = mapOf("old" to "data"),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.findByContentKey("existing-key") } returns existing
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = UpsertContentRequest(
                contentKey = "existing-key",
                source = "new-src",
                data = mapOf("new" to "data"),
                ttlDays = 7
            )
            val result = controller.upsertContent(request, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            verify { contentCacheRepository.save(match { it.source == "new-src" }) }
        }

        @Test
        fun `null ttlDays defaults to 30`() {
            every { contentCacheRepository.findByContentKey("key") } returns null
            every { contentCacheRepository.save(any()) } answers { firstArg() }

            val request = UpsertContentRequest(contentKey = "key", source = "s", data = emptyMap(), ttlDays = null)
            controller.upsertContent(request, httpRequest)

            verify { contentCacheRepository.save(match { it.ttlDays == 30 }) }
        }
    }

    // ── searchContent ──────────────────────────────────────────────

    @Nested
    inner class SearchContent {

        @Test
        fun `returns matching results`() {
            val cache = ContentCache(
                contentKey = "pharm-101",
                source = "openstax",
                data = emptyMap(),
                expiresAt = Instant.now().plusSeconds(3600)
            )
            every { contentCacheRepository.searchByKeyOrSource("pharm", any()) } returns listOf(cache)

            val result = controller.searchContent("pharm", httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
        }

        @Test
        fun `empty results returns empty list`() {
            every { contentCacheRepository.searchByKeyOrSource("xyz", any()) } returns emptyList()

            val result = controller.searchContent("xyz", httpRequest)

            assertThat(result.body).isEmpty()
        }
    }

    // ── bulkGetContent ─────────────────────────────────────────────

    @Nested
    inner class BulkGetContent {

        @Test
        fun `returns non-expired entries only`() {
            val valid = ContentCache(contentKey = "k1", source = "s", data = emptyMap(), expiresAt = Instant.now().plusSeconds(3600))
            val expired = ContentCache(contentKey = "k2", source = "s", data = emptyMap(), expiresAt = Instant.now().minusSeconds(3600))
            every { contentCacheRepository.findByContentKeyIn(listOf("k1", "k2")) } returns listOf(valid, expired)

            val result = controller.bulkGetContent(BulkKeysRequest(listOf("k1", "k2")), httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
            assertThat(result.body!![0].contentKey).isEqualTo("k1")
        }

        @Test
        fun `empty keys returns empty list`() {
            every { contentCacheRepository.findByContentKeyIn(emptyList()) } returns emptyList()

            val result = controller.bulkGetContent(BulkKeysRequest(emptyList()), httpRequest)

            assertThat(result.body).isEmpty()
        }
    }

    // ── deleteExpired ──────────────────────────────────────────────

    @Nested
    inner class DeleteExpired {

        @Test
        fun `returns count of deleted`() {
            every { contentCacheRepository.deleteExpired(any()) } returns 3

            val result = controller.deleteExpired()

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["deleted"]).isEqualTo(3)
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `UpsertContentRequest defaults`() {
            val req = UpsertContentRequest(contentKey = "k", source = "s", data = emptyMap())
            assertThat(req.ttlDays).isEqualTo(30)
        }

        @Test
        fun `BulkKeysRequest holds keys`() {
            val req = BulkKeysRequest(listOf("a", "b"))
            assertThat(req.keys).hasSize(2)
        }
    }
}
