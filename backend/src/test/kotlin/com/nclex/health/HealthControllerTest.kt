package com.nclex.health

import io.mockk.*
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.sql.Connection
import java.sql.PreparedStatement
import java.sql.ResultSet
import javax.sql.DataSource

class HealthControllerTest {

    private val dataSource: DataSource = mockk()
    private val connection: Connection = mockk()
    private val preparedStatement: PreparedStatement = mockk()
    private val resultSet: ResultSet = mockk()

    private lateinit var controller: HealthController

    @BeforeEach
    fun setUp() {
        controller = HealthController(dataSource, "nclex-trainer-test")
    }

    private fun mockHealthyDatabase() {
        every { dataSource.connection } returns connection
        every { connection.prepareStatement("SELECT 1") } returns preparedStatement
        every { preparedStatement.executeQuery() } returns resultSet
        every { resultSet.next() } returns true
        every { resultSet.close() } just Runs
        every { preparedStatement.close() } just Runs
        every { connection.close() } just Runs
    }

    private fun mockUnhealthyDatabase() {
        every { dataSource.connection } throws RuntimeException("DB connection failed")
    }

    // ── healthy database ────────────────────────────────────────────

    @Nested
    inner class HealthyDatabase {

        @Test
        fun `returns 200 with UP status when database is healthy`() {
            mockHealthyDatabase()

            val response = controller.health()

            assertThat(response.statusCode.value()).isEqualTo(200)
            val body = response.body!!
            assertThat(body["status"]).isEqualTo("UP")
            assertThat(body["service"]).isEqualTo("nclex-trainer-test")
            assertThat(body["version"]).isEqualTo("5.0.0")
            assertThat(body).containsKey("timestamp")
            assertThat(body).containsKey("uptime")
            assertThat(body).containsKey("jvm")
        }

        @Test
        @Suppress("UNCHECKED_CAST")
        fun `checks section reports database UP`() {
            mockHealthyDatabase()

            val response = controller.health()
            val checks = response.body!!["checks"] as Map<String, Any>
            assertThat(checks["database"]).isEqualTo("UP")
            assertThat(checks).containsKey("memory")
        }

        @Test
        @Suppress("UNCHECKED_CAST")
        fun `memory section includes heapUsedMB and heapMaxMB`() {
            mockHealthyDatabase()

            val response = controller.health()
            val checks = response.body!!["checks"] as Map<String, Any>
            val memory = checks["memory"] as Map<String, Any>
            assertThat(memory).containsKey("heapUsedMB")
            assertThat(memory).containsKey("heapMaxMB")
        }

        @Test
        @Suppress("UNCHECKED_CAST")
        fun `jvm section includes version and uptime`() {
            mockHealthyDatabase()

            val response = controller.health()
            val jvm = response.body!!["jvm"] as Map<String, Any>
            assertThat(jvm).containsKey("version")
            assertThat(jvm).containsKey("uptime")
        }
    }

    // ── unhealthy database ──────────────────────────────────────────

    @Nested
    inner class UnhealthyDatabase {

        @Test
        fun `returns 503 with DEGRADED status when database is down`() {
            mockUnhealthyDatabase()

            val response = controller.health()

            assertThat(response.statusCode.value()).isEqualTo(503)
            val body = response.body!!
            assertThat(body["status"]).isEqualTo("DEGRADED")
        }

        @Test
        @Suppress("UNCHECKED_CAST")
        fun `checks section reports database DOWN`() {
            mockUnhealthyDatabase()

            val response = controller.health()
            val checks = response.body!!["checks"] as Map<String, Any>
            assertThat(checks["database"]).isEqualTo("DOWN")
        }

        @Test
        fun `contains all required fields even when degraded`() {
            mockUnhealthyDatabase()

            val response = controller.health()
            val body = response.body!!
            assertThat(body).containsKey("status")
            assertThat(body).containsKey("service")
            assertThat(body).containsKey("version")
            assertThat(body).containsKey("timestamp")
            assertThat(body).containsKey("uptime")
            assertThat(body).containsKey("checks")
            assertThat(body).containsKey("jvm")
        }
    }

    // ── database check returns false on rs.next() ───────────────────

    @Nested
    inner class DatabaseCheckEdgeCases {

        @Test
        fun `resultSet next returns false means unhealthy`() {
            every { dataSource.connection } returns connection
            every { connection.prepareStatement("SELECT 1") } returns preparedStatement
            every { preparedStatement.executeQuery() } returns resultSet
            every { resultSet.next() } returns false
            every { resultSet.close() } just Runs
            every { preparedStatement.close() } just Runs
            every { connection.close() } just Runs

            val response = controller.health()

            assertThat(response.statusCode.value()).isEqualTo(503)
            assertThat(response.body!!["status"]).isEqualTo("DEGRADED")
        }

        @Test
        fun `prepareStatement throws returns unhealthy`() {
            every { dataSource.connection } returns connection
            every { connection.prepareStatement("SELECT 1") } throws RuntimeException("Prepare failed")
            every { connection.close() } just Runs

            val response = controller.health()

            assertThat(response.statusCode.value()).isEqualTo(503)
        }
    }
}
