package com.nclex.reading

import com.nclex.exception.UnauthorizedException
import com.nclex.model.ReadingPosition
import com.nclex.repository.ReadingPositionRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.UUID

data class ReadingPositionRequest(
    val contentKey: String,
    val position: Map<String, Any>
)

@RestController
@RequestMapping("/api/reading-positions")
class ReadingPositionController(
    private val readingPositionRepository: ReadingPositionRepository
) {

    @GetMapping
    fun getAll(request: HttpServletRequest): ResponseEntity<List<ReadingPosition>> {
        val userId = extractUserId(request)
        return ResponseEntity.ok(readingPositionRepository.findByUserId(userId))
    }

    @GetMapping("/{contentKey}")
    fun getByKey(
        @PathVariable contentKey: String,
        request: HttpServletRequest
    ): ResponseEntity<ReadingPosition?> {
        val userId = extractUserId(request)
        val pos = readingPositionRepository.findByUserIdAndContentKey(userId, contentKey)
        return ResponseEntity.ok(pos)
    }

    @PutMapping
    @Transactional
    fun upsert(
        @RequestBody body: ReadingPositionRequest,
        request: HttpServletRequest
    ): ResponseEntity<ReadingPosition> {
        val userId = extractUserId(request)
        val existing = readingPositionRepository.findByUserIdAndContentKey(userId, body.contentKey)

        val pos = if (existing != null) {
            existing.position = body.position
            existing.updatedAt = Instant.now()
            readingPositionRepository.save(existing)
        } else {
            readingPositionRepository.save(
                ReadingPosition(
                    userId = userId,
                    contentKey = body.contentKey,
                    position = body.position
                )
            )
        }

        return ResponseEntity.ok(pos)
    }

    private fun extractUserId(request: HttpServletRequest): UUID {
        return request.getAttribute("userId") as? UUID
            ?: throw UnauthorizedException()
    }
}
