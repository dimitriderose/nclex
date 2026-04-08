package com.nclex.annotations

import com.nclex.audit.AuditLogger
import com.nclex.exception.UnauthorizedException
import com.nclex.model.Bookmark
import com.nclex.model.UserHighlight
import com.nclex.repository.BookmarkRepository
import com.nclex.repository.HighlightRepository
import io.mockk.*
// MockK used via mockk() function, not annotations
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.web.server.ResponseStatusException
// import org.junit.jupiter.api.extension.ExtendWith
import java.time.Instant
import java.util.*

class AnnotationsControllerTest {

    private val bookmarkRepository: BookmarkRepository = mockk()
    private val highlightRepository: HighlightRepository = mockk()
    private val auditLogger: AuditLogger = mockk(relaxed = true)
    private val request: HttpServletRequest = mockk()

    private lateinit var controller: AnnotationsController
    private val userId = UUID.randomUUID()

    @BeforeEach
    fun setUp() {
        controller = AnnotationsController(bookmarkRepository, highlightRepository, auditLogger)
    }

    private fun mockAuth() {
        every { request.getAttribute("userId") } returns userId
    }

    // ── Factory helpers ────────────────────────────────────────────

    private fun makeBookmark(
        clientId: String = UUID.randomUUID().toString(),
        contentKey: String = "book-1",
        page: Int = 1,
        label: String? = null,
        deletedAt: Instant? = null
    ) = Bookmark(
        userId = userId,
        clientId = clientId,
        contentKey = contentKey,
        page = page,
        label = label,
        deletedAt = deletedAt
    )

    private fun makeHighlight(
        clientId: String = UUID.randomUUID().toString(),
        contentKey: String = "book-1",
        text: String = "sample highlighted text",
        note: String? = null,
        color: String = "yellow",
        deletedAt: Instant? = null
    ) = UserHighlight(
        userId = userId,
        clientId = clientId,
        contentKey = contentKey,
        text = text,
        note = note,
        color = color,
        startXpath = "/div[1]/p[1]/text()[1]",
        startOffset = 0,
        endXpath = "/div[1]/p[1]/text()[1]",
        endOffset = text.length,
        deletedAt = deletedAt
    )

    // ── Auth ───────────────────────────────────────────────────────

    @Nested
    inner class Auth {

        @Test
        fun `no userId attribute throws UnauthorizedException`() {
            every { request.getAttribute("userId") } returns null

            assertThatThrownBy {
                controller.getBookmarks(null, request)
            }.isInstanceOf(UnauthorizedException::class.java)
        }

        @Test
        fun `wrong type attribute throws UnauthorizedException`() {
            every { request.getAttribute("userId") } returns "string-not-uuid"

            assertThatThrownBy {
                controller.getBookmarks(null, request)
            }.isInstanceOf(UnauthorizedException::class.java)
        }
    }

    // ── GetBookmarks ───────────────────────────────────────────────

    @Nested
    inner class GetBookmarks {

        @Test
        fun `returns filtered by contentKey`() {
            mockAuth()
            val bookmarks = listOf(makeBookmark(contentKey = "book-1", page = 3))
            every {
                bookmarkRepository.findByUserIdAndContentKeyAndDeletedAtIsNull(userId, "book-1")
            } returns bookmarks

            val result = controller.getBookmarks("book-1", request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
            assertThat(result.body!![0].contentKey).isEqualTo("book-1")
        }

        @Test
        fun `returns all when no contentKey`() {
            mockAuth()
            val bookmarks = listOf(
                makeBookmark(contentKey = "book-1", page = 1),
                makeBookmark(contentKey = "book-2", page = 5)
            )
            every { bookmarkRepository.findByUserIdAndDeletedAtIsNull(userId) } returns bookmarks

            val result = controller.getBookmarks(null, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `returns empty for new user`() {
            mockAuth()
            every { bookmarkRepository.findByUserIdAndDeletedAtIsNull(userId) } returns emptyList()

            val result = controller.getBookmarks(null, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).isEmpty()
        }

        @Test
        fun `excludes soft-deleted bookmarks`() {
            mockAuth()
            // The repository method already filters by deletedAtIsNull,
            // so we just verify the correct method is called
            every { bookmarkRepository.findByUserIdAndDeletedAtIsNull(userId) } returns listOf(
                makeBookmark(page = 1)
            )

            val result = controller.getBookmarks(null, request)

            assertThat(result.body).hasSize(1)
            assertThat(result.body!!.all { it.deletedAt == null }).isTrue()
            verify { bookmarkRepository.findByUserIdAndDeletedAtIsNull(userId) }
        }
    }

    // ── SyncBookmarks ──────────────────────────────────────────────

    @Nested
    inner class SyncBookmarks {

        @Test
        fun `upsert creates new bookmark`() {
            mockAuth()
            val clientId = "client-1"
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf(clientId)) } returns emptyList()
            every {
                bookmarkRepository.findByUserIdAndContentKeyAndPage(userId, "book-1", 5)
            } returns null
            val savedBookmark = makeBookmark(clientId = clientId, contentKey = "book-1", page = 5, label = "Ch 3")
            every { bookmarkRepository.save(any()) } returns savedBookmark
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(savedBookmark)

            val body = BookmarkSyncRequest(
                items = listOf(
                    BookmarkSyncItem(action = "upsert", clientId = clientId, contentKey = "book-1", page = 5, label = "Ch 3")
                )
            )

            val result = controller.syncBookmarks(body, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.bookmarks).hasSize(1)
            assertThat(result.body!!.bookmarks[0].contentKey).isEqualTo("book-1")
            assertThat(result.body!!.bookmarks[0].page).isEqualTo(5)
            assertThat(result.body!!.bookmarks[0].label).isEqualTo("Ch 3")
            verify { bookmarkRepository.save(any()) }
        }

        @Test
        fun `upsert updates existing bookmark matched by clientId`() {
            mockAuth()
            val clientId = "client-1"
            val existing = makeBookmark(clientId = clientId, contentKey = "book-1", page = 3)
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf(clientId)) } returns listOf(existing)
            every { bookmarkRepository.save(any()) } answers { firstArg() }
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val body = BookmarkSyncRequest(
                items = listOf(
                    BookmarkSyncItem(action = "upsert", clientId = clientId, contentKey = "book-1", page = 10, label = "Updated")
                )
            )

            val result = controller.syncBookmarks(body, request)

            // Controller only updates label on existing, not page
            assertThat(result.body!!.bookmarks[0].page).isEqualTo(3)
            assertThat(result.body!!.bookmarks[0].label).isEqualTo("Updated")
        }

        @Test
        fun `delete soft-deletes bookmark`() {
            mockAuth()
            val clientId = "client-1"
            val existing = makeBookmark(clientId = clientId, contentKey = "book-1", page = 3)
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf(clientId)) } returns listOf(existing)
            every { bookmarkRepository.save(any()) } answers { firstArg() }
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "delete", clientId = clientId, contentKey = "book-1"))
            )

            val result = controller.syncBookmarks(body, request)

            assertThat(result.body!!.bookmarks[0].deletedAt).isNotNull()
        }

        @Test
        fun `re-bookmark after soft-delete un-deletes and updates clientId`() {
            mockAuth()
            val newClientId = "new-client"
            val softDeleted = makeBookmark(
                clientId = "old-client",
                contentKey = "book-1",
                page = 5,
                deletedAt = Instant.now()
            )
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf(newClientId)) } returns emptyList()
            every {
                bookmarkRepository.findByUserIdAndContentKeyAndPage(userId, "book-1", 5)
            } returns softDeleted
            every { bookmarkRepository.save(any()) } answers { firstArg() }
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(softDeleted)

            val body = BookmarkSyncRequest(
                items = listOf(
                    BookmarkSyncItem(action = "upsert", clientId = newClientId, contentKey = "book-1", page = 5)
                )
            )

            val result = controller.syncBookmarks(body, request)

            assertThat(result.body!!.bookmarks[0].deletedAt).isNull()
            assertThat(result.body!!.bookmarks[0].clientId).isEqualTo(newClientId)
        }

        @Test
        fun `unknown action returns 400`() {
            mockAuth()
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "purge", clientId = "c1"))
            )

            assertThatThrownBy {
                controller.syncBookmarks(body, request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("Unknown action")
        }

        @Test
        fun `more than 500 items returns 400`() {
            mockAuth()
            val items = (1..501).map {
                BookmarkSyncItem(action = "upsert", clientId = "c-$it", contentKey = "b", page = it)
            }

            assertThatThrownBy {
                controller.syncBookmarks(BookmarkSyncRequest(items), request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("500")
        }

        @Test
        fun `missing contentKey returns 400`() {
            mockAuth()
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "upsert", clientId = "c1", contentKey = null, page = 1))
            )

            assertThatThrownBy {
                controller.syncBookmarks(body, request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("contentKey")
        }

        @Test
        fun `missing page returns 400`() {
            mockAuth()
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "upsert", clientId = "c1", contentKey = "book-1", page = null))
            )

            assertThatThrownBy {
                controller.syncBookmarks(body, request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("page")
        }

        @Test
        fun `response includes soft-deleted bookmarks for sync`() {
            mockAuth()
            val clientId = "client-del"
            val existing = makeBookmark(clientId = clientId, contentKey = "book-1", page = 3)
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf(clientId)) } returns listOf(existing)
            every { bookmarkRepository.save(any()) } answers { firstArg() }
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "delete", clientId = clientId, contentKey = "book-1"))
            )

            val result = controller.syncBookmarks(body, request)

            // The response includes the soft-deleted item so the client knows it was processed
            assertThat(result.body!!.bookmarks).hasSize(1)
            assertThat(result.body!!.bookmarks[0].deletedAt).isNotNull()
        }

        @Test
        fun `batch fetch - findAllByUserIdAndClientIdIn called once`() {
            mockAuth()
            val ids = listOf("c1", "c2", "c3")
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, ids) } returns emptyList()
            every {
                bookmarkRepository.findByUserIdAndContentKeyAndPage(userId, any(), any())
            } returns null
            every { bookmarkRepository.save(any()) } answers { firstArg() }
            every { bookmarkRepository.findByUserIdAndContentKey(userId, "b") } returns emptyList()

            val body = BookmarkSyncRequest(
                items = ids.map {
                    BookmarkSyncItem(action = "upsert", clientId = it, contentKey = "b", page = 1)
                }
            )

            controller.syncBookmarks(body, request)

            verify(exactly = 1) { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, ids) }
        }
    }

    // ── GetHighlights ──────────────────────────────────────────────

    @Nested
    inner class GetHighlights {

        @Test
        fun `returns filtered by contentKey`() {
            mockAuth()
            val highlights = listOf(makeHighlight(contentKey = "book-1"))
            every {
                highlightRepository.findByUserIdAndContentKeyAndDeletedAtIsNull(userId, "book-1")
            } returns highlights

            val result = controller.getHighlights("book-1", request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(1)
        }

        @Test
        fun `returns all when no contentKey`() {
            mockAuth()
            val highlights = listOf(
                makeHighlight(contentKey = "book-1"),
                makeHighlight(contentKey = "book-2")
            )
            every { highlightRepository.findByUserIdAndDeletedAtIsNull(userId) } returns highlights

            val result = controller.getHighlights(null, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body).hasSize(2)
        }

        @Test
        fun `returns empty for new user`() {
            mockAuth()
            every { highlightRepository.findByUserIdAndDeletedAtIsNull(userId) } returns emptyList()

            val result = controller.getHighlights(null, request)

            assertThat(result.body).isEmpty()
        }
    }

    // ── SyncHighlights ─────────────────────────────────────────────

    @Nested
    inner class SyncHighlights {

        @Test
        fun `upsert creates new highlight with correct fields`() {
            mockAuth()
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()
            every { highlightRepository.save(any()) } answers { firstArg() }
            val savedHighlight = makeHighlight(clientId = "h1", contentKey = "book-1", text = "important text", note = "my note", color = "blue")
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(savedHighlight)

            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(
                        action = "upsert", clientId = "h1", contentKey = "book-1",
                        text = "important text", note = "my note", color = "blue",
                        startXpath = "/div[1]/p[1]/text()[1]", startOffset = 0,
                        endXpath = "/div[1]/p[1]/text()[1]", endOffset = 14
                    )
                )
            )

            val result = controller.syncHighlights(body, request)

            assertThat(result.body!!.highlights).hasSize(1)
            val h = result.body!!.highlights[0]
            assertThat(h.text).isEqualTo("important text")
            assertThat(h.note).isEqualTo("my note")
            assertThat(h.color).isEqualTo("blue")
        }

        @Test
        fun `upsert updates color and note on existing`() {
            mockAuth()
            val existing = makeHighlight(clientId = "h1", text = "original", color = "yellow")
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, listOf("h1")) } returns listOf(existing)
            every { highlightRepository.save(any()) } answers { firstArg() }
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(
                        action = "upsert", clientId = "h1", contentKey = "book-1",
                        text = "updated text", note = "updated note", color = "green"
                    )
                )
            )

            val result = controller.syncHighlights(body, request)

            val h = result.body!!.highlights[0]
            assertThat(h.color).isEqualTo("green")
            assertThat(h.note).isEqualTo("updated note")
            assertThat(h.text).isEqualTo("updated text")
        }

        @Test
        fun `text truncated to 5000 on create`() {
            mockAuth()
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()
            every { highlightRepository.save(any()) } answers { firstArg() }
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } answers {
                // Return what was saved - we can't easily capture, so just return empty
                // and verify via the save capture instead
                emptyList()
            }

            val longText = "x".repeat(6000)
            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(
                        action = "upsert", clientId = "h1", contentKey = "book-1", text = longText,
                        color = "yellow",
                        startXpath = "/div[1]/p[1]/text()[1]", startOffset = 0,
                        endXpath = "/div[1]/p[1]/text()[1]", endOffset = 10
                    )
                )
            )

            controller.syncHighlights(body, request)

            val savedSlot = slot<UserHighlight>()
            verify { highlightRepository.save(capture(savedSlot)) }
            assertThat(savedSlot.captured.text).hasSize(5000)
        }

        @Test
        fun `note truncated to 2000 on create`() {
            mockAuth()
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()
            every { highlightRepository.save(any()) } answers { firstArg() }
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } returns emptyList()

            val longNote = "n".repeat(3000)
            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(
                        action = "upsert", clientId = "h1", contentKey = "book-1",
                        text = "some text", note = longNote, color = "yellow",
                        startXpath = "/div[1]/p[1]/text()[1]", startOffset = 0,
                        endXpath = "/div[1]/p[1]/text()[1]", endOffset = 9
                    )
                )
            )

            controller.syncHighlights(body, request)

            val savedSlot = slot<UserHighlight>()
            verify { highlightRepository.save(capture(savedSlot)) }
            assertThat(savedSlot.captured.note).hasSize(2000)
        }

        @Test
        fun `text truncated on update`() {
            mockAuth()
            val existing = makeHighlight(clientId = "h1", text = "short")
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, listOf("h1")) } returns listOf(existing)
            every { highlightRepository.save(any()) } answers { firstArg() }
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val longText = "y".repeat(6000)
            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(
                        action = "upsert", clientId = "h1", contentKey = "book-1", text = longText
                    )
                )
            )

            val result = controller.syncHighlights(body, request)

            assertThat(result.body!!.highlights[0].text).hasSize(5000)
        }

        @Test
        fun `delete soft-deletes highlight`() {
            mockAuth()
            val existing = makeHighlight(clientId = "h1", contentKey = "book-1")
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, listOf("h1")) } returns listOf(existing)
            every { highlightRepository.save(any()) } answers { firstArg() }
            every { highlightRepository.findByUserIdAndContentKey(userId, "book-1") } returns listOf(existing)

            val body = HighlightSyncRequest(
                items = listOf(HighlightSyncItem(action = "delete", clientId = "h1", contentKey = "book-1"))
            )

            val result = controller.syncHighlights(body, request)

            assertThat(result.body!!.highlights[0].deletedAt).isNotNull()
        }

        @Test
        fun `unknown action returns 400`() {
            mockAuth()
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()

            val body = HighlightSyncRequest(
                items = listOf(HighlightSyncItem(action = "purge", clientId = "h1"))
            )

            assertThatThrownBy {
                controller.syncHighlights(body, request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("Unknown action")
        }

        @Test
        fun `more than 500 items returns 400`() {
            mockAuth()
            val items = (1..501).map {
                HighlightSyncItem(action = "upsert", clientId = "h-$it", contentKey = "b", text = "t")
            }

            assertThatThrownBy {
                controller.syncHighlights(HighlightSyncRequest(items), request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("500")
        }

        @Test
        fun `missing required fields returns 400`() {
            mockAuth()
            every { highlightRepository.findAllByUserIdAndClientIdIn(userId, any()) } returns emptyList()

            // Missing text (and other required fields for new highlight)
            val body = HighlightSyncRequest(
                items = listOf(
                    HighlightSyncItem(action = "upsert", clientId = "h1", contentKey = "book-1", text = null)
                )
            )

            assertThatThrownBy {
                controller.syncHighlights(body, request)
            }.isInstanceOf(ResponseStatusException::class.java)
                .hasMessageContaining("required")
        }
    }

    // ── GetChanges ─────────────────────────────────────────────────

    @Nested
    inner class GetChanges {

        private val sinceTime = Instant.parse("2026-01-01T00:00:00Z")
        private val sinceStr = "2026-01-01T00:00:00Z"

        @Test
        fun `returns bookmarks changed since timestamp`() {
            mockAuth()
            val bm = makeBookmark(page = 7)
            every { bookmarkRepository.findChangedSince(userId, sinceTime) } returns listOf(bm)
            every { highlightRepository.findChangedSince(userId, sinceTime) } returns emptyList()

            val result = controller.getChanges(sinceTime, request)

            assertThat(result.body!!.bookmarks).hasSize(1)
            assertThat(result.body!!.highlights).isEmpty()
        }

        @Test
        fun `returns highlights changed since timestamp`() {
            mockAuth()
            val hl = makeHighlight(text = "changed")
            every { bookmarkRepository.findChangedSince(userId, sinceTime) } returns emptyList()
            every { highlightRepository.findChangedSince(userId, sinceTime) } returns listOf(hl)

            val result = controller.getChanges(sinceTime, request)

            assertThat(result.body!!.bookmarks).isEmpty()
            assertThat(result.body!!.highlights).hasSize(1)
        }

        @Test
        fun `includes soft-deleted items`() {
            mockAuth()
            val deleted = makeBookmark(page = 2, deletedAt = Instant.now())
            every { bookmarkRepository.findChangedSince(userId, sinceTime) } returns listOf(deleted)
            every { highlightRepository.findChangedSince(userId, sinceTime) } returns emptyList()

            val result = controller.getChanges(sinceTime, request)

            assertThat(result.body!!.bookmarks).hasSize(1)
            assertThat(result.body!!.bookmarks[0].deletedAt).isNotNull()
        }

        @Test
        fun `returns serverTime approximately now`() {
            mockAuth()
            every { bookmarkRepository.findChangedSince(userId, sinceTime) } returns emptyList()
            every { highlightRepository.findChangedSince(userId, sinceTime) } returns emptyList()

            val before = Instant.now()
            val result = controller.getChanges(sinceTime, request)
            val after = Instant.now()

            assertThat(result.body!!.serverTime).isBetween(before, after)
        }

        @Test
        fun `both bookmarks and highlights in one response`() {
            mockAuth()
            val bm = makeBookmark(page = 1)
            val hl = makeHighlight(text = "hi")
            every { bookmarkRepository.findChangedSince(userId, sinceTime) } returns listOf(bm)
            every { highlightRepository.findChangedSince(userId, sinceTime) } returns listOf(hl)

            val result = controller.getChanges(sinceTime, request)

            assertThat(result.body!!.bookmarks).hasSize(1)
            assertThat(result.body!!.highlights).hasSize(1)
        }
    }

    // ── Edge Cases ─────────────────────────────────────────────────

    @Nested
    inner class EdgeCases {

        @Test
        fun `empty items list syncs successfully`() {
            mockAuth()
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, emptyList()) } returns emptyList()

            val result = controller.syncBookmarks(BookmarkSyncRequest(items = emptyList()), request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.bookmarks).isEmpty()
            verify(exactly = 0) { bookmarkRepository.save(any()) }
        }

        @Test
        fun `delete of non-existent clientId is a no-op`() {
            mockAuth()
            every { bookmarkRepository.findAllByUserIdAndClientIdIn(userId, listOf("ghost")) } returns emptyList()
            every { bookmarkRepository.save(any()) } answers { firstArg() }

            val body = BookmarkSyncRequest(
                items = listOf(BookmarkSyncItem(action = "delete", clientId = "ghost"))
            )

            val result = controller.syncBookmarks(body, request)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.bookmarks).isEmpty()
            verify(exactly = 0) { bookmarkRepository.save(any()) }
        }
    }
}
