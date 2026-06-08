package com.nclex.repository

import com.nclex.model.GeneratedQuestion
import com.nclex.model.QuestionAttempt
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.time.Instant
import java.util.UUID

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class QuestionAttemptRepositoryTest {

    companion object {
        @Container
        @JvmStatic
        val postgres: PostgreSQLContainer<*> = PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("nclex_test")
            .withUsername("nclex")
            .withPassword("nclex")

        @JvmStatic
        @DynamicPropertySource
        fun registerProperties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("spring.flyway.enabled") { "true" }
            registry.add("spring.jpa.hibernate.ddl-auto") { "validate" }
        }
    }

    @Autowired
    private lateinit var entityManager: TestEntityManager

    @Autowired
    private lateinit var questionAttemptRepository: QuestionAttemptRepository

    private lateinit var userId: UUID
    private lateinit var questionId: UUID

    @BeforeEach
    fun seedUserAndQuestion() {
        userId = UUID.randomUUID()
        entityManager.entityManager.createNativeQuery(
            "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'hash')"
        ).setParameter("id", userId).setParameter("email", "${userId}@example.com").executeUpdate()

        val question = GeneratedQuestion(
            topic = "Pharmacology",
            questionType = "mc",
            difficulty = "medium",
            stem = "Stem ${UUID.randomUUID()}",
            options = listOf(mapOf("id" to "A", "text" to "Option A", "isCorrect" to true)),
            correctAnswer = mapOf("correctOptionIds" to listOf("A")),
            rationale = "Because A",
            contentHash = "hash-${UUID.randomUUID()}",
            createdAt = Instant.now()
        )
        questionId = entityManager.persistAndFlush(question).id
    }

    @AfterEach
    fun cleanup() {
        entityManager.entityManager.createNativeQuery("DELETE FROM question_attempts").executeUpdate()
        entityManager.entityManager.createNativeQuery("DELETE FROM generated_questions").executeUpdate()
        entityManager.entityManager.createNativeQuery("DELETE FROM users").executeUpdate()
    }

    private fun saveAttempt(correct: Boolean, source: String = "practice"): QuestionAttempt =
        entityManager.persistAndFlush(
            QuestionAttempt(userId = userId, questionId = questionId, correct = correct, source = source)
        )

    // ── findByUserIdAndQuestionId ────────────────────────────────────

    @Test
    fun `returns multiple rows when the same user retried the same question`() {
        val first = saveAttempt(correct = false)
        val second = saveAttempt(correct = true)

        val result = questionAttemptRepository.findByUserIdAndQuestionId(userId, questionId)

        assertThat(result).hasSize(2)
        assertThat(result.map { it.id }).containsExactlyInAnyOrder(first.id, second.id)
        assertThat(result.map { it.correct }).containsExactlyInAnyOrder(false, true)
    }

    @Test
    fun `returns empty list when the user has not attempted this question`() {
        val otherUser = UUID.randomUUID()
        entityManager.entityManager.createNativeQuery(
            "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'hash')"
        ).setParameter("id", otherUser).setParameter("email", "${otherUser}@example.com").executeUpdate()
        saveAttempt(correct = true)

        val result = questionAttemptRepository.findByUserIdAndQuestionId(otherUser, questionId)

        assertThat(result).isEmpty()
    }

    // ── FK constraints ───────────────────────────────────────────────

    @Test
    fun `persisting an attempt with a bogus question_id violates the foreign key constraint`() {
        val attempt = QuestionAttempt(userId = userId, questionId = UUID.randomUUID(), correct = true)

        assertThatPersistFails(attempt)
    }

    @Test
    fun `persisting an attempt with a bogus user_id violates the foreign key constraint`() {
        val attempt = QuestionAttempt(userId = UUID.randomUUID(), questionId = questionId, correct = true)

        assertThatPersistFails(attempt)
    }

    private fun assertThatPersistFails(attempt: QuestionAttempt) {
        var threw = false
        try {
            entityManager.entityManager.persist(attempt)
            entityManager.entityManager.flush()
        } catch (e: Exception) {
            threw = true
            assertThat(e).isInstanceOfAny(DataIntegrityViolationException::class.java, RuntimeException::class.java)
        }
        assertThat(threw).isTrue
    }
}
