package com.nclex

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.SpringBootApplication

class NclexApplicationTest {

    @Test
    fun `NclexApplication has SpringBootApplication annotation`() {
        val annotation = NclexApplication::class.java.getAnnotation(SpringBootApplication::class.java)
        assertThat(annotation).isNotNull
    }

    @Test
    fun `NclexApplication can be instantiated`() {
        val app = NclexApplication()
        assertThat(app).isNotNull
    }
}
