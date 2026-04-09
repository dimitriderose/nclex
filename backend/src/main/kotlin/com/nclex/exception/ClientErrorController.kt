package com.nclex.exception

import com.nclex.audit.AuditLogger
import com.nclex.config.resolveClientIp
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.util.UUID

data class ClientErrorReport(
    val message: String,
    val componentStack: String? = null,
    val url: String
)

@RestController
@RequestMapping("/api/errors")
class ClientErrorController(private val auditLogger: AuditLogger) {
    @PostMapping("/report")
    fun reportClientError(
        @RequestBody report: ClientErrorReport,
        request: HttpServletRequest
    ): ResponseEntity<Map<String, String>> {
        auditLogger.log(
            eventType = "CLIENT_ERROR",
            userId = request.getAttribute("userId") as? UUID,
            ipAddress = resolveClientIp(request),
            metadata = mapOf(
                "errorMessage" to report.message,
                "componentStack" to (report.componentStack ?: ""),
                "url" to report.url,
                "userAgent" to (request.getHeader("User-Agent") ?: "unknown")
            )
        )
        return ResponseEntity.ok(mapOf("status" to "reported"))
    }
}
