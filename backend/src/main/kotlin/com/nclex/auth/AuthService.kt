package com.nclex.auth

import com.nclex.exception.ConflictException
import com.nclex.exception.UnauthorizedException
import com.nclex.exception.ValidationException
import com.nclex.model.RefreshToken
import com.nclex.model.User
import com.nclex.model.UserStats
import com.nclex.repository.RefreshTokenRepository
import com.nclex.repository.UserRepository
import com.nclex.repository.UserStatsRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

@Service
class AuthService(
    private val userRepository: UserRepository,
    private val userStatsRepository: UserStatsRepository,
    private val refreshTokenRepository: RefreshTokenRepository,
    @Value("\${nclex.jwt.refresh-expiration-ms}") private val refreshExpirationMs: Long
) {
    private val passwordEncoder = BCryptPasswordEncoder(12)

    @Transactional
    fun register(email: String, password: String): User {
        val normalizedEmail = email.trim().lowercase()

        if (password.length < 8 || password.length > 72) {
            throw ValidationException("Password must be between 8 and 72 characters")
        }

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw ConflictException("An account with this email already exists")
        }

        val user = userRepository.save(
            User(
                email = normalizedEmail,
                passwordHash = passwordEncoder.encode(password)
            )
        )

        // Initialize user stats
        userStatsRepository.save(UserStats(userId = user.id))

        return user
    }

    fun login(email: String, password: String): User {
        val normalizedEmail = email.trim().lowercase()
        val user = userRepository.findByEmail(normalizedEmail)
            ?: throw UnauthorizedException("Invalid email or password")

        if (!passwordEncoder.matches(password, user.passwordHash)) {
            throw UnauthorizedException("Invalid email or password")
        }

        return user
    }

    @Transactional
    fun createRefreshToken(userId: UUID): RefreshToken {
        val token = UUID.randomUUID().toString()
        val refreshToken = RefreshToken(
            userId = userId,
            token = token,
            expiresAt = Instant.now().plusMillis(refreshExpirationMs)
        )
        return refreshTokenRepository.save(refreshToken)
    }

    @Transactional
    fun validateAndRotateRefreshToken(token: String): RefreshToken {
        val existing = refreshTokenRepository.findByToken(token)
            ?: throw UnauthorizedException("Invalid refresh token")

        if (existing.expiresAt.isBefore(Instant.now())) {
            refreshTokenRepository.delete(existing)
            throw UnauthorizedException("Refresh token expired")
        }

        // Rotate: delete old, create new
        refreshTokenRepository.delete(existing)
        return createRefreshToken(existing.userId)
    }

    @Transactional
    fun deleteRefreshToken(token: String) {
        refreshTokenRepository.deleteByToken(token)
    }

    @Transactional
    fun deleteAllRefreshTokens(userId: UUID) {
        refreshTokenRepository.deleteByUserId(userId)
    }
}
