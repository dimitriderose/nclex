package com.nclex.model

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "highlights")
data class UserHighlight(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(name = "content_key", nullable = false)
    val contentKey: String,

    @Column(name = "client_id", nullable = false)
    val clientId: String,

    @Column(nullable = false)
    var color: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    var text: String,

    @Column(columnDefinition = "TEXT")
    var note: String? = null,

    @Column(name = "start_xpath", nullable = false, columnDefinition = "TEXT")
    val startXpath: String,

    @Column(name = "start_offset", nullable = false)
    val startOffset: Int,

    @Column(name = "end_xpath", nullable = false, columnDefinition = "TEXT")
    val endXpath: String,

    @Column(name = "end_offset", nullable = false)
    val endOffset: Int,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),

    @Column(name = "deleted_at")
    var deletedAt: Instant? = null
)
