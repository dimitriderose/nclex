package com.nclex.repository

import com.nclex.model.Bookmark
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface BookmarkRepository : JpaRepository<Bookmark, UUID> {
    fun findByUserIdAndContentKeyAndDeletedAtIsNull(userId: UUID, contentKey: String): List<Bookmark>
    fun findByUserIdAndDeletedAtIsNull(userId: UUID): List<Bookmark>
    fun findByUserIdAndContentKey(userId: UUID, contentKey: String): List<Bookmark>
    fun findByUserIdAndClientId(userId: UUID, clientId: String): Bookmark?
    fun findAllByUserIdAndClientIdIn(userId: UUID, clientIds: List<String>): List<Bookmark>
    fun findByUserIdAndContentKeyAndPage(userId: UUID, contentKey: String, page: Int): Bookmark?

    @Query("SELECT b FROM Bookmark b WHERE b.userId = :userId AND (b.updatedAt > :since OR b.deletedAt > :since)")
    fun findChangedSince(userId: UUID, since: Instant): List<Bookmark>
}
