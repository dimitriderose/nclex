package com.nclex.auth

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.RateLimitException
import com.nclex.exception.UnauthorizedException
import com.nclex.model.AuditLog
import com.nclex.model.RefreshToken
import com.nclex.model.User
import com.nclex.model.UserRole
import com.nclex.repository.UserRepository
import io.mockk.*
import jakarta.servlet.http.Cookie
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.Optional
import java.util.UUID

class AuthControllerTest {

    private val authService: AuthService = mockk()
    private val jwtUtil: JwtUtil = mockk()
    private val rateLimitService: RateLimitService = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val userRepository: UserRepository = mockk()
    private val httpRequest: HttpServletRequest = mockk()
    private val httpResponse: HttpServletResponse = mockk()

    private lateinit var controller: AuthController

    @BeforeEach
    fun setUp() {
        controller = AuthController(authService, jwtUtil, rateLimitService, auditLogger, userRepository)
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
        every { httpRequest.getHeader("X-Forwarded-For") } returns null
    }

    // ── register ───────────────────────────────────────────────────

    @Nested
    inner class Register {

        @Test
        fun `successful registration returns 200 with email and sets refresh cookie`() {
            val user = User(email = "test@test.com", passwordHash = "hash", role = UserRole.USER)
            val refreshToken = RefreshToken(userId = user.id, token = "refresh-123", expiresAt = Instant.now().plusMillis(604800000))
            every { httpRequest.remoteAddr } returns "127.0.0.1"
            every { rateLimitService.tryConsumeRegister("127.0.0.1") } returns true
            every { authService.register("test@test.com", "password123") } returns user
            every { jwtUtil.createToken(user.id, user.email, "USER", 0) } returns "token123"
            every { jwtUtil.addTokenCookie(httpResponse, "token123") } just Runs
            every { authService.createRefreshToken(user.id) } returns refreshToken
            every { jwtUtil.addRefreshCookie(httpResponse, "refresh-123") } just Runs

            val result = controller.register(
                RegisterRequest("test@test.com", "password123"),
                httpRequest, httpResponse
            )

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Registration successful")
            assertThat(result.body!!.email).isEqualTo("test@test.com")
            verify { jwtUtil.addTokenCookie(httpResponse, "token123") }
            verify { jwtUtil.addRefreshCookie(httpResponse, "refresh-123") }
            verify { auditLogger.log("USER_REGISTERED", user.id, any(), eq("127.0.0.1"), any()) }
        }

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            every { httpRequest.remoteAddr } returns "192.168.1.1"
            every { rateLimitService.tryConsumeRegister("192.168.1.1") } returns false

            assertThatThrownBy {
                controller.register(
                    RegisterRequest("test@test.com", "password123"),
                    httpRequest, httpResponse
                )
            }.isInstanceOf(RateLimitException::class.java)
                .hasMessageContaining("Registration rate limit")
        }
    }

    // ── login ──────────────────────────────────────────────────────

    @Nested
    inner class Login {

        @Test
        fun `successful login returns 200 with email and sets refresh cookie`() {
            val user = User(email = "test@test.com", passwordHash = "hash", role = UserRole.ADMIN, tokenVersion = 3)
            val refreshToken = RefreshToken(userId = user.id, token = "refresh-admin", expiresAt = Instant.now().plusMillis(604800000))
            every { httpRequest.remoteAddr } returns "10.0.0.1"
            every { rateLimitService.tryConsumeLogin("10.0.0.1") } returns true
            every { authService.login("test@test.com", "password123") } returns user
            every { jwtUtil.createToken(user.id, user.email, "ADMIN", 3) } returns "admin-token"
            every { jwtUtil.addTokenCookie(httpResponse, "admin-token") } just Runs
            every { authService.createRefreshToken(user.id) } returns refreshToken
            every { jwtUtil.addRefreshCookie(httpResponse, "refresh-admin") } just Runs

            val result = controller.login(
                LoginRequest("test@test.com", "password123"),
                httpRequest, httpResponse
            )

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Login successful")
            assertThat(result.body!!.email).isEqualTo("test@test.com")
            verify { jwtUtil.addTokenCookie(httpResponse, "admin-token") }
            verify { jwtUtil.addRefreshCookie(httpResponse, "refresh-admin") }
            verify { auditLogger.log("USER_LOGIN", user.id, any(), eq("10.0.0.1"), any()) }
        }

        @Test
        fun `rate limit exceeded throws RateLimitException`() {
            every { httpRequest.remoteAddr } returns "192.168.1.1"
            every { rateLimitService.tryConsumeLogin("192.168.1.1") } returns false

            assertThatThrownBy {
                controller.login(
                    LoginRequest("test@test.com", "password123"),
                    httpRequest, httpResponse
                )
            }.isInstanceOf(RateLimitException::class.java)
                .hasMessageContaining("Login rate limit")
        }
    }

    // ── logout ─────────────────────────────────────────────────────

    @Nested
    inner class Logout {

        @Test
        fun `clears both cookies and deletes refresh token from DB`() {
            val refreshCookie = Cookie("nclex_refresh", "refresh-token-value")
            every { httpRequest.cookies } returns arrayOf(refreshCookie)
            every { authService.deleteRefreshToken("refresh-token-value") } just Runs
            every { jwtUtil.clearTokenCookie(httpResponse) } just Runs
            every { jwtUtil.clearRefreshCookie(httpResponse) } just Runs

            val result = controller.logout(httpRequest, httpResponse)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Logged out successfully")
            verify { authService.deleteRefreshToken("refresh-token-value") }
            verify { jwtUtil.clearTokenCookie(httpResponse) }
            verify { jwtUtil.clearRefreshCookie(httpResponse) }
        }

        @Test
        fun `logout without refresh cookie still clears cookies`() {
            every { httpRequest.cookies } returns null
            every { jwtUtil.clearTokenCookie(httpResponse) } just Runs
            every { jwtUtil.clearRefreshCookie(httpResponse) } just Runs

            val result = controller.logout(httpRequest, httpResponse)

            assertThat(result.statusCode.value()).isEqualTo(200)
            verify(exactly = 0) { authService.deleteRefreshToken(any()) }
            verify { jwtUtil.clearTokenCookie(httpResponse) }
            verify { jwtUtil.clearRefreshCookie(httpResponse) }
        }
    }

    // ── refresh ───────────────────────────────────────────────────

    @Nested
    inner class Refresh {

        @Test
        fun `valid refresh token issues new access token and rotates refresh`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", role = UserRole.USER, tokenVersion = 2)
            val newRefresh = RefreshToken(userId = userId, token = "new-refresh", expiresAt = Instant.now().plusMillis(604800000))
            val refreshCookie = Cookie("nclex_refresh", "old-refresh")

            every { httpRequest.cookies } returns arrayOf(refreshCookie)
            every { authService.validateAndRotateRefreshToken("old-refresh") } returns newRefresh
            every { userRepository.findById(userId) } returns Optional.of(user)
            every { jwtUtil.createToken(userId, "test@test.com", "USER", 2) } returns "new-access-token"
            every { jwtUtil.addTokenCookie(httpResponse, "new-access-token") } just Runs
            every { jwtUtil.addRefreshCookie(httpResponse, "new-refresh") } just Runs

            val result = controller.refresh(httpRequest, httpResponse)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Token refreshed")
            assertThat(result.body!!.email).isEqualTo("test@test.com")
            verify { jwtUtil.addTokenCookie(httpResponse, "new-access-token") }
            verify { jwtUtil.addRefreshCookie(httpResponse, "new-refresh") }
        }

        @Test
        fun `missing refresh cookie throws UnauthorizedException`() {
            every { httpRequest.cookies } returns null

            assertThatThrownBy {
                controller.refresh(httpRequest, httpResponse)
            }.isInstanceOf(UnauthorizedException::class.java)
                .hasMessageContaining("No refresh token provided")
        }

        @Test
        fun `invalid refresh token throws UnauthorizedException`() {
            val refreshCookie = Cookie("nclex_refresh", "bad-token")
            every { httpRequest.cookies } returns arrayOf(refreshCookie)
            every { authService.validateAndRotateRefreshToken("bad-token") } throws UnauthorizedException("Invalid refresh token")

            assertThatThrownBy {
                controller.refresh(httpRequest, httpResponse)
            }.isInstanceOf(UnauthorizedException::class.java)
                .hasMessageContaining("Invalid refresh token")
        }

        @Test
        fun `expired refresh token throws UnauthorizedException`() {
            val refreshCookie = Cookie("nclex_refresh", "expired-token")
            every { httpRequest.cookies } returns arrayOf(refreshCookie)
            every { authService.validateAndRotateRefreshToken("expired-token") } throws UnauthorizedException("Refresh token expired")

            assertThatThrownBy {
                controller.refresh(httpRequest, httpResponse)
            }.isInstanceOf(UnauthorizedException::class.java)
                .hasMessageContaining("Refresh token expired")
        }
    }

    // ── me ──────────────────────────────────────────────────────────

    @Nested
    inner class Me {

        @Test
        fun `authenticated returns user info`() {
            val userId = UUID.randomUUID()
            every { httpRequest.getAttribute("userId") } returns userId
            every { httpRequest.getAttribute("userEmail") } returns "test@test.com"
            every { httpRequest.getAttribute("userRole") } returns "USER"

            val result = controller.me(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            val body = result.body!!
            assertThat(body["authenticated"]).isEqualTo(true)
            assertThat(body["userId"]).isEqualTo(userId.toString())
            assertThat(body["email"]).isEqualTo("test@test.com")
            assertThat(body["role"]).isEqualTo("USER")
        }

        @Test
        fun `not authenticated returns authenticated false`() {
            every { httpRequest.getAttribute("userId") } returns null

            val result = controller.me(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["authenticated"]).isEqualTo(false)
        }

        @Test
        fun `wrong type userId returns authenticated false`() {
            every { httpRequest.getAttribute("userId") } returns "not-a-uuid"

            val result = controller.me(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["authenticated"]).isEqualTo(false)
        }
    }

    // ── me - null email/role attributes ──────────────────────────

    @Nested
    inner class MeNullAttributes {

        @Test
        fun `authenticated user with null email and role returns null for those`() {
            val userId = UUID.randomUUID()
            every { httpRequest.getAttribute("userId") } returns userId
            every { httpRequest.getAttribute("userEmail") } returns null
            every { httpRequest.getAttribute("userRole") } returns null

            val result = controller.me(httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            val body = result.body!!
            assertThat(body["authenticated"]).isEqualTo(true)
            assertThat(body["userId"]).isEqualTo(userId.toString())
            assertThat(body["email"]).isNull()
            assertThat(body["role"]).isNull()
        }
    }

    // ── DTO data classes ──────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `AuthResponse defaults`() {
            val resp = AuthResponse("msg")
            assertThat(resp.email).isNull()
        }

        @Test
        fun `AuthResponse with email`() {
            val resp = AuthResponse("msg", "e@e.com")
            assertThat(resp.email).isEqualTo("e@e.com")
        }
    }
}
