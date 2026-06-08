package com.nclex.question

import com.fasterxml.jackson.databind.ObjectMapper
import com.nclex.model.GeneratedQuestion
import com.nclex.repository.GeneratedQuestionRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/**
 * Orchestration layer in front of [QuestionGenerationService] (Architect-corrected service
 * boundary: the bank wraps generation, not the other way around — see plan's "Service boundary").
 *
 * Bank-first flow per request:
 *   1. Look up rows the user hasn't attempted yet (capped at ~70% of the requested count —
 *      the "quality/freshness" safeguard that keeps the long tail growing rather than letting
 *      the pool converge on "the same handful of questions per topic").
 *   2. Generate the shortfall fresh via [QuestionGenerationService].
 *   3. Persist newly generated questions (dedup-on-insert via [GeneratedQuestionRepository.insertIfAbsent]).
 *   4. Bump usage_count/last_used_at for served bank rows in one atomic statement.
 *
 * Deliberately NOT @Transactional at this level (Architect finding, "Transaction boundaries"):
 * generateQuestion() makes a multi-second blocking webClient.block() call; wrapping that in a
 * transaction would hold a DB connection for the duration of an LLM round trip under concurrent
 * batch load (count up to 20). Persistence is delegated to [QuestionBankPersistence], a separate
 * collaborator bean with its own short @Transactional methods — see that class for why a
 * same-class `this.method()` call wouldn't have worked.
 */
@Service
class QuestionBankService(
    private val generatedQuestionRepository: GeneratedQuestionRepository,
    private val questionGenerationService: QuestionGenerationService,
    private val persistence: QuestionBankPersistence
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val mapper = ObjectMapper()

    companion object {
        // Quality/freshness safeguard (Architect finding): cap how much of a batch can be
        // bank-sourced so high-traffic topics keep generating fresh variety instead of
        // converging on "the same handful of questions" — see plan's "Quality/freshness".
        const val MAX_BANK_FRACTION = 0.7
    }

    /**
     * Returns up to [count] questions for (topic, questionType, difficulty), bank-first.
     * May return fewer than [count] if generation of the shortfall fails for some items
     * (mirrors generateBatch's per-item error swallowing) — callers must handle a short list.
     */
    fun getQuestions(
        topic: String,
        questionType: String,
        difficulty: String,
        userId: UUID,
        count: Int
    ): List<GeneratedQuestionResponse> {
        val effectiveCount = count.coerceAtLeast(1)
        // ceil (not truncating toInt) so small/single-question requests aren't crushed to zero —
        // e.g. count=1 -> ceil(0.7)=1 (bank-first still applies to the single-question flow,
        // which is the whole point of Phase 1), count=5 -> ceil(3.5)=4, count=20 -> 14. The cap
        // still guarantees >=30% fresh generation per batch once counts grow past a couple.
        val maxFromBank = kotlin.math.ceil(effectiveCount * MAX_BANK_FRACTION).toInt().coerceAtMost(effectiveCount)

        val bankRows = if (maxFromBank > 0) {
            generatedQuestionRepository.findUnattemptedForUser(topic, questionType, difficulty, userId, maxFromBank)
        } else {
            emptyList()
        }

        if (bankRows.isNotEmpty()) {
            persistence.bumpUsage(bankRows.map { it.id })
        }

        val results = mutableListOf<GeneratedQuestionResponse>()
        results.addAll(bankRows.map { it.toResponse() })

        val shortfall = effectiveCount - results.size
        if (shortfall > 0) {
            results.addAll(generateAndPersist(topic, questionType, difficulty, userId, shortfall))
        }

        return results
    }

    /**
     * Generates [shortfall] fresh questions via Claude (non-transactionally — see class doc),
     * then persists each one individually through [persistence]. Per-item failures (generation
     * or persistence) are logged and skipped, mirroring QuestionGenerationService.generateBatch's
     * "swallow and continue" behavior so one bad item doesn't sink the whole request.
     */
    private fun generateAndPersist(
        topic: String,
        questionType: String,
        difficulty: String,
        userId: UUID,
        shortfall: Int
    ): List<GeneratedQuestionResponse> {
        val generated = mutableListOf<GeneratedQuestionResponse>()

        for (i in 0 until shortfall) {
            try {
                val response = questionGenerationService.generateQuestion(
                    topic = topic,
                    questionType = questionType,
                    difficulty = difficulty,
                    ncjmmStep = null,
                    context = null,
                    userId = userId.toString()
                )
                generated.add(persistGenerated(response))
            } catch (e: Exception) {
                logger.warn("Failed to generate/persist bank question $i for topic='$topic': ${e.message}")
            }
        }

        return generated
    }

    /**
     * Persists a freshly-generated response and returns the response rebuilt around the
     * row's REAL persisted id.
     *
     * Critical correctness detail (not spelled out in the plan): generateQuestion() stamps
     * a fresh random `id` on its response (see QuestionGenerationService ~line 278). If
     * insertIfAbsent() hits a content_hash collision, it returns null — the row that actually
     * exists in the DB has a *different* id than the one on the response we just generated.
     * Returning the generated response's id in that case would hand the frontend an id with
     * no matching generated_questions row, breaking the FK when an attempt is later submitted.
     * So: always resolve and return the persisted/existing row's real id.
     */
    private fun persistGenerated(response: GeneratedQuestionResponse): GeneratedQuestionResponse {
        val contentHash = computeContentHash(response.topic, response.type, response.stem)
        val optionsJson = mapper.writeValueAsString(response.options.map {
            mapOf("id" to it.id, "text" to it.text, "isCorrect" to it.isCorrect)
        })
        val correctAnswerJson = mapper.writeValueAsString(buildCorrectAnswer(response))

        val persistedId = persistence.insertIfAbsent(
            id = UUID.fromString(response.id),
            topic = response.topic,
            questionType = response.type,
            difficulty = response.difficulty,
            ncjmmStep = response.ncjmmStep,
            stem = response.stem,
            optionsJson = optionsJson,
            correctAnswerJson = correctAnswerJson,
            rationale = response.rationale,
            source = response.source,
            contentHash = contentHash
        )

        // null => content_hash collision; the row that exists has a different (real) id.
        val realId: UUID = if (persistedId != null) {
            persistedId
        } else {
            generatedQuestionRepository.findByContentHash(contentHash)?.id
                ?: throw IllegalStateException("insertIfAbsent returned null but no row found for content_hash=$contentHash")
        }

        return if (realId.toString() == response.id) response else response.copy(id = realId.toString())
    }

    /**
     * Shapes correct_answer as {"correctOptionIds": [...]} (+ "calculation" for dosage types),
     * mirroring how the frontend's scoreMC/scoreSATA/scoreDosage interpret options/answers —
     * so Phase 5's evaluateAnswer can directly compare request.selectedAnswer against this JSONB
     * without any further translation.
     */
    private fun buildCorrectAnswer(response: GeneratedQuestionResponse): Map<String, Any> {
        val correctOptionIds = response.options.filter { it.isCorrect }.map { it.id }
        val base = mutableMapOf<String, Any>("correctOptionIds" to correctOptionIds)
        response.calculation?.let { calc ->
            base["calculation"] = mapOf(
                "formula" to calc.formula,
                "correctAnswer" to calc.correctAnswer,
                "unit" to calc.unit,
                "tolerance" to (calc.tolerance ?: 0.0)
            )
        }
        return base
    }

    /**
     * sha256(normalized "topic|type|stem"), where normalization is a pure, fast string transform
     * (no DB/LLM calls — required, since this runs synchronously in the persistence path).
     *
     * Validation finding (Context Engineer — see plan's "validates content_hash normalization"):
     * plain lowercase+trim, as originally documented in the V8 migration comment, is NOT stable
     * enough for "the same conceptual question regenerated" to collide on `stem`. Claude's JSON
     * output varies in trivial-but-hash-breaking ways across calls even when the underlying
     * question is conceptually identical:
     *   - Smart/curly quotes vs. straight quotes ( "..."/'...' vs "..."/'...' ), and en/em dashes
     *     vs. hyphens — common in natural-language model output, invisible to a human reader,
     *     fatal to an exact-byte hash comparison
     *   - Irregular whitespace: double spaces, tabs, or embedded newlines from how the model
     *     wraps long stems, none of which `trim()` touches (it only strips the ends)
     *   - Trailing punctuation noise (e.g., a stray trailing period/space after the question
     *     mark) that varies run-to-run without changing the question's meaning
     *   - Residual markdown artifacts (e.g., stray `**`/backticks) that survive
     *     parseQuestionResponse's cleanup, which only strips ```json fences, not inline emphasis
     * Left deliberately UNCHANGED / OUT OF SCOPE: true semantic near-duplicate detection (Claude
     * paraphrasing the same scenario with different wording entirely). That needs similarity
     * infrastructure the plan explicitly defers — this function only closes the gap on
     * "byte-identical-in-substance but formatted differently," not "differently-worded but
     * conceptually the same." Don't extend this into fuzzy matching.
     */
    private fun computeContentHash(topic: String, questionType: String, stem: String): String {
        val normalized = listOf(topic, questionType, stem)
            .joinToString("|") { normalizeForHash(it) }
        val digest = MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * Lowercase + strip markdown emphasis markers + fold typographic punctuation variants
     * (smart quotes, en/em dashes) to their ASCII equivalents + collapse all whitespace runs
     * to a single space + trim trailing sentence-ending punctuation, then trim. Each step is
     * a constant-time string operation — no regex backtracking risk, no I/O.
     *
     * Bug fix (Context Engineer, second pass): the doc on this function originally *named*
     * "residual markdown artifacts (stray `**`/backticks)" as a real source of hash divergence
     * — parseQuestionResponse only strips ```json fences, never inline `**bold**`/`_italic_`/
     * `` `code` `` emphasis from the parsed stem — but the transform itself never folded them.
     * That meant the documented gap was actually live: two calls returning the conceptually
     * identical stem, one plain and one with stray emphasis markers around a drug name or
     * value (a realistic LLM-formatting variance), would hash to different rows and silently
     * duplicate the bank. Removing `*`, `_`, and `` ` `` outright (rather than pattern-matching
     * paired delimiters) keeps this a trivial O(n) char filter with no backtracking risk; NCLEX
     * stems have no legitimate clinical use for these characters, so dropping them can't
     * conflate two genuinely different questions.
     *
     * Order matters: markdown-strip and quote/dash folding must run before the trailing-
     * punctuation trim so a stem ending in a run of asterisks or a smart quote/period
     * normalizes the same as one ending in the plain ASCII equivalent; whitespace collapse
     * runs last so any spaces exposed by removing emphasis markers (e.g. emphasis markers
     * sandwiched between words collapsing to a bare separator) still collapse correctly.
     */
    private fun normalizeForHash(value: String): String {
        val lowered = value.lowercase()
        val markdownStripped = lowered
            .replace("*", "")
            .replace("_", "")
            .replace("`", "")
        val foldedQuotes = markdownStripped
            .replace('‘', '\'').replace('’', '\'')   // ‘ ’ -> '
            .replace('“', '"').replace('”', '"')      // “ ” -> "
            .replace('–', '-').replace('—', '-')      // – — -> -
        val collapsedWhitespace = foldedQuotes.replace(Regex("\\s+"), " ").trim()
        return collapsedWhitespace.trimEnd('.', '!', '?', ',', ';', ':', ' ')
    }

    private fun GeneratedQuestion.toResponse(): GeneratedQuestionResponse {
        val options = this.options.map {
            QuestionOptionDTO(
                id = (it["id"] as? String) ?: "",
                text = (it["text"] as? String) ?: "",
                isCorrect = (it["isCorrect"] as? Boolean) ?: false
            )
        }
        @Suppress("UNCHECKED_CAST")
        val calculation = (this.correctAnswer["calculation"] as? Map<String, Any>)?.let { calc ->
            CalculationDTO(
                formula = (calc["formula"] as? String) ?: "",
                correctAnswer = (calc["correctAnswer"] as? Number)?.toDouble() ?: 0.0,
                unit = (calc["unit"] as? String) ?: "",
                tolerance = (calc["tolerance"] as? Number)?.toDouble()
            )
        }
        return GeneratedQuestionResponse(
            id = this.id.toString(),
            type = this.questionType,
            stem = this.stem,
            options = options,
            rationale = this.rationale,
            ncjmmStep = this.ncjmmStep ?: "recognize_cues",
            ncjmmValidated = true,
            topic = this.topic,
            subtopic = null,
            difficulty = this.difficulty,
            source = this.source ?: "Bank",
            sourceKey = this.topic,
            partialCredit = if (this.questionType == "sata") true else null,
            calculation = calculation,
            createdAt = this.createdAt.toString()
        )
    }
}

/**
 * Separate collaborator bean for the short, per-item @Transactional persistence operations.
 *
 * Why a separate bean rather than a private @Transactional method on QuestionBankService:
 * Spring's @Transactional is proxy-based — it only intercepts calls that arrive through the
 * proxy. A same-class `this.someTransactionalMethod()` call bypasses the proxy entirely, so
 * the annotation would be silently ignored (the classic Spring self-invocation pitfall). Putting
 * these methods on a distinct bean and injecting it guarantees every call goes through the proxy
 * and actually opens/commits a transaction — and keeps each transaction short-lived (no LLM
 * calls inside it), per the plan's "Transaction boundaries" finding.
 */
@Component
class QuestionBankPersistence(
    private val generatedQuestionRepository: GeneratedQuestionRepository
) {
    @Transactional
    fun insertIfAbsent(
        id: UUID,
        topic: String,
        questionType: String,
        difficulty: String,
        ncjmmStep: String?,
        stem: String,
        optionsJson: String,
        correctAnswerJson: String,
        rationale: String,
        source: String?,
        contentHash: String
    ): UUID? = generatedQuestionRepository.insertIfAbsent(
        id = id,
        topic = topic,
        questionType = questionType,
        difficulty = difficulty,
        ncjmmStep = ncjmmStep,
        stem = stem,
        options = optionsJson,
        correctAnswer = correctAnswerJson,
        rationale = rationale,
        source = source,
        contentHash = contentHash
    )

    /**
     * DBA verification note: a single `UPDATE ... WHERE id IN (:ids)` already can't deadlock
     * against itself — Postgres acquires row locks in the scan order it chooses for *that*
     * statement (heap/index order), which is identical for every session regardless of the
     * literal order of the IN-list, so concurrent bumps over overlapping id sets always lock
     * in the same global order and simply serialize (confirmed empirically: two concurrent
     * UPDATEs over the same 4 rows in opposite IN-list orders serialized cleanly with no
     * deadlock). Sorting the ids here is therefore not load-bearing for deadlock-avoidance —
     * Postgres already guarantees it for this single-statement shape. We keep the sort anyway
     * because it's free (list is small, bounded by `count` <= 20) and makes the lock order
     * deterministic/predictable if this ever evolves into multiple statements per transaction
     * (e.g. a future per-row update path), where literal-order *would* start to matter.
     */
    @Transactional
    fun bumpUsage(ids: List<UUID>) {
        if (ids.isEmpty()) return
        generatedQuestionRepository.bumpUsage(ids.sorted(), Instant.now())
    }
}
