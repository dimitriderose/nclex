package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "flagged_questions")
data class FlaggedQuestion(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(nullable = false)
    val topic: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    var question: Map<String, Any> = emptyMap(),

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var category: FlagCategory,

    @Column
    var notes: String? = null,

    // Links this flag back to its generated_questions bank row (V8 migration). Nullable —
    // legacy flags created before the bank existed store full content inline in `question`.
    @Column(name = "question_id")
    var questionId: UUID? = null,

    // Durable SM-2 spaced-repetition state (V8 migration) — backend is now the source of
    // truth for review scheduling; persisted via PATCH /api/flags/{id}/review.
    @Column(name = "next_review_date")
    var nextReviewDate: Instant? = null,

    @Column(name = "easiness_factor", nullable = false)
    var easinessFactor: Double = 2.5,

    @Column(name = "repetition_count", nullable = false)
    var repetitionCount: Int = 0,

    @Column(name = "interval_days", nullable = false)
    var intervalDays: Int = 0,

    @Column(name = "last_reviewed_at")
    var lastReviewedAt: Instant? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now()
)

enum class FlagCategory {
    REVIEW, WRONG, BOOKMARK, HARD
}
