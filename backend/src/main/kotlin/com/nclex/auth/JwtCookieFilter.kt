package com.nclex.auth

import com.nclex.repository.UserRepository
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

@Component
class JwtCookieFilter(
    private val jwtUtil: JwtUtil,
    private val userRepository: UserRepository
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        try {
            val token = extractToken(request)
            if (token != null) {
                val claims = jwtUtil.validateToken(token)
                if (claims != null) {
                    val userId = UUID.fromString(claims.subject)
                    val tokenVersion = claims["tokenVersion", Integer::class.java]?.toInt() ?: 0

                    // Verify token version matches current user version
                    val user = userRepository.findById(userId).orElse(null)
                    if (user != null && user.tokenVersion == tokenVersion) {
                        val role = claims["role", String::class.java] ?: "USER"
                        val email = claims["email", String::class.java] ?: ""

                        val authorities = listOf(SimpleGrantedAuthority("ROLE_$role"))
                        val auth = UsernamePasswordAuthenticationToken(userId, null, authorities)
                        SecurityContextHolder.getContext().authentication = auth

                        // Set request attributes for controllers
                        request.setAttribute("userId", userId)
                        request.setAttribute("userEmail", email)
                        request.setAttribute("userRole", role)

                        // MDC for structured logging
                        MDC.put("userId", userId.toString())
                    }
                }
            }
        } catch (e: Exception) {
            logger.debug("JWT processing failed: ${e.message}")
        } finally {
            filterChain.doFilter(request, response)
            MDC.remove("userId")
        }
    }

    private fun extractToken(request: HttpServletRequest): String? {
        // Try cookie first
        request.cookies?.find { it.name == JwtUtil.COOKIE_NAME }?.let {
            return it.value
        }
        // Fallback to Authorization header
        val header = request.getHeader("Authorization")
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7)
        }
        return null
    }
}
