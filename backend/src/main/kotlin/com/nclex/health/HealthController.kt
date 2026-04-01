package com.nclex.health

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.lang.management.ManagementFactory
import java.time.Instant
import javax.sql.DataSource

@RestController
@RequestMapping("/api/health")
class HealthController(
    private val dataSource: DataSource,
    @Value("\${spring.application.name:nclex-trainer}") private val appName: String
) {
    private val startupTime = Instant.now()

    @GetMapping
    fun health(): ResponseEntity<Map<String, Any>> {
        val dbHealthy = checkDatabase()
        val runtime = ManagementFactory.getRuntimeMXBean()
        val memory = ManagementFactory.getMemoryMXBean()

        val status = if (dbHealthy) "UP" else "DEGRADED"
        val httpStatus = if (dbHealthy) 200 else 503

        val response = mapOf(
            "status" to status,
            "service" to appName,
            "version" to "5.0.0",
            "timestamp" to Instant.now().toString(),
            "uptime" to java.time.Duration.between(startupTime, Instant.now()).toString(),
            "checks" to mapOf(
                "database" to if (dbHealthy) "UP" else "DOWN",
                "memory" to mapOf(
                    "heapUsedMB" to memory.heapMemoryUsage.used / (1024 * 1024),
                    "heapMaxMB" to memory.heapMemoryUsage.max / (1024 * 1024)
                )
            ),
            "jvm" to mapOf(
                "version" to runtime.specVersion,
                "uptime" to runtime.uptime
            )
        )

        return if (dbHealthy) {
            ResponseEntity.ok(response)
        } else {
            ResponseEntity.status(httpStatus).body(response)
        }
    }

    private fun checkDatabase(): Boolean {
        return runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT 1").use { stmt ->
                    stmt.executeQuery().use { rs ->
                        rs.next()
                    }
                }
            }
        }.getOrDefault(false)
    }
}
