package com.nclex.auth

import com.nclex.model.User
import com.nclex.repository.UserRepository
import io.jsonwebtoken.Claims
import io.mockk.*
import jakarta.servlet.FilterChain
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import java.util.Optional
import java.util.UUID

class JwtCookieFilterTest {

    private val jwtUtil: JwtUtil = mockk()
    private val userRepository: UserRepository = mockk()
    private val filter = JwtCookieFilter(jwtUtil, userRepository)

    private lateinit var request: MockHttpServletRequest
    private lateinit var response: MockHttpServletResponse
    private val filterChain: FilterChain = mockk(relaxed = true)

    @BeforeEach
    fun setUp() {
        SecurityContextHolder.clearContext()
        request = MockHttpServletRequest()
        response = MockHttpServletResponse()
    }

    @AfterEach
    fun tearDown() {
        SecurityContextHolder.clearContext()
    }

    // ── No token ───────────────────────────────────────────────────

    @Nested
    inner class NoToken {

        @Test
        fun `no cookie and no header passes filter without auth`() {
            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }

        @Test
        fun `empty cookies array passes filter without auth`() {
            request.setCookies() // empty

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }
    }

    // ── Cookie token ───────────────────────────────────────────────

    @Nested
    inner class CookieToken {

        @Test
        fun `valid cookie token sets authentication and request attributes`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", tokenVersion = 5)
            val claims: Claims = mockk(relaxed = true)

            request.setCookies(Cookie("nclex_token", "valid-token"))
            every { jwtUtil.validateToken("valid-token") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns 5 as Integer
            every { claims["role", String::class.java] } returns "ADMIN"
            every { claims["email", String::class.java] } returns "test@test.com"
            every { userRepository.findById(userId) } returns Optional.of(user)

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(request.getAttribute("userId")).isEqualTo(userId)
            assertThat(request.getAttribute("userEmail")).isEqualTo("test@test.com")
            assertThat(request.getAttribute("userRole")).isEqualTo("ADMIN")
            assertThat(SecurityContextHolder.getContext().authentication).isNotNull
            assertThat(SecurityContextHolder.getContext().authentication.principal).isEqualTo(userId)
        }

        @Test
        fun `invalid token passes filter without auth`() {
            request.setCookies(Cookie("nclex_token", "invalid-token"))
            every { jwtUtil.validateToken("invalid-token") } returns null

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }

        @Test
        fun `token version mismatch skips auth`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", tokenVersion = 10)
            val claims: Claims = mockk(relaxed = true)

            request.setCookies(Cookie("nclex_token", "old-token"))
            every { jwtUtil.validateToken("old-token") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns 5 as Integer
            every { userRepository.findById(userId) } returns Optional.of(user)

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }

        @Test
        fun `user not found in DB skips auth`() {
            val userId = UUID.randomUUID()
            val claims: Claims = mockk(relaxed = true)

            request.setCookies(Cookie("nclex_token", "orphan-token"))
            every { jwtUtil.validateToken("orphan-token") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns 0 as Integer
            every { userRepository.findById(userId) } returns Optional.empty()

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }

        @Test
        fun `null tokenVersion defaults to 0`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", tokenVersion = 0)
            val claims: Claims = mockk(relaxed = true)

            request.setCookies(Cookie("nclex_token", "token"))
            every { jwtUtil.validateToken("token") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns null
            every { claims["role", String::class.java] } returns null
            every { claims["email", String::class.java] } returns null
            every { userRepository.findById(userId) } returns Optional.of(user)

            filter.doFilter(request, response, filterChain)

            assertThat(request.getAttribute("userRole")).isEqualTo("USER")
            assertThat(request.getAttribute("userEmail")).isEqualTo("")
        }
    }

    // ── Bearer token ───────────────────────────────────────────────

    @Nested
    inner class BearerToken {

        @Test
        fun `valid Bearer header sets auth when no cookie`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", tokenVersion = 0)
            val claims: Claims = mockk(relaxed = true)

            request.addHeader("Authorization", "Bearer bearer-token-value")
            every { jwtUtil.validateToken("bearer-token-value") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns 0 as Integer
            every { claims["role", String::class.java] } returns "USER"
            every { claims["email", String::class.java] } returns "test@test.com"
            every { userRepository.findById(userId) } returns Optional.of(user)

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNotNull
        }

        @Test
        fun `non-Bearer Authorization header ignored`() {
            request.addHeader("Authorization", "Basic dXNlcjpwYXNz")

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }
    }

    // ── Cookie extraction edge cases ──────────────────────────────

    @Nested
    inner class CookieExtractionEdgeCases {

        @Test
        fun `cookies array with no nclex_token falls through to header`() {
            val userId = UUID.randomUUID()
            val user = User(id = userId, email = "test@test.com", passwordHash = "hash", tokenVersion = 0)
            val claims: Claims = mockk(relaxed = true)

            // Cookies present but none named nclex_token
            request.setCookies(Cookie("other_cookie", "value"))
            request.addHeader("Authorization", "Bearer header-token")

            every { jwtUtil.validateToken("header-token") } returns claims
            every { claims.subject } returns userId.toString()
            every { claims["tokenVersion", Integer::class.java] } returns 0 as Integer
            every { claims["role", String::class.java] } returns "USER"
            every { claims["email", String::class.java] } returns "test@test.com"
            every { userRepository.findById(userId) } returns Optional.of(user)

            filter.doFilter(request, response, filterChain)

            // Should authenticate via the Bearer header fallback
            assertThat(SecurityContextHolder.getContext().authentication).isNotNull
            assertThat(request.getAttribute("userId")).isEqualTo(userId)
        }

        @Test
        fun `Authorization header without Bearer prefix is ignored`() {
            request.addHeader("Authorization", "Token some-token")

            filter.doFilter(request, response, filterChain)

            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }

        @Test
        fun `null Authorization header with no cookies returns null token`() {
            // No cookies, no header
            filter.doFilter(request, response, filterChain)

            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }
    }

    // ── Exception handling ─────────────────────────────────────────

    @Nested
    inner class ExceptionHandling {

        @Test
        fun `exception during token processing continues filter chain`() {
            request.setCookies(Cookie("nclex_token", "bad"))
            every { jwtUtil.validateToken("bad") } throws RuntimeException("JWT error")

            filter.doFilter(request, response, filterChain)

            verify { filterChain.doFilter(request, response) }
            assertThat(SecurityContextHolder.getContext().authentication).isNull()
        }
    }
}
