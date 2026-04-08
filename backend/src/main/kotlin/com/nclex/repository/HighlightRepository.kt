package com.nclex.repository

import com.nclex.model.UserHighlight
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface HighlightRepository : JpaRepository<UserHighlight, UUID> {
    fun findByUserIdAndContentKeyAndDeletedAtIsNull(userId: UUID, contentKey: String): List<UserHighlight>
    fun findByUserIdAndDeletedAtIsNull(userId: UUID): List<UserHighlight>
    fun findByUserIdAndContentKey(userId: UUID, contentKey: String): List<UserHighlight>
    fun findByUserIdAndClientId(userId: UUID, clientId: String): UserHighlight?
    fun findAllByUserIdAndClientIdIn(userId: UUID, clientIds: List<String>): List<UserHighlight>

    @Query("SELECT h FROM UserHighlight h WHERE h.userId = :userId AND (h.updatedAt > :since OR h.deletedAt > :since)")
    fun findChangedSince(userId: UUID, since: Instant): List<UserHighlight>
}
