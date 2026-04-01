# Adding a New LLM Provider

This guide explains how to add support for a new AI provider (e.g., OpenAI, Google Gemini, Ollama) alongside the existing Claude integration.

## Architecture Overview

The question generation pipeline currently calls Claude directly through `QuestionGenerationService`. To add a new provider, you'll create a provider abstraction and a new implementation.

## Step-by-Step

### 1. Define the LLM Provider Interface

Create `backend/src/main/kotlin/com/nclex/llm/LlmProvider.kt`:

```kotlin
package com.nclex.llm

interface LlmProvider {
    val name: String

    suspend fun generateCompletion(
        systemPrompt: String,
        userMessage: String,
        maxTokens: Int = 4096
    ): LlmResponse

    suspend fun generateChat(
        messages: List<LlmMessage>,
        maxTokens: Int = 4096
    ): LlmResponse
}

data class LlmMessage(
    val role: String,    // "system", "user", "assistant"
    val content: String
)

data class LlmResponse(
    val content: String,
    val tokensUsed: Int,
    val model: String,
    val provider: String
)
```

### 2. Implement Your Provider

Create a new file, e.g., `backend/src/main/kotlin/com/nclex/llm/OpenAiProvider.kt`:

```kotlin
package com.nclex.llm

import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient

@Component
class OpenAiProvider(
    @Value("\${openai.api-key:}") private val apiKey: String
) : LlmProvider {
    override val name = "openai"

    override suspend fun generateCompletion(
        systemPrompt: String,
        userMessage: String,
        maxTokens: Int
    ): LlmResponse {
        // Your OpenAI API call here
    }

    override suspend fun generateChat(
        messages: List<LlmMessage>,
        maxTokens: Int
    ): LlmResponse {
        // Your OpenAI chat call here
    }
}
```

### 3. Add Configuration

Add your provider's env vars to `.env.example`:

```bash
# OpenAI (optional)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

### 4. Register the Provider

Create an `LlmProviderRegistry` that selects the active provider based on configuration:

```kotlin
@Component
class LlmProviderRegistry(
    private val providers: List<LlmProvider>,
    @Value("\${nclex.llm.provider:claude}") private val activeProvider: String
) {
    fun getProvider(): LlmProvider =
        providers.find { it.name == activeProvider }
            ?: throw IllegalStateException("LLM provider '$activeProvider' not found")
}
```

### 5. Update QuestionGenerationService

Replace the direct Claude WebClient call with:

```kotlin
private val provider = llmProviderRegistry.getProvider()

val response = provider.generateCompletion(
    systemPrompt = buildNclexPrompt(topic, difficulty),
    userMessage = "Generate a question..."
)
```

### 6. Test Your Provider

Make sure your provider handles:

- Rate limiting (429 responses)
- Network timeouts
- Malformed responses
- Token limit exceeded

### 7. Submit a PR

Include a note about which provider you added, any new dependencies, and how to configure it.
