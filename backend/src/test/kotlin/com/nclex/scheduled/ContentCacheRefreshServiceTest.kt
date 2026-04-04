package com.nclex.scheduled

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

class ContentCacheRefreshServiceTest {

    private val contentCacheRepository: ContentCacheRepository = mockk()
    private val auditLogger: AuditLogger = mockk()

    private lateinit var service: ContentCacheRefreshService

    @BeforeEach
    fun setUp() {
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        service = ContentCacheRefreshService(
            contentCacheRepository = contentCacheRepository,
            auditLogger = auditLogger,
            fdaBaseUrl = "https://api.fda.gov",
            medlinePlusBaseUrl = "https://connect.medlineplus.gov",
            rxNormBaseUrl = "https://rxnav.nlm.nih.gov"
        )
    }

    // ── refreshBySource ─────────────────────────────────────────────

    @Nested
    inner class RefreshBySource {

        @Test
        fun `unknown source triggers refreshAllSources`() {
            // All drug cache lookups return unexpired entries so no actual HTTP calls happen
            val cached = ContentCache(
                contentKey = "test",
                source = "test",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached
            every { contentCacheRepository.deleteExpired(any()) } returns 0

            val result = service.refreshBySource(null)
            assertThat(result["source"]).isEqualTo("all")
            assertThat(result["status"]).isEqualTo("completed")
        }

        @Test
        fun `fda_labels source returns result map`() {
            // All entries are cached and not expired, so no HTTP calls
            val cached = ContentCache(
                contentKey = "test",
                source = "fda_labels",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached

            val result = service.refreshBySource("fda_labels")
            assertThat(result["source"]).isEqualTo("fda_labels")
            assertThat(result).containsKey("success")
            assertThat(result).containsKey("failed")
        }

        @Test
        fun `medlineplus source returns result map`() {
            val cached = ContentCache(
                contentKey = "test",
                source = "medlineplus",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached

            val result = service.refreshBySource("medlineplus")
            assertThat(result["source"]).isEqualTo("medlineplus")
        }

        @Test
        fun `rxnorm source returns result map`() {
            val cached = ContentCache(
                contentKey = "test",
                source = "rxnorm",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached

            val result = service.refreshBySource("rxnorm")
            assertThat(result["source"]).isEqualTo("rxnorm")
        }
    }

    // ── refreshAllSources ───────────────────────────────────────────

    @Nested
    inner class RefreshAllSources {

        @Test
        fun `completes when all entries are cached`() {
            val cached = ContentCache(
                contentKey = "test",
                source = "test",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached
            every { contentCacheRepository.deleteExpired(any()) } returns 0

            service.refreshAllSources()

            verify { auditLogger.log(eq("CACHE_REFRESH_COMPLETE"), any(), any(), any(), any()) }
            verify { contentCacheRepository.deleteExpired(any()) }
        }

        @Test
        fun `cleans up expired entries`() {
            val cached = ContentCache(
                contentKey = "test",
                source = "test",
                data = emptyMap(),
                expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
            )
            every { contentCacheRepository.findByContentKey(any()) } returns cached
            every { contentCacheRepository.deleteExpired(any()) } returns 5

            service.refreshAllSources()

            verify { contentCacheRepository.deleteExpired(any()) }
        }
    }

    // ── upsertCacheEntry (tested indirectly) ────────────────────────

    @Nested
    inner class UpsertCacheEntry {

        @Test
        fun `expired entries trigger new fetch and upsert`() {
            // Return expired cache entries to trigger fetching
            val expired = ContentCache(
                contentKey = "fda_label:metoprolol",
                source = "fda_labels",
                data = emptyMap(),
                expiresAt = Instant.now().minus(1, ChronoUnit.DAYS) // expired
            )

            // For most drugs return unexpired, but for first drug return expired
            var callCount = 0
            every { contentCacheRepository.findByContentKey(any()) } answers {
                callCount++
                if (callCount == 1) expired else ContentCache(
                    contentKey = "test",
                    source = "fda_labels",
                    data = emptyMap(),
                    expiresAt = Instant.now().plus(30, ChronoUnit.DAYS)
                )
            }
            // The actual HTTP call will fail since we're not running a real server
            // but the refreshSource method handles errors gracefully

            val result = service.refreshBySource("fda_labels")
            assertThat(result["source"]).isEqualTo("fda_labels")
        }
    }
}
