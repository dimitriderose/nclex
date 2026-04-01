package com.nclex

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class NclexApplication

fun main(args: Array<String>) {
    runApplication<NclexApplication>(*args)
}
