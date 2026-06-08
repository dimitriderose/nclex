package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "generated_questions")
data class GeneratedQuestion(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(nullable = false)
    val topic: String,

    @Column(name = "question_type", nullable = false)
    val questionType: String,

    @Column(nullable = false)
    val difficulty: String,

    @Column(name = "ncjmm_step")
    val ncjmmStep: String? = null,

    @Column(nullable = false, columnDefinition = "TEXT")
    val stem: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    val options: List<Map<String, Any>> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "correct_answer", nullable = false, columnDefinition = "jsonb")
    val correctAnswer: Map<String, Any> = emptyMap(),

    @Column(nullable = false, columnDefinition = "TEXT")
    val rationale: String,

    @Column
    val source: String? = null,

    @Column(name = "content_hash", nullable = false, unique = true)
    val contentHash: String,

    @Column(name = "usage_count", nullable = false)
    var usageCount: Int = 0,

    @Column(name = "created_at", updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "last_used_at")
    var lastUsedAt: Instant? = null
)
