package com.nclex.stats

import com.nclex.repository.ReadinessSnapshotRepository
import com.nclex.repository.UserStatsRepository
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import java.time.LocalDate
import java.util.UUID

@RestController
@RequestMapping("/api/readiness")
class ReadinessController(
    private val readinessScoreService: ReadinessScoreService,
    private val userStatsRepository: UserStatsRepository,
    private val readinessSnapshotRepository: ReadinessSnapshotRepository
) {
    /**
     * GET /api/readiness
     * Calculate current readiness score for the authenticated user.
     */
    @GetMapping
    fun getCurrentReadiness(
        @AuthenticationPrincipal userId: UUID
    ): ResponseEntity<Any> {
        val stats = userStatsRepository.findByUserId(userId)
            ?: return ResponseEntity.ok(mapOf(
                "score" to 0,
                "band" to "Low",
                "message" to "No study data yet. Start practicing to see your readiness score."
            ))

        val result = readinessScoreService.calculateReadiness(stats)
        return ResponseEntity.ok(result)
    }

    /**
     * GET /api/readiness/history?from=2026-01-01&to=2026-03-31
     * Get historical readiness snapshots for the authenticated user.
     */
    @GetMapping("/history")
    fun getReadinessHistory(
        @AuthenticationPrincipal userId: UUID,
        @RequestParam(required = false) from: LocalDate?,
        @RequestParam(required = false) to: LocalDate?
    ): ResponseEntity<Any> {
        val fromDate = from ?: LocalDate.now().minusDays(30)
        val toDate = to ?: LocalDate.now()

        val snapshots = readinessSnapshotRepository
            .findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(userId, fromDate, toDate)

        return ResponseEntity.ok(mapOf(
            "snapshots" to snapshots,
            "from" to fromDate,
            "to" to toDate,
            "count" to snapshots.size
        ))
    }
}
