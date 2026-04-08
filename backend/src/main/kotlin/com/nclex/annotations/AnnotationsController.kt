package com.nclex.annotations

import com.nclex.audit.AuditLogger
import com.nclex.exception.UnauthorizedException
import com.nclex.model.Bookmark
import com.nclex.model.UserHighlight
import com.nclex.repository.BookmarkRepository
import com.nclex.repository.HighlightRepository
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.UUID

// --- Request DTOs ---

data class BookmarkSyncItem(
    val action: String, // "upsert" | "delete"
    val clientId: String,
    val contentKey: String? = null,
    val page: Int? = null,
    val label: String? = null
)

data class BookmarkSyncRequest(
    val items: List<BookmarkSyncItem>
)

data class HighlightSyncItem(
    val action: String, // "upsert" | "delete"
    val clientId: String,
    val contentKey: String? = null,
    val color: String? = null,
    val text: String? = null,
    val note: String? = null,
    val startXpath: String? = null,
    val startOffset: Int? = null,
    val endXpath: String? = null,
    val endOffset: Int? = null
)

data class HighlightSyncRequest(
    val items: List<HighlightSyncItem>
)

// --- Response DTOs ---

data class BookmarkResponseDTO(
    val id: UUID,
    val clientId: String,
    val contentKey: String,
    val page: Int,
    val label: String?,
    val deletedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class HighlightResponseDTO(
    val id: UUID,
    val clientId: String,
    val contentKey: String,
    val color: String,
    val text: String,
    val note: String?,
    val startXpath: String,
    val startOffset: Int,
    val endXpath: String,
    val endOffset: Int,
    val deletedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class BookmarkSyncResponse(
    val bookmarks: List<BookmarkResponseDTO>,
    val serverTime: Instant
)

data class HighlightSyncResponse(
    val highlights: List<HighlightResponseDTO>,
    val serverTime: Instant
)

data class ChangesResponse(
    val bookmarks: List<BookmarkResponseDTO>,
    val highlights: List<HighlightResponseDTO>,
    val serverTime: Instant
)

// --- Mapping extensions ---

fun Bookmark.toDTO() = BookmarkResponseDTO(
    id = id,
    clientId = clientId,
    contentKey = contentKey,
    page = page,
    label = label,
    deletedAt = deletedAt,
    createdAt = createdAt,
    updatedAt = updatedAt
)

fun UserHighlight.toDTO() = HighlightResponseDTO(
    id = id,
    clientId = clientId,
    contentKey = contentKey,
    color = color,
    text = text,
    note = note,
    startXpath = startXpath,
    startOffset = startOffset,
    endXpath = endXpath,
    endOffset = endOffset,
    deletedAt = deletedAt,
    createdAt = createdAt,
    updatedAt = updatedAt
)

@RestController
@RequestMapping("/api/annotations")
class AnnotationsController(
    private val bookmarkRepository: BookmarkRepository,
    private val highlightRepository: HighlightRepository,
    private val auditLogger: AuditLogger
) {
    companion object {
        private val logger = LoggerFactory.getLogger(AnnotationsController::class.java)
    }

    // --- Bookmarks ---

    @GetMapping("/bookmarks")
    fun getBookmarks(
        @RequestParam(required = false) contentKey: String?,
        request: HttpServletRequest
    ): ResponseEntity<List<BookmarkResponseDTO>> {
        val userId = extractUserId(request)
        val bookmarks = if (contentKey != null) {
            bookmarkRepository.findByUserIdAndContentKeyAndDeletedAtIsNull(userId, contentKey)
        } else {
            bookmarkRepository.findByUserIdAndDeletedAtIsNull(userId)
        }
        logger.info("event=BOOKMARKS_FETCHED userId={} contentKey={} count={}", userId, contentKey, bookmarks.size)
        return ResponseEntity.ok(bookmarks.map { it.toDTO() })
    }

    @PostMapping("/bookmarks/sync")
    @Transactional
    fun syncBookmarks(
        @RequestBody body: BookmarkSyncRequest,
        request: HttpServletRequest
    ): ResponseEntity<BookmarkSyncResponse> {
        val userId = extractUserId(request)
        val now = Instant.now()

        // Fix 7: Unbounded sync payload
        if (body.items.size > 500) {
            logger.warn("event=SYNC_PAYLOAD_TOO_LARGE userId={} itemCount={} type=bookmarks", userId, body.items.size)
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Too many items: max 500 per sync request")
        }

        // Fix 5: Batch fetch to avoid N+1
        val clientIds = body.items.map { it.clientId }
        val existingMap = bookmarkRepository.findAllByUserIdAndClientIdIn(userId, clientIds)
            .associateBy { it.clientId }

        for (item in body.items) {
            when (item.action) {
                "upsert" -> {
                    val existing = existingMap[item.clientId]
                    if (existing != null) {
                        existing.label = item.label
                        existing.deletedAt = null // Fix 4: un-soft-delete if re-bookmarking
                        existing.updatedAt = now
                        bookmarkRepository.save(existing)
                    } else {
                        val contentKey = item.contentKey
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "contentKey required for new bookmark")
                        val page = item.page
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "page required for new bookmark")

                        // Fix 4: Check for soft-deleted bookmark with same (userId, contentKey, page)
                        val softDeleted = bookmarkRepository.findByUserIdAndContentKeyAndPage(userId, contentKey, page)
                        if (softDeleted != null && softDeleted.deletedAt != null) {
                            softDeleted.clientId = item.clientId
                            softDeleted.label = item.label
                            softDeleted.deletedAt = null
                            softDeleted.updatedAt = now
                            bookmarkRepository.save(softDeleted)
                        } else {
                            bookmarkRepository.save(
                                Bookmark(
                                    userId = userId,
                                    contentKey = contentKey,
                                    page = page,
                                    label = item.label,
                                    clientId = item.clientId,
                                    createdAt = now,
                                    updatedAt = now
                                )
                            )
                        }
                    }
                }
                "delete" -> {
                    val existing = existingMap[item.clientId]
                    if (existing != null) {
                        existing.deletedAt = now
                        existing.updatedAt = now
                        bookmarkRepository.save(existing)
                    }
                }
                else -> {
                    logger.warn("event=SYNC_UNKNOWN_ACTION userId={} action={}", userId, item.action)
                    throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown action: ${item.action}")
                }
            }
        }

        val upsertCount = body.items.count { it.action == "upsert" }
        val deleteCount = body.items.count { it.action == "delete" }

        logger.info("event=BOOKMARKS_SYNCED userId={} total={} upserts={} deletes={}", userId, body.items.size, upsertCount, deleteCount)

        auditLogger.log(
            eventType = "BOOKMARKS_SYNCED",
            userId = userId,
            metadata = mapOf("itemCount" to body.items.size, "upsertCount" to upsertCount, "deleteCount" to deleteCount)
        )

        // Fix 9: Return ALL items (including soft-deleted) so client can see deletions
        val contentKeys = body.items.mapNotNull { it.contentKey }.distinct()
        val bookmarks = contentKeys.flatMap {
            bookmarkRepository.findByUserIdAndContentKey(userId, it)
        }

        return ResponseEntity.ok(BookmarkSyncResponse(bookmarks = bookmarks.map { it.toDTO() }, serverTime = now))
    }

    // --- Highlights ---

    @GetMapping("/highlights")
    fun getHighlights(
        @RequestParam(required = false) contentKey: String?,
        request: HttpServletRequest
    ): ResponseEntity<List<HighlightResponseDTO>> {
        val userId = extractUserId(request)
        val highlights = if (contentKey != null) {
            highlightRepository.findByUserIdAndContentKeyAndDeletedAtIsNull(userId, contentKey)
        } else {
            highlightRepository.findByUserIdAndDeletedAtIsNull(userId)
        }
        logger.info("event=HIGHLIGHTS_FETCHED userId={} contentKey={} count={}", userId, contentKey, highlights.size)
        return ResponseEntity.ok(highlights.map { it.toDTO() })
    }

    @PostMapping("/highlights/sync")
    @Transactional
    fun syncHighlights(
        @RequestBody body: HighlightSyncRequest,
        request: HttpServletRequest
    ): ResponseEntity<HighlightSyncResponse> {
        val userId = extractUserId(request)
        val now = Instant.now()

        // Fix 7: Unbounded sync payload
        if (body.items.size > 500) {
            logger.warn("event=SYNC_PAYLOAD_TOO_LARGE userId={} itemCount={} type=highlights", userId, body.items.size)
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Too many items: max 500 per sync request")
        }

        // Fix 5: Batch fetch to avoid N+1
        val clientIds = body.items.map { it.clientId }
        val existingMap = highlightRepository.findAllByUserIdAndClientIdIn(userId, clientIds)
            .associateBy { it.clientId }

        for (item in body.items) {
            when (item.action) {
                "upsert" -> {
                    val existing = existingMap[item.clientId]
                    if (existing != null) {
                        existing.color = item.color ?: existing.color
                        // Fix 10: Truncate text and note
                        existing.text = (item.text ?: existing.text).take(5000)
                        existing.note = item.note?.take(2000)
                        existing.deletedAt = null
                        existing.updatedAt = now
                        highlightRepository.save(existing)
                    } else {
                        val contentKey = item.contentKey
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "contentKey required for new highlight")
                        val color = item.color
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "color required for new highlight")
                        val text = item.text
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "text required for new highlight")
                        val startXpath = item.startXpath
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "startXpath required for new highlight")
                        val startOffset = item.startOffset
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "startOffset required for new highlight")
                        val endXpath = item.endXpath
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "endXpath required for new highlight")
                        val endOffset = item.endOffset
                            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "endOffset required for new highlight")

                        highlightRepository.save(
                            UserHighlight(
                                userId = userId,
                                contentKey = contentKey,
                                clientId = item.clientId,
                                color = color,
                                text = text.take(5000),        // Fix 10
                                note = item.note?.take(2000),  // Fix 10
                                startXpath = startXpath,
                                startOffset = startOffset,
                                endXpath = endXpath,
                                endOffset = endOffset,
                                createdAt = now,
                                updatedAt = now
                            )
                        )
                    }
                }
                "delete" -> {
                    val existing = existingMap[item.clientId]
                    if (existing != null) {
                        existing.deletedAt = now
                        existing.updatedAt = now
                        highlightRepository.save(existing)
                    }
                }
                else -> {
                    logger.warn("event=SYNC_UNKNOWN_ACTION userId={} action={}", userId, item.action)
                    throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown action: ${item.action}")
                }
            }
        }

        val upsertCount = body.items.count { it.action == "upsert" }
        val deleteCount = body.items.count { it.action == "delete" }

        logger.info("event=HIGHLIGHTS_SYNCED userId={} total={} upserts={} deletes={}", userId, body.items.size, upsertCount, deleteCount)

        auditLogger.log(
            eventType = "HIGHLIGHTS_SYNCED",
            userId = userId,
            metadata = mapOf("itemCount" to body.items.size, "upsertCount" to upsertCount, "deleteCount" to deleteCount)
        )

        // Fix 9: Return ALL items (including soft-deleted) so client can see deletions
        val contentKeys = body.items.mapNotNull { it.contentKey }.distinct()
        val highlights = contentKeys.flatMap {
            highlightRepository.findByUserIdAndContentKey(userId, it)
        }

        return ResponseEntity.ok(HighlightSyncResponse(highlights = highlights.map { it.toDTO() }, serverTime = now))
    }

    // --- Delta Sync ---

    @GetMapping("/changes")
    fun getChanges(
        @RequestParam since: Instant,
        request: HttpServletRequest
    ): ResponseEntity<ChangesResponse> {
        val userId = extractUserId(request)
        val now = Instant.now()

        val bookmarks = bookmarkRepository.findChangedSince(userId, since)
        val highlights = highlightRepository.findChangedSince(userId, since)

        logger.info("event=ANNOTATIONS_DELTA_PULL userId={} since={} bookmarks={} highlights={}", userId, since, bookmarks.size, highlights.size)

        return ResponseEntity.ok(
            ChangesResponse(
                bookmarks = bookmarks.map { it.toDTO() },
                highlights = highlights.map { it.toDTO() },
                serverTime = now
            )
        )
    }

    private fun extractUserId(request: HttpServletRequest): UUID {
        return request.getAttribute("userId") as? UUID
            ?: throw UnauthorizedException()
    }
}
