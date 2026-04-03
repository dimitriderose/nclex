package com.nclex.stats

import com.nclex.audit.AuditLogger
import com.nclex.exception.NotFoundException
import com.nclex.exception.UnauthorizedException
import com.nclex.model.UserStats
import com.nclex.repository.UserStatsRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.UUID

data class UpdateStatsRequest(
    val topicScores: Map<String, Any>? = null,
    val history: List<Map<String, Any>>? = null,
    val streak: Int? = null,
    val readinessScore: Double? = null,
    val ncjmmScores: Map<String, Any>? = null
)

@RestController
@RequestMapping("/api/stats")
class UserStatsController(
    private val userStatsRepository: UserStatsRepository,
    private val auditLogger: AuditLogger
) {

    @GetMapping
    fun getStats(request: HttpServletRequest): ResponseEntity<UserStats> {
        val userId = extractUserId(request)
        val stats = userStatsRepository.findByUserId(userId)
            ?: throw NotFoundException("Stats not found for user")
        return ResponseEntity.ok(stats)
    }

    @PutMapping
    @Transactional
    fun updateStats(
        @RequestBody body: UpdateStatsRequest,
        request: HttpServletRequest
    ): ResponseEntity<UserStats> {
        val userId = extractUserId(request)
        val stats = userStatsRepository.findByUserId(userId)
            ?: throw NotFoundException("Stats not found for user")

        body.topicScores?.let { stats.topicScores = it }
        body.history?.let { stats.history = it }
        body.streak?.let { stats.streak = it }
        body.readinessScore?.let { stats.readinessScore = it }
        body.ncjmmScores?.let { stats.ncjmmScores = it }
        stats.lastActiveAt = Instant.now()
        stats.updatedAt = Instant.now()

        auditLogger.log(eventType = "STATS_UPDATED", userId = userId)
        return ResponseEntity.ok(userStatsRepository.save(stats))
    }

    @PatchMapping("/streak")
    @Transactional
    fun updateStreak(
        @RequestBody body: Map<String, Int>,
        request: HttpServletRequest
    ): ResponseEntity<UserStats> {
        val userId = extractUserId(request)
        val stats = userStatsRepository.findByUserId(userId)
            ?: throw NotFoundException("Stats not found for user")

        body["streak"]?.let { stats.streak = it }
        stats.lastActiveAt = Instant.now()
        stats.updatedAt = Instant.now()

        return ResponseEntity.ok(userStatsRepository.save(stats))
    }

    @PatchMapping("/history")
    @Transactional
    fun appendHistory(
        @RequestBody entry: Map<String, Any>,
        request: HttpServletRequest
    ): ResponseEntity<UserStats> {
        val userId = extractUserId(request)
        val stats = userStatsRepository.findByUserId(userId)
            ?: throw NotFoundException("Stats not found for user")

        stats.history = stats.history + entry
        stats.lastActiveAt = Instant.now()
        stats.updatedAt = Instant.now()

        auditLogger.log(eventType = "HISTORY_APPENDED", userId = userId)
        return ResponseEntity.ok(userStatsRepository.save(stats))
    }

    private fun extractUserId(request: HttpServletRequest): UUID {
        return request.getAttribute("userId") as? UUID
            ?: throw UnauthorizedException()
    }
}
