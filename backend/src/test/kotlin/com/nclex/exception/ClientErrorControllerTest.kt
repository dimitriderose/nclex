package com.nclex.exception

import com.nclex.audit.AuditLogger
import com.nclex.model.AuditLog
import io.mockk.*
import jakarta.servlet.http.HttpServletRequest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.UUID

class ClientErrorControllerTest {

    private val auditLogger: AuditLogger = mockk()
    private val httpRequest: HttpServletRequest = mockk()

    private lateinit var controller: ClientErrorController

    @BeforeEach
    fun setUp() {
        controller = ClientErrorController(auditLogger)
        every { auditLogger.log(any(), any(), any(), any(), any()) } returns AuditLog(eventType = "test")
    }

    // ── reportClientError ──────────────────────────────────────────

    @Nested
    inner class ReportClientError {

        @Test
        fun `logs error with all fields and returns 200`() {
            val userId = UUID.randomUUID()
            every { httpRequest.getAttribute("userId") } returns userId
            every { httpRequest.remoteAddr } returns "10.0.0.1"
            every { httpRequest.getHeader("User-Agent") } returns "Mozilla/5.0"

            val report = ClientErrorReport(
                message = "TypeError: Cannot read property",
                componentStack = "at Component.render",
                url = "/dashboard"
            )

            val result = controller.reportClientError(report, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            assertThat(result.body!!["status"]).isEqualTo("reported")
            verify {
                auditLogger.log(
                    eventType = "CLIENT_ERROR",
                    userId = userId,
                    ipAddress = "10.0.0.1",
                    metadata = match {
                        it["errorMessage"] == "TypeError: Cannot read property" &&
                        it["componentStack"] == "at Component.render" &&
                        it["url"] == "/dashboard" &&
                        it["userAgent"] == "Mozilla/5.0"
                    }
                )
            }
        }

        @Test
        fun `null userId logged correctly`() {
            every { httpRequest.getAttribute("userId") } returns null
            every { httpRequest.remoteAddr } returns "127.0.0.1"
            every { httpRequest.getHeader("User-Agent") } returns "TestAgent"

            val report = ClientErrorReport(message = "Error", url = "/page")

            val result = controller.reportClientError(report, httpRequest)

            assertThat(result.statusCode.value()).isEqualTo(200)
            verify { auditLogger.log(eventType = "CLIENT_ERROR", userId = null, any(), any(), any()) }
        }

        @Test
        fun `null componentStack logged as empty string`() {
            every { httpRequest.getAttribute("userId") } returns null
            every { httpRequest.remoteAddr } returns "127.0.0.1"
            every { httpRequest.getHeader("User-Agent") } returns null

            val report = ClientErrorReport(message = "Error", componentStack = null, url = "/page")
            controller.reportClientError(report, httpRequest)

            verify {
                auditLogger.log(
                    eventType = "CLIENT_ERROR",
                    userId = null,
                    ipAddress = "127.0.0.1",
                    metadata = match {
                        it["componentStack"] == "" && it["userAgent"] == "unknown"
                    }
                )
            }
        }
    }

    // ── DTOs ───────────────────────────────────────────────────────

    @Nested
    inner class DTOs {

        @Test
        fun `ClientErrorReport defaults`() {
            val report = ClientErrorReport(message = "err", url = "/u")
            assertThat(report.componentStack).isNull()
        }

        @Test
        fun `ClientErrorReport with all fields`() {
            val report = ClientErrorReport("msg", "stack", "/url")
            assertThat(report.message).isEqualTo("msg")
            assertThat(report.componentStack).isEqualTo("stack")
            assertThat(report.url).isEqualTo("/url")
        }
    }
}
