package com.nclex.repository

import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.util.UUID

interface FlaggedQuestionRepository : JpaRepository<FlaggedQuestion, UUID> {
    fun findByUserId(userId: UUID): List<FlaggedQuestion>
    fun findByUserIdAndCategory(userId: UUID, category: FlagCategory): List<FlaggedQuestion>
    fun findByUserIdAndTopic(userId: UUID, topic: String): List<FlaggedQuestion>

    @Modifying
    @Query("DELETE FROM FlaggedQuestion fq WHERE fq.userId = :userId")
    fun deleteByUserId(userId: UUID)
}
