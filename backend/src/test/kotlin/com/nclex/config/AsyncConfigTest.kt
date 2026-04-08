package com.nclex.config

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.scheduling.annotation.EnableAsync

class AsyncConfigTest {

    @Test
    fun `AsyncConfig can be instantiated`() {
        val config = AsyncConfig()
        assertThat(config).isNotNull
    }

    @Test
    fun `AsyncConfig has EnableAsync annotation`() {
        val annotation = AsyncConfig::class.java.getAnnotation(EnableAsync::class.java)
        assertThat(annotation).isNotNull
    }
}
