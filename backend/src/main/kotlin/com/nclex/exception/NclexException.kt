package com.nclex.exception

import org.springframework.http.HttpStatus

sealed class NclexException(
    override val message: String,
    val status: HttpStatus,
    override val cause: Throwable? = null
) : RuntimeException(message, cause)

class ValidationException(
    message: String,
    cause: Throwable? = null
) : NclexException(message, HttpStatus.BAD_REQUEST, cause)

class UnauthorizedException(
    message: String = "Authentication required",
    cause: Throwable? = null
) : NclexException(message, HttpStatus.UNAUTHORIZED, cause)

class ForbiddenException(
    message: String = "Access denied",
    cause: Throwable? = null
) : NclexException(message, HttpStatus.FORBIDDEN, cause)

class NotFoundException(
    message: String,
    cause: Throwable? = null
) : NclexException(message, HttpStatus.NOT_FOUND, cause)

class ConflictException(
    message: String,
    cause: Throwable? = null
) : NclexException(message, HttpStatus.CONFLICT, cause)

class RateLimitException(
    message: String = "Too many requests. Please try again later.",
    cause: Throwable? = null
) : NclexException(message, HttpStatus.TOO_MANY_REQUESTS, cause)

class ExternalServiceException(
    message: String,
    cause: Throwable? = null
) : NclexException(message, HttpStatus.BAD_GATEWAY, cause)
