package com.nclex.cache

import com.nclex.exception.NotFoundException
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.time.temporal.ChronoUnit

data class CacheEntryRequest(
    @field:NotBlank(message = "Content key is required")
    val contentKey: String,
    @field:NotBlank(message = "Source is required")
    val source: String,
    val data: Map<String, Any>,
    val ttlDays: Int = 7
)

@RestController
@RequestMapping("/api/cache")
class ContentCacheController(
    private val contentCacheRepository: ContentCacheRepository
) {

    @GetMapping
    fun getByKey(@RequestParam key: String): ResponseEntity<ContentCache> {
        val entry = contentCacheRepository.findByContentKey(key)
            ?: throw NotFoundException("Cache entry not found for key: $key")

        // Check if expired
        if (entry.expiresAt.isBefore(Instant.now())) {
            throw NotFoundException("Cache entry expired for key: $key")
        }

        return ResponseEntity.ok(entry)
    }

    @PutMapping
    @Transactional
    fun upsert(@Valid @RequestBody body: CacheEntryRequest): ResponseEntity<ContentCache> {
        val existing = contentCacheRepository.findByContentKey(body.contentKey)
        val now = Instant.now()
        val expiresAt = now.plus(body.ttlDays.toLong(), ChronoUnit.DAYS)

        val entry = if (existing != null) {
            existing.data = body.data
            existing.updatedAt = now
            contentCacheRepository.save(existing)
        } else {
            contentCacheRepository.save(
                ContentCache(
                    contentKey = body.contentKey,
                    source = body.source,
                    data = body.data,
                    ttlDays = body.ttlDays,
                    expiresAt = expiresAt
                )
            )
        }

        return ResponseEntity.ok(entry)
    }

    @DeleteMapping("/expired")
    @Transactional
    fun deleteExpired(): ResponseEntity<Map<String, Any>> {
        val count = contentCacheRepository.deleteExpired(Instant.now())
        return ResponseEntity.ok(mapOf("deleted" to count))
    }
}
