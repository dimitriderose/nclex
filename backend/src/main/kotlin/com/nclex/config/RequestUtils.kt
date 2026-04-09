package com.nclex.config

import jakarta.servlet.http.HttpServletRequest

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
