package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "exam_sessions")
data class ExamSession(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var status: ExamStatus = ExamStatus.IN_PROGRESS,

    @Column(name = "total_questions", nullable = false)
    var totalQuestions: Int = 0,

    @Column(name = "correct_count", nullable = false)
    var correctCount: Int = 0,

    @Column(name = "current_difficulty", nullable = false)
    var currentDifficulty: Double = 0.5,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "question_history", nullable = false, columnDefinition = "jsonb")
    var questionHistory: List<Map<String, Any>> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "topic_breakdown", nullable = false, columnDefinition = "jsonb")
    var topicBreakdown: Map<String, Any> = emptyMap(),

    @Column(name = "time_limit_minutes", nullable = false)
    val timeLimitMinutes: Int = 300,

    @Column(name = "elapsed_seconds", nullable = false)
    var elapsedSeconds: Long = 0,

    @Column(name = "pass_prediction")
    var passPrediction: Boolean? = null,

    @Column(name = "confidence_level")
    var confidenceLevel: Double? = null,

    @Column(name = "started_at", nullable = false)
    val startedAt: Instant = Instant.now(),

    @Column(name = "completed_at")
    var completedAt: Instant? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now()
)

enum class ExamStatus {
    IN_PROGRESS, COMPLETED, TIMED_OUT, ABANDONED
}
