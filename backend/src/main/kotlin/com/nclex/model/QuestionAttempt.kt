package com.nclex.model

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "question_attempts")
data class QuestionAttempt(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(name = "question_id", nullable = false)
    val questionId: UUID,

    @Column(nullable = false)
    val correct: Boolean,

    @Column(nullable = false)
    val source: String = "practice",

    @Column(name = "attempted_at", updatable = false)
    val attemptedAt: Instant = Instant.now()
)
