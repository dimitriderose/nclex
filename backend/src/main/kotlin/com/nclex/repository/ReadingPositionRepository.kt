package com.nclex.repository

import com.nclex.model.ReadingPosition
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface ReadingPositionRepository : JpaRepository<ReadingPosition, UUID> {
    fun findByUserIdAndContentKey(userId: UUID, contentKey: String): ReadingPosition?
    fun findByUserId(userId: UUID): List<ReadingPosition>
}
