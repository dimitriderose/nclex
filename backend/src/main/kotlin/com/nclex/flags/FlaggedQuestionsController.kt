package com.nclex.flags

import com.nclex.exception.NotFoundException
import com.nclex.exception.UnauthorizedException
import com.nclex.model.FlagCategory
import com.nclex.model.FlaggedQuestion
import com.nclex.repository.FlaggedQuestionRepository
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.UUID

data class CreateFlagRequest(
    @field:NotBlank(message = "Topic is required")
    val topic: String,
    val question: Map<String, Any>,
    val category: FlagCategory,
    val notes: String? = null
)

data class UpdateFlagRequest(
    val category: FlagCategory? = null,
    val notes: String? = null
)

@RestController
@RequestMapping("/api/flags")
class FlaggedQuestionsController(
    private val flaggedQuestionRepository: FlaggedQuestionRepository
) {

    @GetMapping
    fun getFlags(
        @RequestParam(required = false) category: FlagCategory?,
        @RequestParam(required = false) topic: String?,
        request: HttpServletRequest
    ): ResponseEntity<List<FlaggedQuestion>> {
        val userId = extractUserId(request)
        val flags = when {
            category != null -> flaggedQuestionRepository.findByUserIdAndCategory(userId, category)
            topic != null -> flaggedQuestionRepository.findByUserIdAndTopic(userId, topic)
            else -> flaggedQuestionRepository.findByUserId(userId)
        }
        return ResponseEntity.ok(flags)
    }

    @PostMapping
    fun createFlag(
        @Valid @RequestBody body: CreateFlagRequest,
        request: HttpServletRequest
    ): ResponseEntity<FlaggedQuestion> {
        val userId = extractUserId(request)
        val flag = flaggedQuestionRepository.save(
            FlaggedQuestion(
                userId = userId,
                topic = body.topic,
                question = body.question,
                category = body.category,
                notes = body.notes
            )
        )
        return ResponseEntity.status(201).body(flag)
    }

    @PutMapping("/{id}")
    @Transactional
    fun updateFlag(
        @PathVariable id: UUID,
        @RequestBody body: UpdateFlagRequest,
        request: HttpServletRequest
    ): ResponseEntity<FlaggedQuestion> {
        val userId = extractUserId(request)
        val flag = flaggedQuestionRepository.findById(id)
            .filter { it.userId == userId }
            .orElseThrow { NotFoundException("Flagged question not found") }

        body.category?.let { flag.category = it }
        body.notes?.let { flag.notes = it }
        flag.updatedAt = Instant.now()

        return ResponseEntity.ok(flaggedQuestionRepository.save(flag))
    }

    @DeleteMapping("/{id}")
    @Transactional
    fun deleteFlag(
        @PathVariable id: UUID,
        request: HttpServletRequest
    ): ResponseEntity<Map<String, String>> {
        val userId = extractUserId(request)
        val deleted = flaggedQuestionRepository.deleteByIdAndUserId(id, userId)
        if (deleted == 0L) {
            throw NotFoundException("Flagged question not found")
        }
        return ResponseEntity.ok(mapOf("message" to "Deleted successfully"))
    }

    private fun extractUserId(request: HttpServletRequest): UUID {
        return request.getAttribute("userId") as? UUID
            ?: throw UnauthorizedException()
    }
}
