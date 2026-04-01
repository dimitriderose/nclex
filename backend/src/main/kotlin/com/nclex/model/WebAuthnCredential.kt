package com.nclex.model

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "webauthn_credentials")
data class WebAuthnCredential(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID = UUID.randomUUID(),

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(name = "credential_id", nullable = false, unique = true)
    val credentialId: String,

    @Column(name = "public_key", nullable = false)
    val publicKey: String,

    @Column(name = "sign_count", nullable = false)
    var signCount: Long = 0,

    @Column(name = "device_name")
    val deviceName: String? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "last_used_at")
    var lastUsedAt: Instant? = null
)
