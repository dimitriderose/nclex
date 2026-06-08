package com.nclex.config

import com.nclex.exception.UnauthorizedException
import jakarta.servlet.http.HttpServletRequest
import java.util.UUID

/**
 * Resolves the client IP address from the request, checking X-Forwarded-For
 * header first (for requests behind a reverse proxy), falling back to remoteAddr.
 */
fun resolveClientIp(request: HttpServletRequest): String {
    val forwarded = request.getHeader("X-Forwarded-For")
    if (!forwarded.isNullOrBlank()) {
        // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        // The first IP is the original client
        return forwarded.split(",").first().trim()
    }
    return request.remoteAddr ?: "unknown"
}

/**
 * Resolves the authenticated user's id from the request's "userId" attribute.
 * Accepts either a UUID instance (set directly by some filters) or a String
 * representation (set by others), since the attribute's shape isn't uniform
 * across the auth filter chain.
 */
fun extractUserId(request: HttpServletRequest): UUID {
    return when (val raw = request.getAttribute("userId")) {
        is UUID -> raw
        is String -> runCatching { UUID.fromString(raw) }.getOrNull()
            ?: throw UnauthorizedException()
        else -> throw UnauthorizedException()
    }
}
