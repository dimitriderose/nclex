package com.nclex.auth

import com.nclex.exception.ConflictException
import com.nclex.exception.UnauthorizedException
import com.nclex.exception.ValidationException
import com.nclex.model.User
import com.nclex.model.UserStats
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
import java.util.UUID

@ExtendWith(MockKExtension::class)
class AuthServiceTest {

    @MockK
    private lateinit var userRepository: UserRepository

    @MockK
    private lateinit var userStatsRepository: UserStatsRepository

    private lateinit var authService: AuthService

    private val passwordEncoder = BCryptPasswordEncoder(12)

    @BeforeEach
    fun setUp() {
        authService = AuthService(userRepository, userStatsRepository)
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
}
