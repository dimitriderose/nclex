package com.nclex.repository

import com.nclex.model.GeneratedQuestion
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface GeneratedQuestionRepository : JpaRepository<GeneratedQuestion, UUID> {

    fun findByContentHash(contentHash: String): GeneratedQuestion?

    /**
     * Bank-first selection: rows for this topic/type/difficulty the user hasn't attempted yet,
     * least-used first (with random tiebreak) so the pool rotates fairly. Correlated NOT EXISTS
     * scales far better than NOT IN/LEFT JOIN for this anti-join shape.
     */
    @Query(
        value = """
            SELECT gq.* FROM generated_questions gq
            WHERE gq.topic = :topic AND gq.question_type = :questionType AND gq.difficulty = :difficulty
              AND NOT EXISTS (
                  SELECT 1 FROM question_attempts qa
                  WHERE qa.user_id = :userId AND qa.question_id = gq.id
              )
            ORDER BY gq.usage_count ASC, random()
            LIMIT :limit
        """,
        nativeQuery = true
    )
    fun findUnattemptedForUser(
        @Param("topic") topic: String,
        @Param("questionType") questionType: String,
        @Param("difficulty") difficulty: String,
        @Param("userId") userId: UUID,
        @Param("limit") limit: Int
    ): List<GeneratedQuestion>

    /**
     * Native upsert-by-content-hash. Returns the new row's id, or null if a row with this
     * hash already existed (caller falls back to findByContentHash to get the existing id).
     * Avoids app-level "catch the unique violation" handling, which is fragile across
     * Hibernate's exception wrapping.
     */
    @Query(
        value = """
            INSERT INTO generated_questions
                (id, topic, question_type, difficulty, ncjmm_step, stem, options, correct_answer,
                 rationale, source, content_hash, usage_count, created_at, last_used_at)
            VALUES
                (:id, :topic, :questionType, :difficulty, :ncjmmStep, :stem,
                 CAST(:options AS jsonb), CAST(:correctAnswer AS jsonb),
                 :rationale, :source, :contentHash, 0, NOW(), NULL)
            ON CONFLICT (content_hash) DO NOTHING
            RETURNING id
        """,
        nativeQuery = true
    )
    fun insertIfAbsent(
        @Param("id") id: UUID,
        @Param("topic") topic: String,
        @Param("questionType") questionType: String,
        @Param("difficulty") difficulty: String,
        @Param("ncjmmStep") ncjmmStep: String?,
        @Param("stem") stem: String,
        @Param("options") options: String,
        @Param("correctAnswer") correctAnswer: String,
        @Param("rationale") rationale: String,
        @Param("source") source: String?,
        @Param("contentHash") contentHash: String
    ): UUID?

    /**
     * Atomic single-statement bump — avoids the read-then-write race that would lose
     * concurrent updates to usage_count under load (DBA finding; see plan's "Reconciled
     * judgment calls"). Async/batched aggregation is the documented follow-up if this
     * becomes a measurable contention point — not built preemptively.
     *
     * Note: native queries require the IN-list parameter to be parenthesized — `IN :ids`
     * is JPQL collection-expansion syntax and is NOT expanded by Hibernate for native SQL;
     * it must be written as `IN (:ids)` for the driver to bind/expand the List<UUID>.
     *
     * Callers are expected to guard against empty id lists and to pre-sort ids for
     * deterministic lock ordering — see [com.nclex.question.QuestionBankPersistence.bumpUsage],
     * which owns that orchestration so this stays a declarative query method.
     */
    @Modifying
    @Query(
        value = "UPDATE generated_questions SET usage_count = usage_count + 1, last_used_at = :now WHERE id IN (:ids)",
        nativeQuery = true
    )
    fun bumpUsage(@Param("ids") ids: List<UUID>, @Param("now") now: Instant)
}
