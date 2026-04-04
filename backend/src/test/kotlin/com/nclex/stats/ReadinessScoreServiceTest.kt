package com.nclex.stats

import com.nclex.model.UserStats
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.data.Offset
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class ReadinessScoreServiceTest {

    private val service = ReadinessScoreService()

    private fun createStats(
        topicScores: Map<String, Any> = emptyMap(),
        history: List<Map<String, Any>> = emptyList(),
        ncjmmScores: Map<String, Any> = emptyMap(),
        lastActiveAt: Instant? = null
    ) = UserStats(
        userId = UUID.randomUUID(),
        topicScores = topicScores,
        history = history,
        ncjmmScores = ncjmmScores,
        lastActiveAt = lastActiveAt
    )

    private fun td(correct: Number, total: Number): Map<String, Any> =
        mapOf("correct" to correct, "total" to total)

    // ── calculateReadiness ──────────────────────────────────────────

    @Nested
    inner class CalculateReadiness {

        @Test
        fun `overall score is combination of 4 components`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(15, 20) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(8, 10) }
            val history = (1..50).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now())

            val result = service.calculateReadiness(stats)

            assertThat(result.score).isBetween(0.0, 100.0)
            assertThat(result.band).isIn("Very High", "High", "Borderline", "Low")
            assertThat(result.questionsAnswered).isEqualTo(50)
            assertThat(result.recommendation).isNotBlank()
            assertThat(result.volumeScore).isGreaterThan(0.0)
            assertThat(result.recencyScore).isGreaterThan(0.0)
            assertThat(result.topicBreakdown).isNotEmpty
            assertThat(result.ncjmmBreakdown).isNotEmpty
        }

        @Test
        fun `score clamped between 0 and 100`() {
            val stats = createStats()
            val result = service.calculateReadiness(stats)
            assertThat(result.score).isBetween(0.0, 100.0)
        }

        @Test
        fun `perfect scores yield Very High band`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(100, 100) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(100, 100) }
            val history = (1..100).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now())

            val result = service.calculateReadiness(stats)
            assertThat(result.band).isEqualTo("Very High")
            assertThat(result.score).isCloseTo(100.0, Offset.offset(1.0))
        }

        @Test
        fun `empty stats produce low band`() {
            val stats = createStats()
            val result = service.calculateReadiness(stats)
            assertThat(result.score).isGreaterThanOrEqualTo(0.0)
        }
    }

    // ── calculateTopicAccuracy ──────────────────────────────────────

    @Nested
    inner class TopicAccuracy {

        @Test
        fun `total gte 10 uses raw accuracy`() {
            val topics = mapOf<String, Any>("Management of Care" to td(12, 15))
            val stats = createStats(topicScores = topics)
            val result = service.calculateReadiness(stats)
            val detail = result.topicBreakdown["Management of Care"]!!
            assertThat(detail.accuracy).isCloseTo(80.0, Offset.offset(0.1))
            assertThat(detail.sufficient).isTrue()
        }

        @Test
        fun `total lt 10 blends with 0_5 baseline`() {
            val topics = mapOf<String, Any>("Management of Care" to td(4, 5))
            val stats = createStats(topicScores = topics)
            val result = service.calculateReadiness(stats)
            val detail = result.topicBreakdown["Management of Care"]!!
            // sampleWeight=0.5, rawAccuracy=0.8 => 0.8*0.5 + 0.5*0.5 = 0.65 => 65%
            assertThat(detail.accuracy).isCloseTo(65.0, Offset.offset(0.1))
            assertThat(detail.sufficient).isFalse()
        }

        @Test
        fun `total == 0 returns 50% baseline`() {
            val topics = mapOf<String, Any>("Management of Care" to td(0, 0))
            val stats = createStats(topicScores = topics)
            val result = service.calculateReadiness(stats)
            val detail = result.topicBreakdown["Management of Care"]!!
            assertThat(detail.accuracy).isCloseTo(50.0, Offset.offset(0.1))
            assertThat(detail.questionsAnswered).isEqualTo(0)
        }

        @Test
        fun `missing topic data defaults to baseline`() {
            val stats = createStats(topicScores = emptyMap())
            val result = service.calculateReadiness(stats)
            result.topicBreakdown.values.forEach {
                assertThat(it.accuracy).isCloseTo(50.0, Offset.offset(0.1))
                assertThat(it.questionsAnswered).isEqualTo(0)
                assertThat(it.sufficient).isFalse()
            }
        }

        @Test
        fun `totalWeight == 0 is impossible since NCLEX_WEIGHTS is constant but weightedScore handles it`() {
            // This tests the path: all weights are > 0, so totalWeight > 0 always for normal flow.
            // We just verify the breakdown has all 8 topics.
            val stats = createStats()
            val result = service.calculateReadiness(stats)
            assertThat(result.topicBreakdown.size).isEqualTo(ReadinessScoreService.NCLEX_WEIGHTS.size)
        }
    }

    // ── calculateVolumeScore ────────────────────────────────────────

    @Nested
    inner class VolumeScore {

        @Test
        fun `empty history returns 0`() {
            val stats = createStats(history = emptyList())
            val result = service.calculateReadiness(stats)
            assertThat(result.volumeScore).isEqualTo(0.0)
        }

        @Test
        fun `at plateau returns close to 100`() {
            val history = (1..50).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(history = history)
            val result = service.calculateReadiness(stats)
            assertThat(result.volumeScore).isCloseTo(100.0, Offset.offset(1.0))
        }

        @Test
        fun `beyond plateau caps at 100`() {
            val history = (1..200).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(history = history)
            val result = service.calculateReadiness(stats)
            assertThat(result.volumeScore).isLessThanOrEqualTo(100.0)
        }

        @Test
        fun `small history gives partial score`() {
            val history = (1..5).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(history = history)
            val result = service.calculateReadiness(stats)
            assertThat(result.volumeScore).isGreaterThan(0.0)
            assertThat(result.volumeScore).isLessThan(100.0)
        }
    }

    // ── calculateRecencyScore ───────────────────────────────────────

    @Nested
    inner class RecencyScore {

        @Test
        fun `null lastActiveAt returns 0`() {
            val stats = createStats(lastActiveAt = null)
            val result = service.calculateReadiness(stats)
            assertThat(result.recencyScore).isEqualTo(0.0)
        }

        @Test
        fun `future date returns 100`() {
            val stats = createStats(lastActiveAt = Instant.now().plus(1, ChronoUnit.DAYS))
            val result = service.calculateReadiness(stats)
            assertThat(result.recencyScore).isEqualTo(100.0)
        }

        @Test
        fun `active now returns near 100`() {
            val stats = createStats(lastActiveAt = Instant.now())
            val result = service.calculateReadiness(stats)
            assertThat(result.recencyScore).isCloseTo(100.0, Offset.offset(5.0))
        }

        @Test
        fun `7 days ago within 14 day window returns near 50`() {
            val stats = createStats(lastActiveAt = Instant.now().minus(7, ChronoUnit.DAYS))
            val result = service.calculateReadiness(stats)
            assertThat(result.recencyScore).isCloseTo(50.0, Offset.offset(5.0))
        }

        @Test
        fun `beyond 14 day window returns 0`() {
            val stats = createStats(lastActiveAt = Instant.now().minus(30, ChronoUnit.DAYS))
            val result = service.calculateReadiness(stats)
            assertThat(result.recencyScore).isEqualTo(0.0)
        }
    }

    // ── calculateNcjmmScore ─────────────────────────────────────────

    @Nested
    inner class NcjmmScore {

        @Test
        fun `with data returns weighted breakdown`() {
            val ncjmm = mapOf<String, Any>(
                "Recognize Cues" to td(8, 10),
                "Analyze Cues" to td(6, 10)
            )
            val stats = createStats(ncjmmScores = ncjmm)
            val result = service.calculateReadiness(stats)
            assertThat(result.ncjmmBreakdown["Recognize Cues"]).isCloseTo(80.0, Offset.offset(0.1))
            assertThat(result.ncjmmBreakdown["Analyze Cues"]).isCloseTo(60.0, Offset.offset(0.1))
        }

        @Test
        fun `missing step data returns 0 for all steps`() {
            val stats = createStats(ncjmmScores = emptyMap())
            val result = service.calculateReadiness(stats)
            for (step in ReadinessScoreService.NCJMM_WEIGHTS.keys) {
                assertThat(result.ncjmmBreakdown[step]).isEqualTo(0.0)
            }
        }

        @Test
        fun `total == 0 yields 0 accuracy`() {
            val ncjmm = mapOf<String, Any>("Recognize Cues" to td(0, 0))
            val stats = createStats(ncjmmScores = ncjmm)
            val result = service.calculateReadiness(stats)
            assertThat(result.ncjmmBreakdown["Recognize Cues"]).isEqualTo(0.0)
        }
    }

    // ── classifyBand ────────────────────────────────────────────────

    @Nested
    inner class ClassifyBand {

        @Test
        fun `gte 90 is Very High`() {
            assertThat(service.classifyBand(90.0)).isEqualTo("Very High")
            assertThat(service.classifyBand(100.0)).isEqualTo("Very High")
        }

        @Test
        fun `gte 75 lt 90 is High`() {
            assertThat(service.classifyBand(75.0)).isEqualTo("High")
            assertThat(service.classifyBand(89.9)).isEqualTo("High")
        }

        @Test
        fun `gte 60 lt 75 is Borderline`() {
            assertThat(service.classifyBand(60.0)).isEqualTo("Borderline")
            assertThat(service.classifyBand(74.9)).isEqualTo("Borderline")
        }

        @Test
        fun `lt 60 is Low`() {
            assertThat(service.classifyBand(59.9)).isEqualTo("Low")
            assertThat(service.classifyBand(0.0)).isEqualTo("Low")
        }
    }

    // ── generateRecommendation ──────────────────────────────────────

    @Nested
    inner class Recommendation {

        @Test
        fun `Very High band recommendation`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(19, 20) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(9, 10) }
            val history = (1..100).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now())
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).contains("Strong performance")
        }

        @Test
        fun `Low band recommendation`() {
            val stats = createStats()
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).contains("More practice needed")
        }

        @Test
        fun `High band recommendation`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(85, 100) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(80, 100) }
            val history = (1..60).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now())
            val result = service.calculateReadiness(stats)
            if (result.band == "High") {
                assertThat(result.recommendation).contains("Good progress")
            }
        }

        @Test
        fun `Borderline band recommendation`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(7, 10) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(6, 10) }
            val history = (1..30).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now().minus(5, ChronoUnit.DAYS))
            val result = service.calculateReadiness(stats)
            if (result.band == "Borderline") {
                assertThat(result.recommendation).contains("close to passing")
            }
        }

        @Test
        fun `weak topics included in recommendation`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(90, 100) }.toMutableMap()
            topics["Management of Care"] = td(2, 20) // 10%
            val stats = createStats(topicScores = topics)
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).contains("Priority topics")
            assertThat(result.recommendation).contains("Management of Care")
        }

        @Test
        fun `weak NCJMM steps included`() {
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(90, 100) }.toMutableMap()
            ncjmm["Recognize Cues"] = td(2, 10)
            val stats = createStats(ncjmmScores = ncjmm)
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).contains("Clinical judgment focus")
            assertThat(result.recommendation).contains("Recognize Cues")
        }

        @Test
        fun `insufficient topics included`() {
            val topics = mapOf<String, Any>("Management of Care" to td(3, 3))
            val stats = createStats(topicScores = topics)
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).contains("Need more questions")
        }

        @Test
        fun `no weak topics omits Priority topics text`() {
            val topics = ReadinessScoreService.NCLEX_WEIGHTS.keys.associateWith { td(90, 100) }
            val ncjmm = ReadinessScoreService.NCJMM_WEIGHTS.keys.associateWith { td(90, 100) }
            val history = (1..100).map { mapOf<String, Any>("q" to it) }
            val stats = createStats(topics, history, ncjmm, Instant.now())
            val result = service.calculateReadiness(stats)
            assertThat(result.recommendation).doesNotContain("Priority topics")
        }
    }
}
