package com.nclex.auth

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.RateLimitException
import com.nclex.model.AuditLog
import com.nclex.model.User
import com.nclex.model.UserRole
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.UUID

class AuthControllerTest {

    private val authService: AuthService = mockk()
    private val jwtUtil: JwtUtil = mockk()
    private val rateLimitService: RateLimitService = mockk()
    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()
    private val httpResponse: HttpServletResponse = mockk()

    private lateinit var controller: AuthController

    @BeforeEach
    fun setUp() {
        controller = AuthController(authService, jwtUtil, rateLimitService, auditLogger)
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
    }

    // ── register ───────────────────────────────────────────────────

    @Nested
    inner class Register {

        @Test
        fun `successful registration returns 200 with email`() {
            val user = User(email = "test@test.com", passwordHash = "hash", role = UserRole.USER)
            every { httpRequest.remoteAddr } returns "127.0.0.1"
            every { rateLimitService.tryConsumeRegister("127.0.0.1") } returns true
            every { authService.register("test@test.com", "password123") } returns user
            every { jwtUtil.createToken(user.id, user.email, "USER", 0) } returns "token123"
            every { jwtUtil.addTokenCookie(httpResponse, "token123") } just Runs

            val result = controller.register(
                RegisterRequest("test@test.com", "password123"),
                httpRequest, httpResponse
            )

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Registration successful")
            assertThat(result.body!!.email).isEqualTo("test@test.com")
            verify { jwtUtil.addTokenCookie(httpResponse, "token123") }
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
        fun `successful login returns 200 with email`() {
            val user = User(email = "test@test.com", passwordHash = "hash", role = UserRole.ADMIN, tokenVersion = 3)
            every { httpRequest.remoteAddr } returns "10.0.0.1"
            every { rateLimitService.tryConsumeLogin("10.0.0.1") } returns true
            every { authService.login("test@test.com", "password123") } returns user
            every { jwtUtil.createToken(user.id, user.email, "ADMIN", 3) } returns "admin-token"
            every { jwtUtil.addTokenCookie(httpResponse, "admin-token") } just Runs

            val result = controller.login(
                LoginRequest("test@test.com", "password123"),
                httpRequest, httpResponse
            )

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Login successful")
            assertThat(result.body!!.email).isEqualTo("test@test.com")
            verify { jwtUtil.addTokenCookie(httpResponse, "admin-token") }
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
        fun `clears cookie and returns success`() {
            every { jwtUtil.clearTokenCookie(httpResponse) } just Runs

            val result = controller.logout(httpResponse)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!.message).isEqualTo("Logged out successfully")
            verify { jwtUtil.clearTokenCookie(httpResponse) }
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
