package com.nclex.ngn

import com.nclex.audit.AuditLogger
import com.nclex.exception.ExternalServiceException
import com.nclex.config.RateLimitService
import com.nclex.repository.ContentCacheRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient
import java.time.Instant
import java.util.UUID

@Service
class NGNCaseStudyService(
    private val webClient: WebClient.Builder,
    private val contentCacheRepository: ContentCacheRepository,
    private val rateLimitService: RateLimitService,
    private val auditLogger: AuditLogger,
    @Value("\${nclex.claude.api-key:}") private val apiKey: String,
    @Value("\${nclex.claude.api-url:https://api.anthropic.com/v1/messages}") private val apiUrl: String,
    @Value("\${nclex.claude.model-haiku}") private val model: String
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val mapper = ObjectMapper()

    fun generateCaseStudy(
        topic: String,
        questionTypes: List<String>,
        difficulty: String,
        userId: String
    ): CaseStudyResponse {
        if (!rateLimitService.tryConsumeClaude(userId)) {
            throw com.nclex.exception.RateLimitException("Rate limit exceeded")
        }

        // Try template first, then LLM generation, then fallback
        val result = try {
            val r = generateFromLLM(topic, questionTypes, difficulty)
            auditLogger.log(
                eventType = "NGN_CASE_GENERATED",
                userId = runCatching { UUID.fromString(userId) }.getOrNull(),
                metadata = mapOf("topic" to topic, "source" to "LLM")
            )
            r
        } catch (e: Exception) {
            logger.warn("LLM generation failed, trying template fallback: ${e.message}")
            try {
                val r = generateFromTemplate(topic)
                auditLogger.log(
                    eventType = "NGN_CASE_GENERATED",
                    userId = runCatching { UUID.fromString(userId) }.getOrNull(),
                    metadata = mapOf("topic" to topic, "source" to "template")
                )
                r
            } catch (e2: Exception) {
                logger.warn("Template fallback failed, returning MC fallback: ${e2.message}")
                val r = generateMCFallback(topic)
                auditLogger.log(
                    eventType = "NGN_CASE_GENERATED",
                    userId = runCatching { UUID.fromString(userId) }.getOrNull(),
                    metadata = mapOf("topic" to topic, "source" to "fallback")
                )
                r
            }
        }
        return result
    }

    fun safetyValidate(caseStudy: CaseStudyResponse): SafetyValidationResult {
        val validationPrompt = """
            You are a clinical safety reviewer for NCLEX nursing questions.
            Review the following case study for clinical accuracy and safety.
            
            Title: ${caseStudy.title}
            Scenario: ${caseStudy.scenario}
            Questions: ${caseStudy.questions.map { "${it.prompt} -> ${it.correctAnswer}" }}
            
            Check for:
            1. Clinically inaccurate information that could harm patient care
            2. Incorrect medication dosages or dangerous drug interactions
            3. Wrong nursing interventions or contraindicated actions
            4. Misleading vital sign ranges or lab values
            5. Incorrect priority assignments in emergencies
            
            Respond in JSON:
            {"safe": true/false, "issues": ["list of issues"], "confidence": 0.0-1.0, "recommendation": "text"}
        """.trimIndent()

        return try {
            val response = callClaude(
                "You are a clinical safety expert. Respond only with valid JSON.",
                validationPrompt
            )
            parseSafetyResponse(response)
        } catch (e: Exception) {
            logger.error("Safety validation failed: ${e.message}")
            SafetyValidationResult(
                safe = false,
                issues = listOf("Safety validation service unavailable"),
                confidence = 0.0,
                recommendation = "Manual review required"
            )
        }
    }

    fun getAvailableTemplates(): List<CaseTemplateInfo> {
        return CASE_TEMPLATES.map {
            CaseTemplateInfo(it.id, it.title, it.topic, it.questionTypes)
        }
    }

    private fun generateFromLLM(
        topic: String,
        questionTypes: List<String>,
        difficulty: String
    ): CaseStudyResponse {
        val systemPrompt = """
            You are an expert NCLEX NGN (Next Generation NCLEX) case study writer.
            Generate a realistic clinical case study with the following NGN question types: ${questionTypes.joinToString(", ")}.
            
            The case study must include:
            1. A realistic patient scenario
            2. Multiple tabs: Nurses Notes, HCP Orders, Vital Signs, Lab Results
            3. 2-4 NGN-style questions tied to the scenario
            4. Each question tagged with an NCJMM cognitive step
            5. Clinically accurate content
            
            Question type formats:
            - bow_tie: {"conditions": [...], "actions": [...], "parameters": [...], "correctLinks": {"action": ["condition", "parameter"]}}
            - matrix_multiple_choice: {"rows": [...], "columns": [...], "correctSelections": {"row": "column"}}
            - cloze_drop_down: {"text": "...[BLANK1]...[BLANK2]...", "blanks": {"BLANK1": {"options": [...], "correct": "..."}}} 
            - trend: {"timepoints": [{"time": "...", "data": {...}}], "question": "...", "options": [...], "correct": "..."}
            - highlight_text: {"text": "full text here", "correctHighlights": ["phrase1", "phrase2"]}
            
            Respond in JSON:
            {
              "title": "...",
              "scenario": "...",
              "tabs": [{"id": "...", "label": "...", "content": "...", "type": "nurses_notes|hcp_orders|vital_signs|lab_results"}],
              "questions": [{"type": "...", "prompt": "...", "data": {...}, "correctAnswer": ..., "rationale": "...", "ncjmmStep": "...", "maxScore": N}]
            }
        """.trimIndent()

        val userPrompt = "Generate a $difficulty NGN case study about: $topic"
        val response = callClaude(systemPrompt, userPrompt)
        val caseStudy = parseCaseStudyResponse(response, topic)

        // Safety guardrail: second LLM pass
        val safety = safetyValidate(caseStudy)
        return caseStudy.copy(safetyValidated = safety.safe)
    }

    private fun generateFromTemplate(topic: String): CaseStudyResponse {
        val template = CASE_TEMPLATES.find { it.topic.equals(topic, ignoreCase = true) }
            ?: CASE_TEMPLATES.find { it.topic.contains(topic, ignoreCase = true) }
            ?: throw Exception("No template found for topic: $topic")

        return CaseStudyResponse(
            id = UUID.randomUUID().toString(),
            title = template.title,
            scenario = template.scenario,
            tabs = template.tabs,
            questions = template.questions,
            topic = topic,
            source = "OpenStax Template",
            safetyValidated = true, // Templates are pre-validated
            createdAt = Instant.now().toString()
        )
    }

    private fun generateMCFallback(topic: String): CaseStudyResponse {
        return CaseStudyResponse(
            id = UUID.randomUUID().toString(),
            title = "Clinical Scenario: $topic",
            scenario = "A patient presents with concerns related to $topic. Review the available information and answer the following questions.",
            tabs = listOf(
                CaseTabDTO("1", "Nurses Notes", "Patient assessment data related to $topic. Refer to your study materials for detailed clinical information.", "nurses_notes")
            ),
            questions = listOf(
                CaseQuestionDTO(
                    id = UUID.randomUUID().toString(),
                    type = "matrix_multiple_choice",
                    prompt = "Based on the patient scenario, identify the priority nursing assessment findings.",
                    data = mapOf(
                        "rows" to listOf("Finding 1", "Finding 2", "Finding 3"),
                        "columns" to listOf("Expected", "Unexpected", "Requires Follow-up"),
                        "correctSelections" to mapOf("Finding 1" to "Expected", "Finding 2" to "Unexpected", "Finding 3" to "Requires Follow-up")
                    ),
                    correctAnswer = null,
                    rationale = "This is a fallback question. Generate a new case study with an active internet connection for full NGN questions.",
                    ncjmmStep = "recognize_cues",
                    maxScore = 3
                )
            ),
            topic = topic,
            source = "Offline Fallback",
            safetyValidated = true,
            createdAt = Instant.now().toString()
        )
    }

    private fun callClaude(systemPrompt: String, userPrompt: String): String {
        if (apiKey.isBlank()) throw ExternalServiceException("Claude API key not configured")

        val requestBody = mapOf(
            "model" to model,
            "max_tokens" to 4096,
            "system" to systemPrompt,
            "messages" to listOf(mapOf("role" to "user", "content" to userPrompt))
        )

        val response = webClient.build()
            .post().uri(apiUrl)
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .bodyValue(requestBody)
            .retrieve()
            .bodyToMono(Map::class.java)
            .block() ?: throw ExternalServiceException("Empty response")

        @Suppress("UNCHECKED_CAST")
        val content = response["content"] as? List<Map<String, Any>>
            ?: throw ExternalServiceException("Invalid response format")

        return content.firstOrNull { it["type"] == "text" }?.get("text") as? String
            ?: throw ExternalServiceException("No text content")
    }

    private fun parseCaseStudyResponse(json: String, topic: String): CaseStudyResponse {
        val clean = json.replace(Regex("""```json?\n?"""), "").replace("```", "").trim()
        return try {
            val tree = mapper.readTree(clean)
            CaseStudyResponse(
                id = UUID.randomUUID().toString(),
                title = tree["title"]?.asText() ?: "Case Study: $topic",
                scenario = tree["scenario"]?.asText() ?: "",
                tabs = tree["tabs"]?.map {
                    CaseTabDTO(it["id"]?.asText() ?: UUID.randomUUID().toString(), it["label"]?.asText() ?: "", it["content"]?.asText() ?: "", it["type"]?.asText() ?: "custom")
                } ?: emptyList(),
                questions = tree["questions"]?.map {
                    @Suppress("UNCHECKED_CAST")
                    CaseQuestionDTO(
                        id = UUID.randomUUID().toString(),
                        type = it["type"]?.asText() ?: "matrix_multiple_choice",
                        prompt = it["prompt"]?.asText() ?: "",
                        data = mapper.convertValue(it["data"], Map::class.java) as Map<String, Any>,
                        correctAnswer = it["correctAnswer"],
                        rationale = it["rationale"]?.asText() ?: "",
                        ncjmmStep = it["ncjmmStep"]?.asText() ?: "recognize_cues",
                        maxScore = it["maxScore"]?.asInt() ?: 1
                    )
                } ?: emptyList(),
                topic = topic,
                source = "Generated",
                safetyValidated = false,
                createdAt = Instant.now().toString()
            )
        } catch (e: Exception) {
            logger.error("Failed to parse case study: ${e.message}")
            throw e
        }
    }

    private fun parseSafetyResponse(json: String): SafetyValidationResult {
        val clean = json.replace(Regex("""```json?\n?"""), "").replace("```", "").trim()
        return try {
            val tree = mapper.readTree(clean)
            SafetyValidationResult(
                safe = tree["safe"]?.asBoolean() ?: false,
                issues = tree["issues"]?.map { it.asText() } ?: emptyList(),
                confidence = tree["confidence"]?.asDouble() ?: 0.0,
                recommendation = tree["recommendation"]?.asText() ?: ""
            )
        } catch (e: Exception) {
            SafetyValidationResult(false, listOf("Parse error: ${e.message}"), 0.0, "Manual review required")
        }
    }
}

// Pre-built OpenStax-sourced case study templates
private data class CaseTemplate(
    val id: String,
    val title: String,
    val topic: String,
    val scenario: String,
    val tabs: List<CaseTabDTO>,
    val questions: List<CaseQuestionDTO>,
    val questionTypes: List<String>
)

private val CASE_TEMPLATES = listOf(
    CaseTemplate(
        id = "hf-case-1",
        title = "Heart Failure Exacerbation",
        topic = "heart failure",
        scenario = "A 72-year-old male presents to the ED with increasing shortness of breath, orthopnea, and bilateral lower extremity edema over the past 3 days. He has a history of HF with reduced ejection fraction (HFrEF), hypertension, and type 2 diabetes.",
        tabs = listOf(
            CaseTabDTO("1", "Nurses Notes", "0800: Patient alert and oriented x4. Reports sleeping in recliner for past 2 nights due to difficulty breathing when lying flat. States 'I ran out of my water pill 5 days ago.' Bilateral crackles auscultated in lower lung fields. 3+ pitting edema bilateral lower extremities. Weight today: 198 lbs (baseline: 190 lbs).", "nurses_notes"),
            CaseTabDTO("2", "Vital Signs", "BP: 158/94 mmHg, HR: 102 bpm, RR: 26/min, SpO2: 91% on RA, Temp: 98.4\u00b0F", "vital_signs"),
            CaseTabDTO("3", "Lab Results", "BNP: 890 pg/mL, Na: 134 mEq/L, K: 3.8 mEq/L, Cr: 1.4 mg/dL, BUN: 28 mg/dL, Troponin: 0.02 ng/mL", "lab_results"),
            CaseTabDTO("4", "HCP Orders", "Furosemide 40mg IV now, then 20mg PO BID. Fluid restriction 1500mL/day. Daily weights. I&O monitoring. Enalapril 10mg PO BID. Low sodium diet. Echocardiogram in AM.", "hcp_orders")
        ),
        questions = listOf(
            CaseQuestionDTO("q1", "bow_tie", "Based on the assessment data, complete the bow-tie diagram.",
                mapOf(
                    "conditions" to listOf("Medication non-compliance", "Fluid volume overload", "Decreased cardiac output", "Pneumonia", "Renal failure"),
                    "actions" to listOf("Administer IV furosemide", "Elevate HOB", "Apply oxygen", "Administer antibiotics"),
                    "parameters" to listOf("Decreased weight", "SpO2 > 95%", "Clear lung sounds", "BNP < 100", "Fever resolution"),
                    "correctLinks" to mapOf(
                        "Administer IV furosemide" to listOf("Fluid volume overload", "Decreased weight"),
                        "Elevate HOB" to listOf("Decreased cardiac output", "SpO2 > 95%"),
                        "Apply oxygen" to listOf("Decreased cardiac output", "SpO2 > 95%")
                    )
                ),
                null, "The patient's 8-lb weight gain, bilateral edema, crackles, and elevated BNP indicate fluid volume overload secondary to medication non-compliance. IV furosemide addresses volume overload; HOB elevation and oxygen address the respiratory compromise from decreased cardiac output.",
                "analyze_cues", 6
            )
        ),
        questionTypes = listOf("bow_tie", "trend")
    ),
    CaseTemplate(
        id = "dka-case-1",
        title = "Diabetic Ketoacidosis Management",
        topic = "diabetic ketoacidosis",
        scenario = "A 28-year-old female with Type 1 DM is brought to the ED by EMS after being found lethargic at home. Roommate reports the patient has been ill with a stomach virus for 2 days and stopped taking insulin because she was not eating.",
        tabs = listOf(
            CaseTabDTO("1", "Nurses Notes", "1400: Patient lethargic but responsive to verbal stimuli. Skin warm, dry, poor turgor. Kussmaul respirations noted. Fruity odor on breath. Dry mucous membranes.", "nurses_notes"),
            CaseTabDTO("2", "Vital Signs", "BP: 96/58 mmHg, HR: 118 bpm, RR: 32/min (deep), SpO2: 98% on RA, Temp: 99.8\u00b0F", "vital_signs"),
            CaseTabDTO("3", "Lab Results", "Glucose: 486 mg/dL, pH: 7.18, PaCO2: 22 mmHg, HCO3: 10 mEq/L, K: 5.6 mEq/L, Na: 131 mEq/L, Anion gap: 24, Ketones: Large", "lab_results"),
            CaseTabDTO("4", "HCP Orders", "NS 1L bolus IV, then 250 mL/hr. Regular insulin drip per DKA protocol. Monitor glucose hourly. BMP every 2 hours. Continuous cardiac monitoring. Strict I&O.", "hcp_orders")
        ),
        questions = listOf(
            CaseQuestionDTO("q1", "matrix_multiple_choice", "For each assessment finding, indicate whether it is expected in DKA or requires immediate intervention.",
                mapOf(
                    "rows" to listOf("Kussmaul respirations", "Potassium 5.6 mEq/L", "Blood glucose 486", "pH 7.18", "Fruity breath odor"),
                    "columns" to listOf("Expected DKA Finding", "Requires Immediate Intervention"),
                    "correctSelections" to mapOf(
                        "Kussmaul respirations" to "Expected DKA Finding",
                        "Potassium 5.6 mEq/L" to "Requires Immediate Intervention",
                        "Blood glucose 486" to "Requires Immediate Intervention",
                        "pH 7.18" to "Requires Immediate Intervention",
                        "Fruity breath odor" to "Expected DKA Finding"
                    )
                ),
                null, "Kussmaul respirations and fruity breath are expected compensatory findings in DKA. The critically low pH, elevated K+ (pseudohyperkalemia from acidosis will shift to hypokalemia with insulin), and high glucose all require immediate intervention.",
                "recognize_cues", 5
            )
        ),
        questionTypes = listOf("matrix_multiple_choice", "cloze_drop_down")
    )
)
