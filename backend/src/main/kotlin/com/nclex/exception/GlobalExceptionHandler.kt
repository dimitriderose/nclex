package com.nclex.exception

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
class GlobalExceptionHandler {

    private val logger = LoggerFactory.getLogger(javaClass)

    @ExceptionHandler(NclexException::class)
    fun handleNclexException(ex: NclexException): ResponseEntity<ErrorResponse> {
        val requestId = MDC.get("requestId") ?: UUID.randomUUID().toString()
        logger.warn("[{}] {} - {}", requestId, ex::class.simpleName, ex.message)
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
        return ResponseEntity.internalServerError().body(
            ErrorResponse(
                error = "InternalServerError",
                message = "An unexpected error occurred",
                requestId = requestId
            )
        )
    }
}
