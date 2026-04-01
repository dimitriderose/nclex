package com.nclex.repository

import com.nclex.model.ContentCache
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface ContentCacheRepository : JpaRepository<ContentCache, UUID> {
    fun findByContentKey(contentKey: String): ContentCache?

    @Modifying
    @Query("DELETE FROM ContentCache c WHERE c.expiresAt < :now")
    fun deleteExpired(now: Instant): Int
}
