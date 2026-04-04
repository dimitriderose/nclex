package com.nclex.config

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RateLimitConfigTest {

    // Small capacities for testing
    private val rateLimitService = RateLimitService(
        loginCapacity = 3,
        loginRefillMinutes = 1,
        registerCapacity = 2,
        registerRefillMinutes = 1,
        claudeCapacity = 5,
        claudeRefillMinutes = 1
    )

    // ── tryConsumeLogin ─────────────────────────────────────────

    @Test
    fun `tryConsumeLogin succeeds within capacity`() {
        val ip = "10.0.0.1"
        assertThat(rateLimitService.tryConsumeLogin(ip)).isTrue()
        assertThat(rateLimitService.tryConsumeLogin(ip)).isTrue()
        assertThat(rateLimitService.tryConsumeLogin(ip)).isTrue()
    }

    @Test
    fun `tryConsumeLogin fails when capacity exceeded`() {
        val ip = "10.0.0.2"
        repeat(3) { rateLimitService.tryConsumeLogin(ip) }
        assertThat(rateLimitService.tryConsumeLogin(ip)).isFalse()
    }

    @Test
    fun `tryConsumeLogin different IPs have separate buckets`() {
        val ip1 = "10.0.0.3"
        val ip2 = "10.0.0.4"
        repeat(3) { rateLimitService.tryConsumeLogin(ip1) }
        // ip1 is exhausted
        assertThat(rateLimitService.tryConsumeLogin(ip1)).isFalse()
        // ip2 should still have capacity
        assertThat(rateLimitService.tryConsumeLogin(ip2)).isTrue()
    }

    // ── tryConsumeRegister ──────────────────────────────────────

    @Test
    fun `tryConsumeRegister succeeds within capacity`() {
        val ip = "10.0.1.1"
        assertThat(rateLimitService.tryConsumeRegister(ip)).isTrue()
        assertThat(rateLimitService.tryConsumeRegister(ip)).isTrue()
    }

    @Test
    fun `tryConsumeRegister fails when capacity exceeded`() {
        val ip = "10.0.1.2"
        repeat(2) { rateLimitService.tryConsumeRegister(ip) }
        assertThat(rateLimitService.tryConsumeRegister(ip)).isFalse()
    }

    @Test
    fun `tryConsumeRegister different IPs have separate buckets`() {
        val ip1 = "10.0.1.3"
        val ip2 = "10.0.1.4"
        repeat(2) { rateLimitService.tryConsumeRegister(ip1) }
        assertThat(rateLimitService.tryConsumeRegister(ip1)).isFalse()
        assertThat(rateLimitService.tryConsumeRegister(ip2)).isTrue()
    }

    // ── tryConsumeClaude ────────────────────────────────────────

    @Test
    fun `tryConsumeClaude succeeds within capacity`() {
        val userId = "user-1"
        repeat(5) {
            assertThat(rateLimitService.tryConsumeClaude(userId)).isTrue()
        }
    }

    @Test
    fun `tryConsumeClaude fails when capacity exceeded`() {
        val userId = "user-2"
        repeat(5) { rateLimitService.tryConsumeClaude(userId) }
        assertThat(rateLimitService.tryConsumeClaude(userId)).isFalse()
    }

    @Test
    fun `tryConsumeClaude different userIds have separate buckets`() {
        val user1 = "user-3"
        val user2 = "user-4"
        repeat(5) { rateLimitService.tryConsumeClaude(user1) }
        assertThat(rateLimitService.tryConsumeClaude(user1)).isFalse()
        assertThat(rateLimitService.tryConsumeClaude(user2)).isTrue()
    }
}
