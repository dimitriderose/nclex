package com.nclex.auth

import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import jakarta.servlet.http.HttpServletResponse
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.UUID

class JwtUtilTest {

    // 64-byte secret for HS512 (minimum 512 bits)
    private val secret = "a]b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6A7B8C9D0E1F2"
    private val expirationMs = 3600000L // 1 hour
    private val refreshExpirationMs = 604800000L // 7 days

    private lateinit var jwtUtil: JwtUtil

    @BeforeEach
    fun setUp() {
        jwtUtil = JwtUtil(secret, expirationMs, refreshExpirationMs)
    }

    // -- createToken --

    @Test
    fun `createToken produces a valid JWT string`() {
        val userId = UUID.randomUUID()
        val token = jwtUtil.createToken(userId, "user@test.com", "USER", 0)

        assertThat(token).isNotBlank()
        assertThat(token.split(".")).hasSize(3) // header.payload.signature
    }

    // -- validateToken and claim extraction --

    @Test
    fun `validateToken returns claims from valid token`() {
        val userId = UUID.randomUUID()
        val token = jwtUtil.createToken(userId, "user@test.com", "ADMIN", 3)

        val claims = jwtUtil.validateToken(token)

        assertThat(claims).isNotNull
        assertThat(claims!!.subject).isEqualTo(userId.toString())
        assertThat(claims["email"]).isEqualTo("user@test.com")
        assertThat(claims["role"]).isEqualTo("ADMIN")
        assertThat(claims["tokenVersion"]).isEqualTo(3)
    }

    @Test
    fun `extracting userId from token`() {
        val userId = UUID.randomUUID()
        val token = jwtUtil.createToken(userId, "a@b.com", "USER", 0)
        val claims = jwtUtil.validateToken(token)!!

        assertThat(UUID.fromString(claims.subject)).isEqualTo(userId)
    }

    @Test
    fun `extracting email from token`() {
        val token = jwtUtil.createToken(UUID.randomUUID(), "hello@world.com", "USER", 0)
        val claims = jwtUtil.validateToken(token)!!

        assertThat(claims["email"]).isEqualTo("hello@world.com")
    }

    @Test
    fun `extracting role from token`() {
        val token = jwtUtil.createToken(UUID.randomUUID(), "a@b.com", "ADMIN", 0)
        val claims = jwtUtil.validateToken(token)!!

        assertThat(claims["role"]).isEqualTo("ADMIN")
    }

    @Test
    fun `extracting tokenVersion from token`() {
        val token = jwtUtil.createToken(UUID.randomUUID(), "a@b.com", "USER", 42)
        val claims = jwtUtil.validateToken(token)!!

        assertThat(claims["tokenVersion"]).isEqualTo(42)
    }

    // -- expired token --

    @Test
    fun `expired token returns null`() {
        // Create JwtUtil with 0ms expiration so token is immediately expired
        val shortLivedJwt = JwtUtil(secret, 0L, refreshExpirationMs)
        val token = shortLivedJwt.createToken(UUID.randomUUID(), "a@b.com", "USER", 0)

        // Small delay to ensure expiry
        Thread.sleep(10)

        val claims = shortLivedJwt.validateToken(token)
        assertThat(claims).isNull()
    }

    // -- invalid/tampered token --

    @Test
    fun `invalid token returns null`() {
        val claims = jwtUtil.validateToken("not.a.valid.token")
        assertThat(claims).isNull()
    }

    @Test
    fun `tampered token returns null`() {
        val token = jwtUtil.createToken(UUID.randomUUID(), "a@b.com", "USER", 0)
        val tampered = token.dropLast(5) + "XXXXX"

        val claims = jwtUtil.validateToken(tampered)
        assertThat(claims).isNull()
    }

    @Test
    fun `token signed with different key returns null`() {
        val otherSecret = "Z9Y8X7W6V5U4T3S2R1Q0P9O8N7M6L5K4J3I2H1G0F9E8D7C6B5A4z3y2x1w0v9u8"
        val otherJwt = JwtUtil(otherSecret, expirationMs, refreshExpirationMs)
        val token = otherJwt.createToken(UUID.randomUUID(), "a@b.com", "USER", 0)

        val claims = jwtUtil.validateToken(token)
        assertThat(claims).isNull()
    }

    // -- addTokenCookie --

    @Test
    fun `addTokenCookie sets correct cookie header`() {
        val response = mockk<HttpServletResponse>()
        val headerSlot = slot<String>()
        every { response.addHeader("Set-Cookie", capture(headerSlot)) } returns Unit

        jwtUtil.addTokenCookie(response, "my-jwt-token")

        verify { response.addHeader("Set-Cookie", any()) }
        val cookie = headerSlot.captured
        assertThat(cookie).contains("nclex_token=my-jwt-token")
        assertThat(cookie).contains("HttpOnly")
        assertThat(cookie).contains("Secure")
        assertThat(cookie).contains("Path=/")
        assertThat(cookie).contains("SameSite=Strict")
        // maxAge should be expirationMs / 1000 = 3600
        assertThat(cookie).contains("Max-Age=3600")
    }

    // -- clearTokenCookie --

    @Test
    fun `clearTokenCookie sets expired cookie`() {
        val response = mockk<HttpServletResponse>()
        val headerSlot = slot<String>()
        every { response.addHeader("Set-Cookie", capture(headerSlot)) } returns Unit

        jwtUtil.clearTokenCookie(response)

        verify { response.addHeader("Set-Cookie", any()) }
        val cookie = headerSlot.captured
        assertThat(cookie).contains("nclex_token=")
        assertThat(cookie).contains("Max-Age=0")
        assertThat(cookie).contains("HttpOnly")
        assertThat(cookie).contains("Secure")
        assertThat(cookie).contains("Path=/")
        assertThat(cookie).contains("SameSite=Strict")
    }

    // -- COOKIE_NAME constant --

    @Test
    fun `COOKIE_NAME is nclex_token`() {
        assertThat(JwtUtil.COOKIE_NAME).isEqualTo("nclex_token")
    }

    @Test
    fun `REFRESH_COOKIE_NAME is nclex_refresh`() {
        assertThat(JwtUtil.REFRESH_COOKIE_NAME).isEqualTo("nclex_refresh")
    }

    // -- addRefreshCookie --

    @Test
    fun `addRefreshCookie sets correct cookie header`() {
        val response = mockk<HttpServletResponse>()
        val headerSlot = slot<String>()
        every { response.addHeader("Set-Cookie", capture(headerSlot)) } returns Unit

        jwtUtil.addRefreshCookie(response, "my-refresh-token")

        verify { response.addHeader("Set-Cookie", any()) }
        val cookie = headerSlot.captured
        assertThat(cookie).contains("nclex_refresh=my-refresh-token")
        assertThat(cookie).contains("HttpOnly")
        assertThat(cookie).contains("Secure")
        assertThat(cookie).contains("Path=/api/auth")
        // maxAge should be refreshExpirationMs / 1000 = 604800
        assertThat(cookie).contains("Max-Age=604800")
    }

    // -- clearRefreshCookie --

    @Test
    fun `clearRefreshCookie sets expired cookie`() {
        val response = mockk<HttpServletResponse>()
        val headerSlot = slot<String>()
        every { response.addHeader("Set-Cookie", capture(headerSlot)) } returns Unit

        jwtUtil.clearRefreshCookie(response)

        verify { response.addHeader("Set-Cookie", any()) }
        val cookie = headerSlot.captured
        assertThat(cookie).contains("nclex_refresh=")
        assertThat(cookie).contains("Max-Age=0")
        assertThat(cookie).contains("HttpOnly")
        assertThat(cookie).contains("Secure")
        assertThat(cookie).contains("Path=/api/auth")
    }

    // -- getRefreshExpirationMs --

    @Test
    fun `getRefreshExpirationMs returns configured value`() {
        assertThat(jwtUtil.getRefreshExpirationMs()).isEqualTo(604800000L)
    }
}
