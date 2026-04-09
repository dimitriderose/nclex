package com.nclex.config

import com.nclex.auth.JwtCookieFilter
import io.mockk.mockk
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.web.cors.UrlBasedCorsConfigurationSource

class SecurityConfigTest {

    private val jwtCookieFilter: JwtCookieFilter = mockk()
    private val config = SecurityConfig(jwtCookieFilter, "http://localhost:3000,http://localhost:5173")

    @Test
    fun `passwordEncoder returns BCryptPasswordEncoder`() {
        val encoder = config.passwordEncoder()
        assertThat(encoder).isInstanceOf(BCryptPasswordEncoder::class.java)

        // Verify it works
        val encoded = encoder.encode("testPassword")
        assertThat(encoder.matches("testPassword", encoded)).isTrue()
        assertThat(encoder.matches("wrongPassword", encoded)).isFalse()
    }

    @Test
    fun `corsConfigurationSource returns UrlBasedCorsConfigurationSource`() {
        val source = config.corsConfigurationSource()
        assertThat(source).isInstanceOf(UrlBasedCorsConfigurationSource::class.java)
    }

    @Test
    fun `CORS config has correct allowed origins`() {
        val source = config.corsConfigurationSource() as UrlBasedCorsConfigurationSource
        val corsConfig = source.corsConfigurations["/**"]!!

        assertThat(corsConfig.allowedOrigins).containsExactly("http://localhost:3000", "http://localhost:5173")
        assertThat(corsConfig.allowCredentials).isTrue()
        assertThat(corsConfig.allowedMethods).containsAll(listOf("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"))
        assertThat(corsConfig.allowedHeaders).containsExactlyInAnyOrder("Content-Type", "Authorization", "X-Requested-With")
        assertThat(corsConfig.maxAge).isEqualTo(3600)
    }

    @Test
    fun `CORS config handles single origin`() {
        val singleOriginConfig = SecurityConfig(jwtCookieFilter, "https://app.example.com")
        val source = singleOriginConfig.corsConfigurationSource() as UrlBasedCorsConfigurationSource
        val corsConfig = source.corsConfigurations["/**"]!!

        assertThat(corsConfig.allowedOrigins).containsExactly("https://app.example.com")
    }

    @Test
    fun `CORS config trims whitespace from origins`() {
        val spacedConfig = SecurityConfig(jwtCookieFilter, " http://a.com , http://b.com ")
        val source = spacedConfig.corsConfigurationSource() as UrlBasedCorsConfigurationSource
        val corsConfig = source.corsConfigurations["/**"]!!

        assertThat(corsConfig.allowedOrigins).containsExactly("http://a.com", "http://b.com")
    }
}
