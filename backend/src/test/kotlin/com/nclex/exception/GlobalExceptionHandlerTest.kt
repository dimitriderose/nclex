package com.nclex.exception

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import io.mockk.*
import io.mockk.impl.annotations.MockK
import io.mockk.junit5.MockKExtension
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.slf4j.MDC
import org.springframework.http.HttpStatus
import org.springframework.validation.BindingResult
import org.springframework.validation.FieldError
import org.springframework.web.bind.MethodArgumentNotValidException
import java.util.UUID

@ExtendWith(MockKExtension::class)
class GlobalExceptionHandlerTest {

    @MockK
    private lateinit var auditLogger: AuditLogger

    @MockK
    private lateinit var request: HttpServletRequest

    private lateinit var handler: GlobalExceptionHandler

    private val testRequestId = "test-request-id-123"

    @BeforeEach
    fun setUp() {
        handler = GlobalExceptionHandler(auditLogger, request)

        every { request.getAttribute("userId") } returns null
        every { request.getHeader("X-Forwarded-For") } returns null
        every { request.remoteAddr } returns "127.0.0.1"
        every { request.requestURI } returns "/api/test"
        every { request.method } returns "GET"
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "TEST")

        MDC.put("requestId", testRequestId)
    }

    @AfterEach
    fun tearDown() {
        MDC.clear()
    }

    // -- handleNclexException --

    @Test
    fun `handleNclexException - ValidationException returns 400 and VALIDATION_ERROR`() {
        val ex = ValidationException("invalid field")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
        assertThat(response.body!!.error).isEqualTo("ValidationException")
        assertThat(response.body!!.message).isEqualTo("invalid field")
        assertThat(response.body!!.requestId).isEqualTo(testRequestId)

        verify {
            auditLogger.log(
                eventType = "VALIDATION_ERROR",
                userId = null,
                ipAddress = "127.0.0.1",
                metadata = match { it["errorType"] == "ValidationException" }
            )
        }
    }

    @Test
    fun `handleNclexException - UnauthorizedException returns 401 and AUTH_FAILURE`() {
        val ex = UnauthorizedException("bad creds")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.UNAUTHORIZED)
        assertThat(response.body!!.error).isEqualTo("UnauthorizedException")

        verify {
            auditLogger.log(
                eventType = "AUTH_FAILURE",
                userId = null,
                ipAddress = "127.0.0.1",
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - ForbiddenException returns 403 and AUTH_FAILURE`() {
        val ex = ForbiddenException("no access")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.FORBIDDEN)

        verify {
            auditLogger.log(
                eventType = "AUTH_FAILURE",
                userId = null,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - NotFoundException returns 404 and NOT_FOUND_ERROR`() {
        val ex = NotFoundException("resource gone")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.NOT_FOUND)

        verify {
            auditLogger.log(
                eventType = "NOT_FOUND_ERROR",
                userId = null,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - ConflictException returns 409 and CONFLICT_ERROR`() {
        val ex = ConflictException("duplicate entry")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.CONFLICT)

        verify {
            auditLogger.log(
                eventType = "CONFLICT_ERROR",
                userId = null,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - RateLimitException returns 429 and RATE_LIMIT_HIT`() {
        val ex = RateLimitException()

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.TOO_MANY_REQUESTS)

        verify {
            auditLogger.log(
                eventType = "RATE_LIMIT_HIT",
                userId = null,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - ExternalServiceException returns 502 and EXTERNAL_SERVICE_ERROR`() {
        val ex = ExternalServiceException("claude down")

        val response = handler.handleNclexException(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_GATEWAY)

        verify {
            auditLogger.log(
                eventType = "EXTERNAL_SERVICE_ERROR",
                userId = null,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - includes userId from request attribute when present`() {
        val userId = UUID.randomUUID()
        every { request.getAttribute("userId") } returns userId

        val ex = ValidationException("test")
        handler.handleNclexException(ex)

        verify {
            auditLogger.log(
                eventType = "VALIDATION_ERROR",
                userId = userId,
                ipAddress = any(),
                metadata = any()
            )
        }
    }

    @Test
    fun `handleNclexException - metadata includes requestPath, method, httpStatus, requestId`() {
        val ex = NotFoundException("missing")

        handler.handleNclexException(ex)

        verify {
            auditLogger.log(
                eventType = "NOT_FOUND_ERROR",
                userId = null,
                ipAddress = "127.0.0.1",
                metadata = match {
                    it["requestPath"] == "/api/test" &&
                    it["requestMethod"] == "GET" &&
                    it["httpStatus"] == 404 &&
                    it["requestId"] == testRequestId
                }
            )
        }
    }

    @Test
    fun `handleNclexException - fallback UUID when MDC requestId is absent`() {
        MDC.remove("requestId")

        val ex = ValidationException("test")
        val response = handler.handleNclexException(ex)

        assertThat(response.body!!.requestId).isNotBlank()
        // Verify it looks like a UUID
        assertThat(response.body!!.requestId).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    }

    // -- handleValidation --

    @Test
    fun `handleValidation - formats field errors and returns 400`() {
        val bindingResult = mockk<BindingResult>()
        val fieldErrors = listOf(
            FieldError("obj", "email", "must not be blank"),
            FieldError("obj", "password", "too short")
        )
        every { bindingResult.fieldErrors } returns fieldErrors

        val ex = mockk<MethodArgumentNotValidException>()
        every { ex.bindingResult } returns bindingResult

        val response = handler.handleValidation(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
        assertThat(response.body!!.error).isEqualTo("ValidationException")
        assertThat(response.body!!.message).contains("email: must not be blank")
        assertThat(response.body!!.message).contains("password: too short")
        assertThat(response.body!!.requestId).isEqualTo(testRequestId)
    }

    @Test
    fun `handleValidation - fallback UUID when MDC requestId absent`() {
        MDC.remove("requestId")

        val bindingResult = mockk<BindingResult>()
        every { bindingResult.fieldErrors } returns emptyList()
        val ex = mockk<MethodArgumentNotValidException>()
        every { ex.bindingResult } returns bindingResult

        val response = handler.handleValidation(ex)

        assertThat(response.body!!.requestId).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    }

    // -- handleGeneral --

    @Test
    fun `handleGeneral - returns 500 with generic message and never exposes details`() {
        val ex = RuntimeException("secret internal details")

        val response = handler.handleGeneral(ex)

        assertThat(response.statusCode).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR)
        assertThat(response.body!!.error).isEqualTo("InternalServerError")
        assertThat(response.body!!.message).isEqualTo("An unexpected error occurred")
        assertThat(response.body!!.message).doesNotContain("secret internal details")
    }

    @Test
    fun `handleGeneral - audit logs with ERROR event type`() {
        val ex = RuntimeException("kaboom")

        handler.handleGeneral(ex)

        verify {
            auditLogger.log(
                eventType = "ERROR",
                userId = null,
                ipAddress = "127.0.0.1",
                metadata = match {
                    it["errorType"] == "RuntimeException" &&
                    it["httpStatus"] == 500 &&
                    it["requestId"] == testRequestId &&
                    it.containsKey("stackTraceHash")
                }
            )
        }
    }

    @Test
    fun `handleGeneral - includes stackTraceHash in metadata`() {
        val ex = RuntimeException("test")

        handler.handleGeneral(ex)

        verify {
            auditLogger.log(
                eventType = "ERROR",
                userId = null,
                ipAddress = any(),
                metadata = match { it.containsKey("stackTraceHash") && it["stackTraceHash"] != "unknown" }
            )
        }
    }

    @Test
    fun `handleGeneral - exception with no stack trace uses unknown hash`() {
        val ex = object : Exception("no stack") {
            override fun getStackTrace(): Array<StackTraceElement> = emptyArray()
        }

        handler.handleGeneral(ex)

        verify {
            auditLogger.log(
                eventType = "ERROR",
                userId = null,
                ipAddress = any(),
                metadata = match { it["stackTraceHash"] == "unknown" }
            )
        }
    }

    @Test
    fun `handleGeneral - exception with null message uses No message fallback`() {
        val ex = object : Exception(null as String?) {}

        handler.handleGeneral(ex)

        verify {
            auditLogger.log(
                eventType = "ERROR",
                userId = null,
                ipAddress = any(),
                metadata = match { it["message"] == "No message" }
            )
        }
    }

    @Test
    fun `handleGeneral - fallback UUID when MDC requestId absent`() {
        MDC.remove("requestId")

        val ex = RuntimeException("test")
        val response = handler.handleGeneral(ex)

        assertThat(response.body!!.requestId).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    }
}
