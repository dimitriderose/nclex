package com.nclex.auth

import io.jsonwebtoken.Claims
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ResponseCookie
import org.springframework.stereotype.Component
import java.util.*
import javax.crypto.SecretKey

@Component
class JwtUtil(
    @Value("\${nclex.jwt.secret}") private val secret: String,
    @Value("\${nclex.jwt.expiration-ms}") private val expirationMs: Long
) {

    companion object {
        const val COOKIE_NAME = "nclex_token"
    }

    private val key: SecretKey by lazy {
        Keys.hmacShaKeyFor(secret.toByteArray())
    }

    fun createToken(userId: UUID, email: String, role: String, tokenVersion: Int): String {
        val now = Date()
        return Jwts.builder()
            .subject(userId.toString())
            .claim("email", email)
            .claim("role", role)
            .claim("tokenVersion", tokenVersion)
            .issuedAt(now)
            .expiration(Date(now.time + expirationMs))
            .signWith(key)
            .compact()
    }

    fun validateToken(token: String): Claims? {
        return try {
            Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .payload
        } catch (e: Exception) {
            null
        }
    }

    fun addTokenCookie(response: HttpServletResponse, token: String) {
        val cookie = ResponseCookie.from(COOKIE_NAME, token)
            .httpOnly(true)
            .secure(true)
            .path("/")
            .maxAge(expirationMs / 1000)
            .sameSite("Lax")
            .build()
        response.addHeader("Set-Cookie", cookie.toString())
    }

    fun clearTokenCookie(response: HttpServletResponse) {
        val cookie = ResponseCookie.from(COOKIE_NAME, "")
            .httpOnly(true)
            .secure(true)
            .path("/")
            .maxAge(0)
            .sameSite("Lax")
            .build()
        response.addHeader("Set-Cookie", cookie.toString())
    }
}
