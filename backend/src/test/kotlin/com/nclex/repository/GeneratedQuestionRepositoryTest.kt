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
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class GeneratedQuestionRepositoryTest {

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
    private lateinit var generatedQuestionRepository: GeneratedQuestionRepository

    @Autowired
    private lateinit var questionAttemptRepository: QuestionAttemptRepository

    private val userA = UUID.randomUUID()
    private val userB = UUID.randomUUID()

    @BeforeEach
    fun seedUsers() {
        entityManager.entityManager.createNativeQuery(
            "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'hash')"
        ).setParameter("id", userA).setParameter("email", "${userA}@example.com").executeUpdate()

        entityManager.entityManager.createNativeQuery(
            "INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'hash')"
        ).setParameter("id", userB).setParameter("email", "${userB}@example.com").executeUpdate()
    }

    @AfterEach
    fun cleanup() {
        entityManager.entityManager.createNativeQuery("DELETE FROM question_attempts").executeUpdate()
        entityManager.entityManager.createNativeQuery("DELETE FROM flagged_questions").executeUpdate()
        entityManager.entityManager.createNativeQuery("DELETE FROM generated_questions").executeUpdate()
        entityManager.entityManager.createNativeQuery("DELETE FROM users").executeUpdate()
    }

    private fun question(
        topic: String = "Pharmacology",
        questionType: String = "mc",
        difficulty: String = "medium",
        usageCount: Int = 0,
        contentHash: String = UUID.randomUUID().toString()
    ): GeneratedQuestion {
        val q = GeneratedQuestion(
            topic = topic,
            questionType = questionType,
            difficulty = difficulty,
            ncjmmStep = "recognize_cues",
            stem = "Stem $contentHash",
            options = listOf(mapOf("id" to "A", "text" to "Option A", "isCorrect" to true)),
            correctAnswer = mapOf("correctOptionIds" to listOf("A")),
            rationale = "Because A",
            source = "OpenStax",
            contentHash = contentHash,
            usageCount = usageCount,
            createdAt = Instant.now(),
            lastUsedAt = null
        )
        return entityManager.persistAndFlush(q)
    }

    private fun attempt(userId: UUID, questionId: UUID, correct: Boolean = true): QuestionAttempt {
        val a = QuestionAttempt(userId = userId, questionId = questionId, correct = correct)
        return entityManager.persistAndFlush(a)
    }

    // ── findUnattemptedForUser ───────────────────────────────────────

    @Test
    fun `excludes rows the user has attempted but includes rows attempted by others`() {
        val attemptedByUserA = question(usageCount = 1)
        val attemptedByUserB = question(usageCount = 2)
        val untouched = question(usageCount = 0)

        attempt(userA, attemptedByUserA.id)
        attempt(userB, attemptedByUserB.id)
        entityManager.entityManager.flush()

        val result = generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userA, 10)

        val ids = result.map { it.id }
        assertThat(ids).contains(attemptedByUserB.id, untouched.id)
        assertThat(ids).doesNotContain(attemptedByUserA.id)
    }

    @Test
    fun `orders results by usage_count ascending`() {
        val high = question(usageCount = 5)
        val low = question(usageCount = 0)
        val mid = question(usageCount = 2)

        val result = generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userA, 10)

        val ids = result.map { it.id }
        assertThat(ids).containsExactly(low.id, mid.id, high.id)
    }

    @Test
    fun `filters by topic, question type, and difficulty`() {
        val matching = question(topic = "Pharmacology", questionType = "mc", difficulty = "medium")
        question(topic = "Cardiology", questionType = "mc", difficulty = "medium")
        question(topic = "Pharmacology", questionType = "sata", difficulty = "medium")
        question(topic = "Pharmacology", questionType = "mc", difficulty = "hard")

        val result = generatedQuestionRepository.findUnattemptedForUser("Pharmacology", "mc", "medium", userA, 10)

        assertThat(result).extracting<UUID> { it.id }.containsExactly(matching.id)
    }

    // ── insertIfAbsent ───────────────────────────────────────────────

    @Test
    fun `insertIfAbsent returns the new id when content_hash is not a duplicate`() {
        val id = UUID.randomUUID()
        val hash = "fresh-hash-${UUID.randomUUID()}"

        val returnedId = generatedQuestionRepository.insertIfAbsent(
            id = id,
            topic = "Pharmacology",
            questionType = "mc",
            difficulty = "medium",
            ncjmmStep = "recognize_cues",
            stem = "A brand new stem",
            options = """[{"id":"A","text":"Option A","isCorrect":true}]""",
            correctAnswer = """{"correctOptionIds":["A"]}""",
            rationale = "Because A",
            source = "OpenStax",
            contentHash = hash
        )

        assertThat(returnedId).isEqualTo(id)
        assertThat(generatedQuestionRepository.findById(id)).isPresent
    }

    @Test
    fun `insertIfAbsent returns null on content_hash collision and does not create a duplicate row`() {
        val hash = "shared-hash-${UUID.randomUUID()}"
        val existing = question(contentHash = hash)
        entityManager.entityManager.flush()
        entityManager.entityManager.clear()

        val newId = UUID.randomUUID()
        val returnedId = generatedQuestionRepository.insertIfAbsent(
            id = newId,
            topic = "Pharmacology",
            questionType = "mc",
            difficulty = "medium",
            ncjmmStep = "recognize_cues",
            stem = "A different stem text entirely",
            options = """[{"id":"A","text":"Option A","isCorrect":true}]""",
            correctAnswer = """{"correctOptionIds":["A"]}""",
            rationale = "Because A",
            source = "OpenStax",
            contentHash = hash
        )

        assertThat(returnedId).isNull()
        assertThat(generatedQuestionRepository.findById(newId)).isEmpty
        assertThat(generatedQuestionRepository.findByContentHash(hash)?.id).isEqualTo(existing.id)

        val countWithHash = entityManager.entityManager
            .createNativeQuery("SELECT COUNT(*) FROM generated_questions WHERE content_hash = :hash")
            .setParameter("hash", hash)
            .singleResult as Number
        assertThat(countWithHash.toInt()).isEqualTo(1)
    }

    // ── bumpUsage ────────────────────────────────────────────────────

    @Test
    fun `bumpUsage updates usage_count and last_used_at only for the given ids`() {
        val targeted = question(usageCount = 0)
        val untouched = question(usageCount = 0)
        entityManager.entityManager.flush()
        entityManager.entityManager.clear()

        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        generatedQuestionRepository.bumpUsage(listOf(targeted.id), now)
        entityManager.entityManager.clear()

        val updated = generatedQuestionRepository.findById(targeted.id).orElseThrow()
        val unchanged = generatedQuestionRepository.findById(untouched.id).orElseThrow()

        assertThat(updated.usageCount).isEqualTo(1)
        assertThat(updated.lastUsedAt).isNotNull
        assertThat(unchanged.usageCount).isEqualTo(0)
        assertThat(unchanged.lastUsedAt).isNull()
    }

    // ── findByContentHash ────────────────────────────────────────────

    @Test
    fun `findByContentHash round-trips a persisted row`() {
        val hash = "roundtrip-hash-${UUID.randomUUID()}"
        val saved = question(contentHash = hash)
        entityManager.entityManager.flush()
        entityManager.entityManager.clear()

        val found = generatedQuestionRepository.findByContentHash(hash)

        assertThat(found).isNotNull
        assertThat(found?.id).isEqualTo(saved.id)
        assertThat(found?.contentHash).isEqualTo(hash)
    }

    @Test
    fun `findByContentHash returns null for an unknown hash`() {
        assertThat(generatedQuestionRepository.findByContentHash("does-not-exist-${UUID.randomUUID()}")).isNull()
    }

    // ── content_hash UNIQUE constraint ───────────────────────────────

    @Test
    fun `content_hash has a unique constraint enforced at the database level`() {
        val hash = "unique-check-${UUID.randomUUID()}"
        question(contentHash = hash)
        entityManager.entityManager.flush()

        val duplicate = GeneratedQuestion(
            topic = "Pharmacology",
            questionType = "mc",
            difficulty = "medium",
            stem = "Another stem",
            options = listOf(mapOf("id" to "A", "text" to "Option A", "isCorrect" to true)),
            correctAnswer = mapOf("correctOptionIds" to listOf("A")),
            rationale = "Because A",
            contentHash = hash
        )

        assertThatThrownByPersisting(duplicate)
    }

    private fun assertThatThrownByPersisting(entity: GeneratedQuestion) {
        var threw = false
        try {
            entityManager.entityManager.persist(entity)
            entityManager.entityManager.flush()
        } catch (e: Exception) {
            threw = true
        }
        assertThat(threw).isTrue
    }
}
