package com.nclex.repository

import com.nclex.model.UserStats
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface UserStatsRepository : JpaRepository<UserStats, UUID> {
    fun findByUserId(userId: UUID): UserStats?
}
