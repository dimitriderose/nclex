package com.nclex.repository

import com.nclex.model.QuestionAttempt
import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface QuestionAttemptRepository : JpaRepository<QuestionAttempt, UUID> {
    fun findByUserIdAndQuestionId(userId: UUID, questionId: UUID): List<QuestionAttempt>
}
