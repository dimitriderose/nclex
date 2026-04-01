package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

@Entity
@Table(
    name = "readiness_snapshots",
    uniqueConstraints = [UniqueConstraint(columnNames = ["user_id", "snapshot_date"])]
)
data class ReadinessSnapshot(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(name = "snapshot_date", nullable = false)
    val snapshotDate: LocalDate,

    @Column(name = "readiness_score", nullable = false)
    val readinessScore: Double,

    @Column(name = "readiness_band", nullable = false)
    val readinessBand: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "topic_breakdown", nullable = false, columnDefinition = "jsonb")
    val topicBreakdown: Map<String, Any> = emptyMap(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ncjmm_breakdown", nullable = false, columnDefinition = "jsonb")
    val ncjmmBreakdown: Map<String, Any> = emptyMap(),

    @Column(name = "questions_answered", nullable = false)
    val questionsAnswered: Int = 0,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now()
)
