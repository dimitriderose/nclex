package com.nclex.repository

import com.nclex.model.UserStats
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.time.Instant
import java.util.UUID

interface UserStatsRepository : JpaRepository<UserStats, UUID> {
    fun findByUserId(userId: UUID): UserStats?

    fun countByLastActiveAtAfter(after: Instant): Long

    @Query("SELECT AVG(us.readinessScore) FROM UserStats us WHERE us.readinessScore > 0")
    fun averageReadinessScore(): Double?

    @Query("SELECT us FROM UserStats us WHERE us.lastActiveAt > :since")
    fun findActiveUsersSince(since: Instant): List<UserStats>

    @Modifying
    @Query("DELETE FROM UserStats us WHERE us.userId = :userId")
    fun deleteByUserId(userId: UUID)
}
