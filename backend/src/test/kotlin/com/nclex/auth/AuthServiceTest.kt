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
import io.mockk.*
import io.mockk.impl.annotations.MockK
import io.mockk.junit5.MockKExtension
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import java.time.Instant
import java.util.UUID

@ExtendWith(MockKExtension::class)
class AuthServiceTest {

    @MockK
    private lateinit var userRepository: UserRepository

    @MockK
    private lateinit var userStatsRepository: UserStatsRepository

    @MockK
    private lateinit var refreshTokenRepository: RefreshTokenRepository

    private lateinit var authService: AuthService

    private val passwordEncoder = BCryptPasswordEncoder(12)
    private val refreshExpirationMs = 604800000L // 7 days

    @BeforeEach
    fun setUp() {
        authService = AuthService(userRepository, userStatsRepository, refreshTokenRepository, refreshExpirationMs)
    }

    // -- register --

    @Test
    fun `register - success saves user with hashed password and creates UserStats`() {
        val email = "Test@Example.COM"
        val password = "validPass123"

        every { userRepository.existsByEmail("test@example.com") } returns false
        every { userRepository.save(any()) } answers { firstArg<User>().copy() }
        every { userStatsRepository.save(any()) } answers { firstArg<UserStats>().copy() }

        val user = authService.register(email, password)

        assertThat(user.email).isEqualTo("test@example.com")
        assertThat(user.passwordHash).isNotEqualTo(password)
        assertThat(passwordEncoder.matches(password, user.passwordHash)).isTrue()

        verify(exactly = 1) { userRepository.save(any()) }
        verify(exactly = 1) { userStatsRepository.save(match { it.userId == user.id }) }
    }

    @Test
    fun `register - normalizes email by trimming and lowercasing`() {
        val email = "  User@EXAMPLE.COM  "
        val password = "validPass123"

        every { userRepository.existsByEmail("user@example.com") } returns false
        every { userRepository.save(any()) } answers { firstArg() }
        every { userStatsRepository.save(any()) } answers { firstArg() }

        val user = authService.register(email, password)

        assertThat(user.email).isEqualTo("user@example.com")
        verify { userRepository.existsByEmail("user@example.com") }
    }

    @Test
    fun `register - password too short throws ValidationException`() {
        assertThatThrownBy {
            authService.register("test@test.com", "short")
        }.isInstanceOf(ValidationException::class.java)
            .hasMessageContaining("between 8 and 72")
    }

    @Test
    fun `register - password exactly 7 chars throws ValidationException`() {
        assertThatThrownBy {
            authService.register("test@test.com", "1234567")
        }.isInstanceOf(ValidationException::class.java)
    }

    @Test
    fun `register - password exactly 8 chars succeeds`() {
        val password = "12345678"
        every { userRepository.existsByEmail(any()) } returns false
        every { userRepository.save(any()) } answers { firstArg() }
        every { userStatsRepository.save(any()) } answers { firstArg() }

        val user = authService.register("test@test.com", password)
        assertThat(user).isNotNull
    }

    @Test
    fun `register - password exactly 72 chars succeeds`() {
        val password = "a".repeat(72)
        every { userRepository.existsByEmail(any()) } returns false
        every { userRepository.save(any()) } answers { firstArg() }
        every { userStatsRepository.save(any()) } answers { firstArg() }

        val user = authService.register("test@test.com", password)
        assertThat(user).isNotNull
    }

    @Test
    fun `register - password 73 chars throws ValidationException`() {
        assertThatThrownBy {
            authService.register("test@test.com", "a".repeat(73))
        }.isInstanceOf(ValidationException::class.java)
            .hasMessageContaining("between 8 and 72")
    }

    @Test
    fun `register - password 100 chars throws ValidationException`() {
        assertThatThrownBy {
            authService.register("test@test.com", "a".repeat(100))
        }.isInstanceOf(ValidationException::class.java)
    }

    @Test
    fun `register - duplicate email throws ConflictException`() {
        every { userRepository.existsByEmail("test@test.com") } returns true

        assertThatThrownBy {
            authService.register("test@test.com", "validPass123")
        }.isInstanceOf(ConflictException::class.java)
            .hasMessageContaining("already exists")
    }

    // -- login --

    @Test
    fun `login - success returns user`() {
        val password = "validPass123"
        val hashedPassword = passwordEncoder.encode(password)
        val user = User(email = "test@test.com", passwordHash = hashedPassword)

        every { userRepository.findByEmail("test@test.com") } returns user

        val result = authService.login("test@test.com", password)

        assertThat(result).isEqualTo(user)
    }

    @Test
    fun `login - normalizes email`() {
        val password = "validPass123"
        val hashedPassword = passwordEncoder.encode(password)
        val user = User(email = "test@test.com", passwordHash = hashedPassword)

        every { userRepository.findByEmail("test@test.com") } returns user

        val result = authService.login("  TEST@TEST.COM  ", password)

        assertThat(result).isEqualTo(user)
        verify { userRepository.findByEmail("test@test.com") }
    }

    @Test
    fun `login - wrong email throws UnauthorizedException`() {
        every { userRepository.findByEmail("wrong@test.com") } returns null

        assertThatThrownBy {
            authService.login("wrong@test.com", "anyPass123")
        }.isInstanceOf(UnauthorizedException::class.java)
            .hasMessageContaining("Invalid email or password")
    }

    @Test
    fun `login - wrong password throws UnauthorizedException`() {
        val user = User(
            email = "test@test.com",
            passwordHash = passwordEncoder.encode("correctPass")
        )
        every { userRepository.findByEmail("test@test.com") } returns user

        assertThatThrownBy {
            authService.login("test@test.com", "wrongPass1")
        }.isInstanceOf(UnauthorizedException::class.java)
            .hasMessageContaining("Invalid email or password")
    }

    // -- refresh tokens --

    @Test
    fun `createRefreshToken - saves and returns token with correct expiry`() {
        every { refreshTokenRepository.save(any()) } answers { firstArg<RefreshToken>().copy() }

        val userId = UUID.randomUUID()
        val result = authService.createRefreshToken(userId)

        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.token).isNotBlank()
        assertThat(result.expiresAt).isAfter(Instant.now())

        verify(exactly = 1) { refreshTokenRepository.save(any()) }
    }

    @Test
    fun `validateAndRotateRefreshToken - valid token rotates successfully`() {
        val userId = UUID.randomUUID()
        val existing = RefreshToken(
            userId = userId,
            token = "old-token",
            expiresAt = Instant.now().plusMillis(600000)
        )

        every { refreshTokenRepository.findByToken("old-token") } returns existing
        every { refreshTokenRepository.delete(existing) } just Runs
        every { refreshTokenRepository.save(any()) } answers { firstArg<RefreshToken>().copy() }

        val result = authService.validateAndRotateRefreshToken("old-token")

        assertThat(result.userId).isEqualTo(userId)
        assertThat(result.token).isNotEqualTo("old-token")
        verify { refreshTokenRepository.delete(existing) }
        verify { refreshTokenRepository.save(any()) }
    }

    @Test
    fun `validateAndRotateRefreshToken - invalid token throws UnauthorizedException`() {
        every { refreshTokenRepository.findByToken("bad-token") } returns null

        assertThatThrownBy {
            authService.validateAndRotateRefreshToken("bad-token")
        }.isInstanceOf(UnauthorizedException::class.java)
            .hasMessageContaining("Invalid refresh token")
    }

    @Test
    fun `validateAndRotateRefreshToken - expired token throws UnauthorizedException`() {
        val expired = RefreshToken(
            userId = UUID.randomUUID(),
            token = "expired-token",
            expiresAt = Instant.now().minusMillis(1000)
        )

        every { refreshTokenRepository.findByToken("expired-token") } returns expired
        every { refreshTokenRepository.delete(expired) } just Runs

        assertThatThrownBy {
            authService.validateAndRotateRefreshToken("expired-token")
        }.isInstanceOf(UnauthorizedException::class.java)
            .hasMessageContaining("Refresh token expired")

        verify { refreshTokenRepository.delete(expired) }
    }

    @Test
    fun `deleteRefreshToken - deletes by token value`() {
        every { refreshTokenRepository.deleteByToken("some-token") } just Runs

        authService.deleteRefreshToken("some-token")

        verify(exactly = 1) { refreshTokenRepository.deleteByToken("some-token") }
    }

    @Test
    fun `deleteAllRefreshTokens - deletes by userId`() {
        val userId = UUID.randomUUID()
        every { refreshTokenRepository.deleteByUserId(userId) } just Runs

        authService.deleteAllRefreshTokens(userId)

        verify(exactly = 1) { refreshTokenRepository.deleteByUserId(userId) }
    }
}
