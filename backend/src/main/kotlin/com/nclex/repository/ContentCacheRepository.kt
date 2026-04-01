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

    fun findBySource(source: String): List<ContentCache>

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

    @Query("SELECT DISTINCT c.source FROM ContentCache c")
    fun findDistinctSources(): List<String>

    @Query("""
        SELECT new map(
            COUNT(c) as total,
            SUM(CASE WHEN c.expiresAt < :now THEN 1 ELSE 0 END) as expired,
            MAX(c.updatedAt) as lastUpdated,
            MIN(c.createdAt) as oldest,
            MAX(c.createdAt) as newest
        )
        FROM ContentCache c WHERE c.source = :source
    """)
    fun getSourceStats(source: String, now: Instant): Map<String, Any?>
}
