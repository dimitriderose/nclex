package com.nclex.config

import io.github.bucket4j.Bandwidth
import io.github.bucket4j.Bucket
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap

@Service
class RateLimitService(
    @Value("\${nclex.rate-limit.login.capacity}") private val loginCapacity: Long,
    @Value("\${nclex.rate-limit.login.refill-minutes}") private val loginRefillMinutes: Long,
    @Value("\${nclex.rate-limit.register.capacity}") private val registerCapacity: Long,
    @Value("\${nclex.rate-limit.register.refill-minutes}") private val registerRefillMinutes: Long,
    @Value("\${nclex.rate-limit.claude.capacity}") private val claudeCapacity: Long,
    @Value("\${nclex.rate-limit.claude.refill-minutes}") private val claudeRefillMinutes: Long
) {

    private val loginBuckets = ConcurrentHashMap<String, Bucket>()
    private val registerBuckets = ConcurrentHashMap<String, Bucket>()
    private val claudeBuckets = ConcurrentHashMap<String, Bucket>()

    fun tryConsumeLogin(ip: String): Boolean {
        val bucket = loginBuckets.computeIfAbsent(ip) {
            Bucket.builder()
                .addLimit(Bandwidth.simple(loginCapacity, Duration.ofMinutes(loginRefillMinutes)))
                .build()
        }
        return bucket.tryConsume(1)
    }

    fun tryConsumeRegister(ip: String): Boolean {
        val bucket = registerBuckets.computeIfAbsent(ip) {
            Bucket.builder()
                .addLimit(Bandwidth.simple(registerCapacity, Duration.ofMinutes(registerRefillMinutes)))
                .build()
        }
        return bucket.tryConsume(1)
    }

    fun tryConsumeClaude(userId: String): Boolean {
        val bucket = claudeBuckets.computeIfAbsent(userId) {
            Bucket.builder()
                .addLimit(Bandwidth.simple(claudeCapacity, Duration.ofMinutes(claudeRefillMinutes)))
                .build()
        }
        return bucket.tryConsume(1)
    }
}
