package com.nclex.content

import com.nclex.exception.NotFoundException
import com.nclex.model.ContentCache
import com.nclex.repository.ContentCacheRepository
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/content")
class ContentController(
    private val contentCacheRepository: ContentCacheRepository
) {
    @GetMapping("/{key}")
    fun getContent(
        @PathVariable key: String,
        request: HttpServletRequest
    ): ResponseEntity<ContentCache> {
        val content = contentCacheRepository.findByContentKey(key)
            ?: throw NotFoundException("Content not found: $key")

        // Check expiry
        if (content.expiresAt.isBefore(Instant.now())) {
            contentCacheRepository.delete(content)
            throw NotFoundException("Content expired: $key")
        }

        return ResponseEntity.ok(content)
    }

    @PutMapping
    fun upsertContent(
        @Valid @RequestBody body: UpsertContentRequest,
        request: HttpServletRequest
    ): ResponseEntity<ContentCache> {
        val now = Instant.now()
        val ttlDays = body.ttlDays ?: 30
        val expiresAt = now.plusSeconds(ttlDays.toLong() * 86400)

        val existing = contentCacheRepository.findByContentKey(body.contentKey)

        val saved = if (existing != null) {
            contentCacheRepository.save(
                existing.copy(
                    source = body.source,
                    data = body.data,
                    ttlDays = ttlDays,
                    expiresAt = expiresAt,
                    updatedAt = now
                )
            )
        } else {
            contentCacheRepository.save(
                ContentCache(
                    id = UUID.randomUUID(),
                    contentKey = body.contentKey,
                    source = body.source,
                    data = body.data,
                    ttlDays = ttlDays,
                    expiresAt = expiresAt,
                    createdAt = now,
                    updatedAt = now
                )
            )
        }

        return ResponseEntity.ok(saved)
    }

    @GetMapping("/search")
    fun searchContent(
        @RequestParam q: String,
        request: HttpServletRequest
    ): ResponseEntity<List<ContentCache>> {
        val results = contentCacheRepository.searchByKeyOrSource(q, Instant.now())
        return ResponseEntity.ok(results)
    }

    @PostMapping("/bulk")
    fun bulkGetContent(
        @RequestBody body: BulkKeysRequest,
        request: HttpServletRequest
    ): ResponseEntity<List<ContentCache>> {
        val results = contentCacheRepository.findByContentKeyIn(body.keys)
            .filter { it.expiresAt.isAfter(Instant.now()) }
        return ResponseEntity.ok(results)
    }

    @DeleteMapping("/expired")
    fun deleteExpired(): ResponseEntity<Map<String, Int>> {
        val deleted = contentCacheRepository.deleteExpired(Instant.now())
        return ResponseEntity.ok(mapOf("deleted" to deleted))
    }
}

data class UpsertContentRequest(
    @field:NotBlank val contentKey: String,
    @field:NotBlank val source: String,
    val data: Map<String, Any>,
    val ttlDays: Int? = 30
)

data class BulkKeysRequest(
    @field:Size(max = 100) val keys: List<String>
)
