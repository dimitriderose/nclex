package com.nclex.scheduled

import com.nclex.model.ReadinessSnapshot
import com.nclex.repository.ReadinessSnapshotRepository
import com.nclex.repository.UserStatsRepository
import com.nclex.audit.AuditLogger
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

@Service
class ReadinessSnapshotService(
    private val userStatsRepository: UserStatsRepository,
    private val readinessSnapshotRepository: ReadinessSnapshotRepository,
    private val auditLogger: AuditLogger
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    /**
     * Daily batch job: create a ReadinessSnapshot for every user who was active
     * in the last 24 hours. Runs at 4 AM server time.
     */
    @Scheduled(cron = "\${nclex.snapshot.cron:0 0 4 * * *}")
    @Transactional
    fun generateDailySnapshots() {
        logger.info("Starting daily readiness snapshot generation")
        val startTime = Instant.now()
        val today = LocalDate.now()
        val since = Instant.now().minus(24, ChronoUnit.HOURS)

        val activeUsers = userStatsRepository.findActiveUsersSince(since)
        var created = 0
        var skipped = 0
        var failed = 0

        for (stats in activeUsers) {
            runCatching {
                // Skip if snapshot already exists for today
                val existing = readinessSnapshotRepository.findByUserIdAndSnapshotDate(
                    stats.userId, today
                )
                if (existing != null) {
                    skipped++
                    return@runCatching
                }

                val band = when {
                    stats.readinessScore >= 90 -> "Very High"
                    stats.readinessScore >= 75 -> "High"
                    stats.readinessScore >= 60 -> "Borderline"
                    else -> "Low"
                }

                @Suppress("UNCHECKED_CAST")
                val snapshot = ReadinessSnapshot(
                    userId = stats.userId,
                    snapshotDate = today,
                    readinessScore = stats.readinessScore,
                    readinessBand = band,
                    topicBreakdown = stats.topicScores,
                    ncjmmBreakdown = stats.ncjmmScores,
                    questionsAnswered = stats.history.size
                )
                readinessSnapshotRepository.save(snapshot)
                created++
            }.onFailure { ex ->
                failed++
                logger.error("Failed to create snapshot for user {}: {}", stats.userId, ex.message)
            }
        }

        val elapsed = java.time.Duration.between(startTime, Instant.now())
        logger.info(
            "Snapshot generation complete: {} created, {} skipped, {} failed ({}ms)",
            created, skipped, failed, elapsed.toMillis()
        )

        auditLogger.log(
            eventType = "DAILY_SNAPSHOT_COMPLETE",
            metadata = mapOf(
                "created" to created,
                "skipped" to skipped,
                "failed" to failed,
                "activeUsers" to activeUsers.size,
                "elapsedMs" to elapsed.toMillis()
            )
        )
    }
}
