package com.nclex.auth

import com.nclex.audit.AuditLogger
import com.nclex.config.RateLimitService
import com.nclex.exception.RateLimitException
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.Size
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

data class RegisterRequest(
    @field:Email(message = "Invalid email format")
    val email: String,
    @field:Size(min = 8, max = 72, message = "Password must be between 8 and 72 characters")
    val password: String
)

data class LoginRequest(
    @field:Email(message = "Invalid email format")
    val email: String,
    val password: String
)

data class AuthResponse(
    val message: String,
    val email: String? = null
)

@RestController
@RequestMapping("/api/auth")
class AuthController(
    private val authService: AuthService,
    private val jwtUtil: JwtUtil,
    private val rateLimitService: RateLimitService,
    private val auditLogger: AuditLogger
) {

    @PostMapping("/register")
    fun register(
        @Valid @RequestBody request: RegisterRequest,
        httpRequest: HttpServletRequest,
        response: HttpServletResponse
    ): ResponseEntity<AuthResponse> {
        val clientIp = httpRequest.remoteAddr
        if (!rateLimitService.tryConsumeRegister(clientIp)) {
            throw RateLimitException("Registration rate limit exceeded. Try again later.")
        }

        val user = authService.register(request.email, request.password)
        val token = jwtUtil.createToken(user.id, user.email, user.role.name, user.tokenVersion)
        jwtUtil.addTokenCookie(response, token)

        auditLogger.log("USER_REGISTERED", user.id, metadata = mapOf("email" to user.email), ipAddress = clientIp)

        return ResponseEntity.ok(AuthResponse("Registration successful", user.email))
    }

    @PostMapping("/login")
    fun login(
        @Valid @RequestBody request: LoginRequest,
        httpRequest: HttpServletRequest,
        response: HttpServletResponse
    ): ResponseEntity<AuthResponse> {
        val clientIp = httpRequest.remoteAddr
        if (!rateLimitService.tryConsumeLogin(clientIp)) {
            throw RateLimitException("Login rate limit exceeded. Try again later.")
        }

        val user = authService.login(request.email, request.password)
        val token = jwtUtil.createToken(user.id, user.email, user.role.name, user.tokenVersion)
        jwtUtil.addTokenCookie(response, token)

        auditLogger.log("USER_LOGIN", user.id, metadata = mapOf("email" to user.email), ipAddress = clientIp)

        return ResponseEntity.ok(AuthResponse("Login successful", user.email))
    }

    @PostMapping("/logout")
    fun logout(response: HttpServletResponse): ResponseEntity<AuthResponse> {
        jwtUtil.clearTokenCookie(response)
        return ResponseEntity.ok(AuthResponse("Logged out successfully"))
    }

    @GetMapping("/me")
    fun me(httpRequest: HttpServletRequest): ResponseEntity<Map<String, Any?>> {
        val userId = httpRequest.getAttribute("userId") as? java.util.UUID
            ?: return ResponseEntity.ok(mapOf("authenticated" to false))
        val email = httpRequest.getAttribute("userEmail") as? String
        val role = httpRequest.getAttribute("userRole") as? String
        return ResponseEntity.ok(
            mapOf(
                "authenticated" to true,
                "userId" to userId.toString(),
                "email" to email,
                "role" to role
            )
        )
    }
}
