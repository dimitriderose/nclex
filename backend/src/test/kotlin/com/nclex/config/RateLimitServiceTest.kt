package com.nclex.config

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RateLimitServiceTest {

    // -- tryConsumeLogin --

    @Test
    fun `tryConsumeLogin succeeds capacity times then fails`() {
        val capacity = 5L
        val service = RateLimitService(
            loginCapacity = capacity,
            loginRefillMinutes = 60,
            registerCapacity = 10,
            registerRefillMinutes = 60,
            claudeCapacity = 10,
            claudeRefillMinutes = 60
        )

        val ip = "192.168.1.1"
        for (i in 1..capacity) {
            assertThat(service.tryConsumeLogin(ip))
                .describedAs("Attempt $i should succeed")
                .isTrue()
        }

        assertThat(service.tryConsumeLogin(ip))
            .describedAs("Attempt after capacity should fail")
            .isFalse()
    }

    // -- tryConsumeRegister --

    @Test
    fun `tryConsumeRegister succeeds capacity times then fails`() {
        val capacity = 3L
        val service = RateLimitService(
            loginCapacity = 10,
            loginRefillMinutes = 60,
            registerCapacity = capacity,
            registerRefillMinutes = 60,
            claudeCapacity = 10,
            claudeRefillMinutes = 60
        )

        val ip = "10.0.0.1"
        for (i in 1..capacity) {
            assertThat(service.tryConsumeRegister(ip))
                .describedAs("Attempt $i should succeed")
                .isTrue()
        }

        assertThat(service.tryConsumeRegister(ip))
            .describedAs("Attempt after capacity should fail")
            .isFalse()
    }

    // -- tryConsumeClaude --

    @Test
    fun `tryConsumeClaude succeeds capacity times then fails`() {
        val capacity = 4L
        val service = RateLimitService(
            loginCapacity = 10,
            loginRefillMinutes = 60,
            registerCapacity = 10,
            registerRefillMinutes = 60,
            claudeCapacity = capacity,
            claudeRefillMinutes = 60
        )

        val userId = "user-123"
        for (i in 1..capacity) {
            assertThat(service.tryConsumeClaude(userId))
                .describedAs("Attempt $i should succeed")
                .isTrue()
        }

        assertThat(service.tryConsumeClaude(userId))
            .describedAs("Attempt after capacity should fail")
            .isFalse()
    }

    // -- Different IPs/userIds use separate buckets --

    @Test
    fun `different IPs have separate login buckets`() {
        val service = RateLimitService(
            loginCapacity = 1,
            loginRefillMinutes = 60,
            registerCapacity = 10,
            registerRefillMinutes = 60,
            claudeCapacity = 10,
            claudeRefillMinutes = 60
        )

        assertThat(service.tryConsumeLogin("ip1")).isTrue()
        assertThat(service.tryConsumeLogin("ip1")).isFalse() // exhausted for ip1

        // ip2 still has capacity
        assertThat(service.tryConsumeLogin("ip2")).isTrue()
    }

    @Test
    fun `different IPs have separate register buckets`() {
        val service = RateLimitService(
            loginCapacity = 10,
            loginRefillMinutes = 60,
            registerCapacity = 1,
            registerRefillMinutes = 60,
            claudeCapacity = 10,
            claudeRefillMinutes = 60
        )

        assertThat(service.tryConsumeRegister("ip1")).isTrue()
        assertThat(service.tryConsumeRegister("ip1")).isFalse()

        assertThat(service.tryConsumeRegister("ip2")).isTrue()
    }

    @Test
    fun `different userIds have separate claude buckets`() {
        val service = RateLimitService(
            loginCapacity = 10,
            loginRefillMinutes = 60,
            registerCapacity = 10,
            registerRefillMinutes = 60,
            claudeCapacity = 1,
            claudeRefillMinutes = 60
        )

        assertThat(service.tryConsumeClaude("user-a")).isTrue()
        assertThat(service.tryConsumeClaude("user-a")).isFalse()

        assertThat(service.tryConsumeClaude("user-b")).isTrue()
    }

    @Test
    fun `login and register buckets are independent for same IP`() {
        val service = RateLimitService(
            loginCapacity = 1,
            loginRefillMinutes = 60,
            registerCapacity = 1,
            registerRefillMinutes = 60,
            claudeCapacity = 10,
            claudeRefillMinutes = 60
        )

        val ip = "shared-ip"
        assertThat(service.tryConsumeLogin(ip)).isTrue()
        assertThat(service.tryConsumeLogin(ip)).isFalse()

        // Register bucket is independent
        assertThat(service.tryConsumeRegister(ip)).isTrue()
    }
}
