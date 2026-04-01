package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "user_stats")
data class UserStats(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false, unique = true)
    val userId: UUID,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "topic_scores", nullable = false, columnDefinition = "jsonb")
    var topicScores: Map<String, Any> = emptyMap(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "history", nullable = false, columnDefinition = "jsonb")
    var history: List<Map<String, Any>> = emptyList(),

    @Column(nullable = false)
    var streak: Int = 0,

    @Column(name = "readiness_score", nullable = false)
    var readinessScore: Double = 0.0,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ncjmm_scores", nullable = false, columnDefinition = "jsonb")
    var ncjmmScores: Map<String, Any> = emptyMap(),

    @Column(name = "last_active_at")
    var lastActiveAt: Instant? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now()
)
