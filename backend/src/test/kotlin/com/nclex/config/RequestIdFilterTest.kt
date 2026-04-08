package com.nclex.config

import io.mockk.*
import jakarta.servlet.DispatcherType
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.MDC

class RequestIdFilterTest {

    private lateinit var filter: RequestIdFilter
    private lateinit var request: HttpServletRequest
    private lateinit var response: HttpServletResponse
    private lateinit var filterChain: FilterChain

    @BeforeEach
    fun setUp() {
        filter = RequestIdFilter()
        request = mockk(relaxed = true)
        response = mockk(relaxed = true)
        filterChain = mockk()
        MDC.clear()

        // OncePerRequestFilter needs these to decide whether to invoke doFilterInternal
        every { request.getAttribute(any()) } returns null
        every { request.dispatcherType } returns DispatcherType.REQUEST
    }

    @Test
    fun `no X-Request-ID header generates UUID, puts in MDC, sets on response`() {
        every { request.getHeader("X-Request-ID") } returns null

        var mdcValueDuringFilter: String? = null
        every { filterChain.doFilter(any(), any()) } answers {
            mdcValueDuringFilter = MDC.get("requestId")
        }

        filter.doFilter(request, response, filterChain)

        // MDC was populated during the filter
        assertThat(mdcValueDuringFilter).isNotNull()
        assertThat(mdcValueDuringFilter).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

        // Response header was set
        verify { response.setHeader("X-Request-ID", mdcValueDuringFilter!!) }

        // MDC is cleaned up after filter completes
        assertThat(MDC.get("requestId")).isNull()
    }

    @Test
    fun `X-Request-ID header present uses provided value`() {
        val providedId = "my-custom-request-id"
        every { request.getHeader("X-Request-ID") } returns providedId

        var mdcValueDuringFilter: String? = null
        every { filterChain.doFilter(any(), any()) } answers {
            mdcValueDuringFilter = MDC.get("requestId")
        }

        filter.doFilter(request, response, filterChain)

        assertThat(mdcValueDuringFilter).isEqualTo(providedId)
        verify { response.setHeader("X-Request-ID", providedId) }
        assertThat(MDC.get("requestId")).isNull()
    }

    @Test
    fun `MDC is cleaned up even when filterChain throws`() {
        every { request.getHeader("X-Request-ID") } returns null
        every { filterChain.doFilter(any(), any()) } throws RuntimeException("filter error")

        assertThatThrownBy {
            filter.doFilter(request, response, filterChain)
        }.isInstanceOf(RuntimeException::class.java)

        // MDC must be cleaned up despite the exception
        assertThat(MDC.get("requestId")).isNull()
    }

    @Test
    fun `generated UUID is different for each request`() {
        every { request.getHeader("X-Request-ID") } returns null

        val capturedIds = mutableListOf<String>()
        every { filterChain.doFilter(any(), any()) } answers {
            capturedIds.add(MDC.get("requestId")!!)
        }

        filter.doFilter(request, response, filterChain)
        filter.doFilter(request, response, filterChain)

        assertThat(capturedIds).hasSize(2)
        assertThat(capturedIds[0]).isNotEqualTo(capturedIds[1])
    }
}
