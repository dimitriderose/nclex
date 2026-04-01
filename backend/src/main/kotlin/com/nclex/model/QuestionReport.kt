package com.nclex.model

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "question_reports")
data class QuestionReport(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(name = "question_topic", nullable = false)
    val questionTopic: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "question_data", nullable = false, columnDefinition = "jsonb")
    val questionData: Map<String, Any> = emptyMap(),

    @Column(name = "report_reason", nullable = false)
    val reportReason: String,

    @Column(name = "user_notes")
    val userNotes: String? = null,

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    var status: ReportStatus = ReportStatus.PENDING,

    @Column(name = "review_notes")
    var reviewNotes: String? = null,

    @Column(name = "reviewed_at")
    var reviewedAt: Instant? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now()
)

enum class ReportStatus {
    PENDING, REVIEWED, DISMISSED, FIXED
}
