package com.nclex.repository

import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.util.UUID

interface FlaggedQuestionRepository : JpaRepository<FlaggedQuestion, UUID> {
    fun findByUserId(userId: UUID): List<FlaggedQuestion>
    fun findByUserId(userId: UUID, pageable: Pageable): Page<FlaggedQuestion>
    fun findByUserIdAndCategory(userId: UUID, category: FlagCategory): List<FlaggedQuestion>
    fun findByUserIdAndCategory(userId: UUID, category: FlagCategory, pageable: Pageable): Page<FlaggedQuestion>
    fun findByUserIdAndTopic(userId: UUID, topic: String): List<FlaggedQuestion>
    fun findByUserIdAndTopic(userId: UUID, topic: String, pageable: Pageable): Page<FlaggedQuestion>

    /**
     * Existence check used by the auto-flag-on-wrong-answer path (Phase 4): avoids creating
     * a duplicate WRONG flag for a question the user has already gotten wrong before — one
     * flag per (user, question, category) is enough to surface it in the review queue;
     * repeated auto-creation would just spam the queue with redundant rows for a question
     * the user keeps missing (which SM-2 already tracks via repetitionCount/easinessFactor).
     */
    fun existsByUserIdAndQuestionIdAndCategory(userId: UUID, questionId: UUID, category: FlagCategory): Boolean

    @Modifying
    @Query("DELETE FROM FlaggedQuestion fq WHERE fq.id = :id AND fq.userId = :userId")
    fun deleteByIdAndUserId(id: UUID, userId: UUID): Long

    @Modifying
    @Query("DELETE FROM FlaggedQuestion fq WHERE fq.userId = :userId")
    fun deleteByUserId(userId: UUID)
}
