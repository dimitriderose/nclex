package com.nclex.exception

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertAll
import org.springframework.http.HttpStatus
import org.assertj.core.api.Assertions.assertThat

class NclexExceptionTest {

    // -- ValidationException --

    @Test
    fun `ValidationException maps to 400 BAD_REQUEST`() {
        val ex = ValidationException("bad input")
        assertAll(
            { assertThat(ex.status).isEqualTo(HttpStatus.BAD_REQUEST) },
            { assertThat(ex.message).isEqualTo("bad input") }
        )
    }

    @Test
    fun `ValidationException preserves cause`() {
        val cause = RuntimeException("root cause")
        val ex = ValidationException("bad input", cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- UnauthorizedException --

    @Test
    fun `UnauthorizedException maps to 401 UNAUTHORIZED`() {
        val ex = UnauthorizedException()
        assertThat(ex.status).isEqualTo(HttpStatus.UNAUTHORIZED)
    }

    @Test
    fun `UnauthorizedException has default message`() {
        val ex = UnauthorizedException()
        assertThat(ex.message).isEqualTo("Authentication required")
    }

    @Test
    fun `UnauthorizedException accepts custom message`() {
        val ex = UnauthorizedException("custom auth message")
        assertThat(ex.message).isEqualTo("custom auth message")
    }

    @Test
    fun `UnauthorizedException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = UnauthorizedException(cause = cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- ForbiddenException --

    @Test
    fun `ForbiddenException maps to 403 FORBIDDEN`() {
        val ex = ForbiddenException()
        assertThat(ex.status).isEqualTo(HttpStatus.FORBIDDEN)
    }

    @Test
    fun `ForbiddenException has default message`() {
        val ex = ForbiddenException()
        assertThat(ex.message).isEqualTo("Access denied")
    }

    @Test
    fun `ForbiddenException accepts custom message`() {
        val ex = ForbiddenException("no access")
        assertThat(ex.message).isEqualTo("no access")
    }

    @Test
    fun `ForbiddenException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = ForbiddenException(cause = cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- NotFoundException --

    @Test
    fun `NotFoundException maps to 404 NOT_FOUND`() {
        val ex = NotFoundException("not found")
        assertAll(
            { assertThat(ex.status).isEqualTo(HttpStatus.NOT_FOUND) },
            { assertThat(ex.message).isEqualTo("not found") }
        )
    }

    @Test
    fun `NotFoundException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = NotFoundException("missing", cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- ConflictException --

    @Test
    fun `ConflictException maps to 409 CONFLICT`() {
        val ex = ConflictException("duplicate")
        assertAll(
            { assertThat(ex.status).isEqualTo(HttpStatus.CONFLICT) },
            { assertThat(ex.message).isEqualTo("duplicate") }
        )
    }

    @Test
    fun `ConflictException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = ConflictException("conflict", cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- RateLimitException --

    @Test
    fun `RateLimitException maps to 429 TOO_MANY_REQUESTS`() {
        val ex = RateLimitException()
        assertThat(ex.status).isEqualTo(HttpStatus.TOO_MANY_REQUESTS)
    }

    @Test
    fun `RateLimitException has default message`() {
        val ex = RateLimitException()
        assertThat(ex.message).isEqualTo("Too many requests. Please try again later.")
    }

    @Test
    fun `RateLimitException accepts custom message`() {
        val ex = RateLimitException("slow down")
        assertThat(ex.message).isEqualTo("slow down")
    }

    @Test
    fun `RateLimitException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = RateLimitException(cause = cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- ExternalServiceException --

    @Test
    fun `ExternalServiceException maps to 502 BAD_GATEWAY`() {
        val ex = ExternalServiceException("service down")
        assertAll(
            { assertThat(ex.status).isEqualTo(HttpStatus.BAD_GATEWAY) },
            { assertThat(ex.message).isEqualTo("service down") }
        )
    }

    @Test
    fun `ExternalServiceException preserves cause`() {
        val cause = RuntimeException("cause")
        val ex = ExternalServiceException("error", cause)
        assertThat(ex.cause).isSameAs(cause)
    }

    // -- Sealed class hierarchy --

    @Test
    fun `all exceptions are subtypes of NclexException and RuntimeException`() {
        val exceptions: List<NclexException> = listOf(
            ValidationException("a"),
            UnauthorizedException(),
            ForbiddenException(),
            NotFoundException("b"),
            ConflictException("c"),
            RateLimitException(),
            ExternalServiceException("d")
        )
        assertThat(exceptions).allMatch { it is RuntimeException }
    }
}
