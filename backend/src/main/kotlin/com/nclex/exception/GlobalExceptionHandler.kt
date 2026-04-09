package com.nclex.exception

import com.nclex.audit.AuditLogger
import com.nclex.config.resolveClientIp
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import java.util.UUID

data class ErrorResponse(
    val error: String,
    val message: String,
    val requestId: String
)

@RestControllerAdvice
class GlobalExceptionHandler(
    private val auditLogger: AuditLogger,
    private val request: HttpServletRequest
) {

    private val logger = LoggerFactory.getLogger(javaClass)

    @ExceptionHandler(NclexException::class)
    fun handleNclexException(ex: NclexException): ResponseEntity<ErrorResponse> {
        val requestId = MDC.get("requestId") ?: UUID.randomUUID().toString()
        logger.warn("[{}] {} - {}", requestId, ex::class.simpleName, ex.message)

        val eventType = when (ex) {
            is ValidationException -> "VALIDATION_ERROR"
            is UnauthorizedException -> "AUTH_FAILURE"
            is ForbiddenException -> "AUTH_FAILURE"
            is RateLimitException -> "RATE_LIMIT_HIT"
            is NotFoundException -> "NOT_FOUND_ERROR"
            is ConflictException -> "CONFLICT_ERROR"
            is ExternalServiceException -> "EXTERNAL_SERVICE_ERROR"
        }

        auditLogger.log(
            eventType = eventType,
            userId = request.getAttribute("userId") as? UUID,
            ipAddress = resolveClientIp(request),
            metadata = mapOf(
                "errorType" to (ex::class.simpleName ?: "Unknown"),
                "message" to ex.message,
                "requestPath" to request.requestURI,
                "requestMethod" to request.method,
                "httpStatus" to ex.status.value(),
                "requestId" to requestId
            )
        )

        return ResponseEntity.status(ex.status).body(
            ErrorResponse(
                error = ex::class.simpleName ?: "Error",
                message = ex.message,
                requestId = requestId
            )
        )
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<ErrorResponse> {
        val requestId = MDC.get("requestId") ?: UUID.randomUUID().toString()
        val message = ex.bindingResult.fieldErrors
            .joinToString("; ") { "${it.field}: ${it.defaultMessage}" }
        return ResponseEntity.badRequest().body(
            ErrorResponse(
                error = "ValidationException",
                message = message,
                requestId = requestId
            )
        )
    }

    @ExceptionHandler(Exception::class)
    fun handleGeneral(ex: Exception): ResponseEntity<ErrorResponse> {
        val requestId = MDC.get("requestId") ?: UUID.randomUUID().toString()
        logger.error("[{}] Unhandled exception", requestId, ex)

        val stackTraceHash = ex.stackTrace.firstOrNull()?.let {
            "${it.className}:${it.methodName}:${it.lineNumber}".hashCode().toString(16)
        } ?: "unknown"

        auditLogger.log(
            eventType = "ERROR",
            userId = request.getAttribute("userId") as? UUID,
            ipAddress = resolveClientIp(request),
            metadata = mapOf(
                "errorType" to (ex::class.simpleName ?: "Unknown"),
                "message" to (ex.message ?: "No message"),
                "requestPath" to request.requestURI,
                "requestMethod" to request.method,
                "httpStatus" to 500,
                "requestId" to requestId,
                "stackTraceHash" to stackTraceHash
            )
        )

        return ResponseEntity.internalServerError().body(
            ErrorResponse(
                error = "InternalServerError",
                message = "An unexpected error occurred",
                requestId = requestId
            )
        )
    }
}
