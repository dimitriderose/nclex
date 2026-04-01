package com.nclex.scheduled

import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import com.nclex.audit.AuditLogger
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient
import java.time.Instant
import java.time.temporal.ChronoUnit

@Service
class ContentCacheRefreshService(
    private val contentCacheRepository: ContentCacheRepository,
    private val auditLogger: AuditLogger,
    @Value("\${nclex.cache.fda-base-url:https://api.fda.gov}") private val fdaBaseUrl: String,
    @Value("\${nclex.cache.medlineplus-base-url:https://connect.medlineplus.gov}") private val medlinePlusBaseUrl: String,
    @Value("\${nclex.cache.rxnorm-base-url:https://rxnav.nlm.nih.gov}") private val rxNormBaseUrl: String
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val webClient = WebClient.builder().build()

    companion object {
        private const val MAX_RETRIES = 3
        private const val INITIAL_DELAY_MS = 200L
        private const val TTL_DAYS = 7
    }

    // ── Scheduled Entry Point ────────────────────────────────────────

    @Scheduled(cron = "\${nclex.cache.refresh-cron:0 0 3 * * *}")
    fun refreshAllSources() {
        logger.info("Starting scheduled content cache refresh")
        val startTime = Instant.now()
        val results = mutableMapOf<String, RefreshResult>()

        results["fda_labels"] = refreshSource("fda_labels") { refreshFdaLabels() }
        results["medlineplus"] = refreshSource("medlineplus") { refreshMedlinePlus() }
        results["rxnorm"] = refreshSource("rxnorm") { refreshRxNorm() }

        val elapsed = java.time.Duration.between(startTime, Instant.now())
        val totalSuccess = results.values.sumOf { it.successCount }
        val totalFailed = results.values.sumOf { it.failureCount }

        logger.info(
            "Cache refresh complete: {} succeeded, {} failed, took {}ms",
            totalSuccess, totalFailed, elapsed.toMillis()
        )

        auditLogger.log(
            eventType = "CACHE_REFRESH_COMPLETE",
            metadata = mapOf(
                "results" to results.map { (source, r) ->
                    mapOf(
                        "source" to source,
                        "success" to r.successCount,
                        "failed" to r.failureCount,
                        "errors" to r.errors
                    )
                },
                "totalSuccess" to totalSuccess,
                "totalFailed" to totalFailed,
                "elapsedMs" to elapsed.toMillis()
            )
        )

        // Clean up expired entries
        val deleted = contentCacheRepository.deleteExpired(Instant.now())
        if (deleted > 0) {
            logger.info("Cleaned up {} expired cache entries", deleted)
        }
    }

    // ── Manual Trigger ───────────────────────────────────────────────

    fun refreshBySource(source: String?): Map<String, Any> {
        return when (source) {
            "fda_labels" -> {
                val result = refreshSource("fda_labels") { refreshFdaLabels() }
                mapOf("source" to "fda_labels", "success" to result.successCount, "failed" to result.failureCount)
            }
            "medlineplus" -> {
                val result = refreshSource("medlineplus") { refreshMedlinePlus() }
                mapOf("source" to "medlineplus", "success" to result.successCount, "failed" to result.failureCount)
            }
            "rxnorm" -> {
                val result = refreshSource("rxnorm") { refreshRxNorm() }
                mapOf("source" to "rxnorm", "success" to result.successCount, "failed" to result.failureCount)
            }
            else -> {
                refreshAllSources()
                mapOf("source" to "all", "status" to "completed")
            }
        }
    }

    // ── Source-Specific Refresh Logic ────────────────────────────────

    private fun refreshFdaLabels(): List<CacheEntry> {
        val drugNames = getDrugNamesForRefresh("fda_labels")
        return drugNames.map { drugName ->
            val key = "fda_label:$drugName"
            val data = fetchWithRetry("FDA label for $drugName") {
                webClient.get()
                    .uri("$fdaBaseUrl/drug/label.json?search=openfda.brand_name:\"$drugName\"&limit=1")
                    .retrieve()
                    .bodyToMono(Map::class.java)
                    .block() as? Map<String, Any> ?: emptyMap()
            }
            CacheEntry(key, "fda_labels", data)
        }
    }

    private fun refreshMedlinePlus(): List<CacheEntry> {
        val drugNames = getDrugNamesForRefresh("medlineplus")
        return drugNames.map { drugName ->
            val key = "medlineplus:$drugName"
            val data = fetchWithRetry("MedlinePlus for $drugName") {
                webClient.get()
                    .uri("$medlinePlusBaseUrl/service?mainSearchCriteria.v.cs=2.16.840.1.113883.6.69&mainSearchCriteria.v.dn=$drugName&informationRecipient.languageCode.c=en")
                    .retrieve()
                    .bodyToMono(Map::class.java)
                    .block() as? Map<String, Any> ?: emptyMap()
            }
            CacheEntry(key, "medlineplus", data)
        }
    }

    private fun refreshRxNorm(): List<CacheEntry> {
        val drugNames = getDrugNamesForRefresh("rxnorm")
        return drugNames.map { drugName ->
            val key = "rxnorm:$drugName"
            val data = fetchWithRetry("RxNorm for $drugName") {
                webClient.get()
                    .uri("$rxNormBaseUrl/REST/drugs.json?name=$drugName")
                    .retrieve()
                    .bodyToMono(Map::class.java)
                    .block() as? Map<String, Any> ?: emptyMap()
            }
            CacheEntry(key, "rxnorm", data)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private fun refreshSource(sourceName: String, fetcher: () -> List<CacheEntry>): RefreshResult {
        var successCount = 0
        var failureCount = 0
        val errors = mutableListOf<String>()

        val entries = runCatching { fetcher() }.getOrElse {
            logger.error("Failed to fetch entries for source {}: {}", sourceName, it.message)
            errors.add("Source fetch failed: ${it.message}")
            return RefreshResult(0, 1, errors)
        }

        for (entry in entries) {
            runCatching {
                upsertCacheEntry(entry)
                successCount++
            }.onFailure { ex ->
                failureCount++
                errors.add("${entry.key}: ${ex.message}")
                logger.warn("Failed to cache {}: {}", entry.key, ex.message)
            }
        }

        return RefreshResult(successCount, failureCount, errors)
    }

    private fun <T> fetchWithRetry(description: String, action: () -> T): T {
        var lastException: Throwable? = null
        for (attempt in 1..MAX_RETRIES) {
            runCatching { return action() }.onFailure { ex ->
                lastException = ex
                if (attempt < MAX_RETRIES) {
                    val delayMs = INITIAL_DELAY_MS * (1L shl (attempt - 1)) // exponential backoff
                    logger.debug(
                        "Retry {}/{} for {} after {}ms: {}",
                        attempt, MAX_RETRIES, description, delayMs, ex.message
                    )
                    Thread.sleep(delayMs)
                }
            }
        }
        throw RuntimeException("Failed after $MAX_RETRIES attempts: $description", lastException)
    }

    private fun upsertCacheEntry(entry: CacheEntry) {
        val existing = contentCacheRepository.findByContentKey(entry.key)
        if (existing != null) {
            existing.data = entry.data
            existing.updatedAt = Instant.now()
            contentCacheRepository.save(existing)
        } else {
            contentCacheRepository.save(
                ContentCache(
                    contentKey = entry.key,
                    source = entry.source,
                    data = entry.data,
                    ttlDays = TTL_DAYS,
                    expiresAt = Instant.now().plus(TTL_DAYS.toLong(), ChronoUnit.DAYS)
                )
            )
        }
    }

    private fun getDrugNamesForRefresh(source: String): List<String> {
        // Get drugs whose cache entries are expired or missing
        // For initial implementation, use a curated NCLEX drug list
        val nclexCoreDrugs = listOf(
            "metoprolol", "lisinopril", "metformin", "amlodipine", "omeprazole",
            "levothyroxine", "atorvastatin", "albuterol", "warfarin", "heparin",
            "insulin", "furosemide", "hydrochlorothiazide", "prednisone", "amoxicillin",
            "ciprofloxacin", "gabapentin", "sertraline", "fluoxetine", "lorazepam",
            "morphine", "fentanyl", "acetaminophen", "ibuprofen", "aspirin",
            "digoxin", "potassium chloride", "magnesium sulfate", "vancomycin", "gentamicin",
            "phenytoin", "carbamazepine", "lithium", "haloperidol", "olanzapine",
            "enoxaparin", "clopidogrel", "nitroglycerin", "dopamine", "epinephrine"
        )

        val now = Instant.now()
        return nclexCoreDrugs.filter { drug ->
            val cached = contentCacheRepository.findByContentKey("$source:$drug")
            cached == null || cached.expiresAt.isBefore(now)
        }
    }

    // ── Data Classes ────────────────────────────────────────────────

    private data class CacheEntry(
        val key: String,
        val source: String,
        val data: Map<String, Any>
    )

    private data class RefreshResult(
        val successCount: Int,
        val failureCount: Int,
        val errors: List<String>
    )
}
