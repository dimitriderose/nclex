package com.nclex.repository

import com.nclex.model.ContentCache
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface ContentCacheRepository : JpaRepository<ContentCache, UUID> {
    fun findByContentKey(contentKey: String): ContentCache?

    fun findByContentKeyIn(keys: List<String>): List<ContentCache>

    @Query("""
        SELECT c FROM ContentCache c
        WHERE (LOWER(c.contentKey) LIKE LOWER(CONCAT('%', :query, '%'))
            OR LOWER(c.source) LIKE LOWER(CONCAT('%', :query, '%')))
        AND c.expiresAt > :now
        ORDER BY c.updatedAt DESC
    """)
    fun searchByKeyOrSource(query: String, now: Instant): List<ContentCache>

    @Modifying
    @Query("DELETE FROM ContentCache c WHERE c.expiresAt < :now")
    fun deleteExpired(now: Instant): Int
}
