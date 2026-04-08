# NCLEX Trainer v5 — Error Handling Strategy
**Author:** SA (Ravi S.)  
**Version:** 1.1  
**Date:** March 2026  
**Related:** NCLEX_Trainer_v5_TDD.md §12, §13.1

---

## 1. Overview

This document defines the error handling specification for NCLEX Trainer v5. It covers the backend error hierarchy, HTTP response contract, frontend error boundaries, user-facing messages, retry logic, and offline error handling.

**Design principles:**
1. **Never expose internals** — stack traces, SQL errors, and internal class names never reach the client
2. **Fail gracefully** — a failed question generation falls back; a failed stat sync queues for retry; a failed voice call shows a clear message
3. **Log everything, show nothing** — full error detail goes to logs; users see plain English
4. **Errors must not lose data** — stat updates, flags, and sync queue operations are retried; never silently dropped

---

## 2. Backend Error Hierarchy

```kotlin
// Base sealed hierarchy — all application exceptions extend this
sealed class NclexException(message: String, val httpStatus: Int) : RuntimeException(message)

// 400 — client sent bad data
class ValidationException(message: String) : NclexException(message, 400)
class BadRequestException(message: String) : NclexException(message, 400)

// 401 — not authenticated
class UnauthorizedException(message: String = "Authentication required")
    : NclexException(message, 401)

// 403 — authenticated but not permitted
class ForbiddenException(message: String = "Access denied")
    : NclexException(message, 403)

// 404 — resource not found
class NotFoundException(message: String) : NclexException(message, 404)

// 409 — conflict (e.g. duplicate registration, wrong state)
class ConflictException(message: String) : NclexException(message, 409)

// 410 — gone (e.g. deletion grace period expired)
class GoneException(message: String) : NclexException(message, 410)

// 429 — rate limited (Bucket4j throws this; we map to standard response)
class RateLimitException(val retryAfterSeconds: Long) : NclexException("Rate limit exceeded", 429)

// 503 — external dependency unavailable (FDA API, Claude API)
class ExternalServiceException(val service: String, cause: Throwable)
    : NclexException("External service unavailable: $service", 503)
```

---

## 3. Global Exception Handler

A single `@RestControllerAdvice` maps all exceptions to a consistent JSON response shape. No controller should have try/catch blocks for NclexExceptions — all fall through to this handler.

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler(private val log: Logger = LoggerFactory.getLogger(GlobalExceptionHandler::class.java)) {

    data class ErrorResponse(
        val error: String,
        val message: String,
        val requestId: String? = MDC.get("requestId")
    )

    @ExceptionHandler(NclexException::class)
    fun handleNclex(ex: NclexException, request: HttpServletRequest): ResponseEntity<ErrorResponse> {
        // WARN for 4xx (client errors), ERROR for 5xx (server errors)
        if (ex.httpStatus >= 500) {
            log.error("event=SERVER_ERROR status={} path={} error={}", ex.httpStatus,
                request.requestURI, ex.message, ex)
        } else {
            log.warn("event=CLIENT_ERROR status={} path={} error={}", ex.httpStatus,
                request.requestURI, ex.message)
        }

        return ResponseEntity.status(ex.httpStatus).body(
            ErrorResponse(
                error = ex::class.simpleName ?: "Error",
                message = sanitizeMessage(ex.message ?: "An error occurred")
            )
        )
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<ErrorResponse> {
        // Bean Validation failures — collect field errors into readable message
        val fieldErrors = ex.bindingResult.fieldErrors
            .joinToString("; ") { "${it.field}: ${it.defaultMessage}" }
        log.warn("event=VALIDATION_FAILED errors={}", fieldErrors)
        return ResponseEntity.badRequest().body(
            ErrorResponse(error = "ValidationException", message = fieldErrors)
        )
    }

    @ExceptionHandler(RateLimitException::class)
    fun handleRateLimit(ex: RateLimitException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(429)
            .header("Retry-After", ex.retryAfterSeconds.toString())
            .header("X-RateLimit-Remaining", "0")
            .body(ErrorResponse(error = "RateLimitException",
                                message = "Too many requests. Please wait ${ex.retryAfterSeconds}s."))
    }

    // EH-1: PostgreSQL constraint violations expose table/column names in their message.
    // Catch before the generic handler — return safe generic message.
    // e.g. "duplicate key value violates unique constraint \"users_email_key\""
    //       → never reaches client; logged internally with full detail.
    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleDbIntegrity(ex: DataIntegrityViolationException): ResponseEntity<ErrorResponse> {
        log.warn("event=DB_INTEGRITY_VIOLATION error={}", ex.message)
        return ResponseEntity.status(409).body(
            ErrorResponse(error = "ConflictException",
                          message = "This operation could not be completed. Please try again.")
        )
    }

    @ExceptionHandler(Exception::class)
    fun handleUnexpected(ex: Exception, request: HttpServletRequest): ResponseEntity<ErrorResponse> {
        log.error("event=UNEXPECTED_ERROR path={}", request.requestURI, ex)
        return ResponseEntity.internalServerError().body(
            ErrorResponse(error = "InternalServerError",
                          message = "Something went wrong. Please try again.")
        )
    }

    // Strip any internal class names, SQL fragments, or stack info that might
    // have leaked into exception messages before sending to client
    // EH-4: Three sanitization rules:
    // 1. Strip Java package names (leaks class hierarchy to client)
    // 2. Strip PostgreSQL 'at line N' fragments (leaks schema info)
    // 3. Hard-cap at 500 chars (prevents enormous nested exception chains reaching client)
    // Note: DataIntegrityViolationException is caught above — sanitizeMessage
    //       never sees raw PostgreSQL constraint violation text.
    private fun sanitizeMessage(msg: String): String =
        msg.replace(Regex("(?:org\\.|com\\.|net\\.|io\\.)[a-zA-Z.]+"), "[internal]")
           .replace(Regex("at line \\d+"), "")
           .take(500)  // hard cap — never send enormous messages to client
}
```

**Standard error response shape (all errors):**
```json
{
  "error": "ValidationException",
  "message": "topicScores: size must be between 0 and 50",
  "requestId": "req-a1b2c3"
}
```
The `requestId` lets the admin correlate a client-reported error to a specific log line in Railway.

---

## 4. External Service Error Handling

### 4.1 Claude API Errors

```kotlin
// ClaudeProxyController — handles Anthropic API failures
suspend fun proxy(request: ClaudeRequest, userId: UUID): ResponseEntity<String> {
    return try {
        val response = webClient.post()
            .uri("https://api.anthropic.com/v1/messages")
            // ...
            .retrieve()
            .onStatus(HttpStatusCode::is4xxClientError) { clientResponse ->
                clientResponse.bodyToMono(String::class.java).map { body ->
                    throw ValidationException("Claude API rejected request: ${body.take(200)}")
                }
            }
            .onStatus(HttpStatusCode::is5xxServerError) { _ ->
                throw ExternalServiceException("Claude API",
                    RuntimeException("Anthropic returned 5xx"))
            }
            .bodyToMono(String::class.java)
            .timeout(Duration.ofSeconds(30))
            .awaitSingle()
        ResponseEntity.ok(response)

    } catch (ex: TimeoutException) {
        log.warn("event=CLAUDE_TIMEOUT userId={} context={}", userId, request.context)
        throw ExternalServiceException("Claude API", ex)  // → 503

    } catch (ex: ExternalServiceException) {
        throw ex  // re-throw — caught by GlobalExceptionHandler → 503

    } catch (ex: Exception) {
        log.error("event=CLAUDE_UNEXPECTED_ERROR userId={}", userId, ex)
        throw ExternalServiceException("Claude API", ex)
    }
}
```

**Frontend handling of Claude 503:**
```javascript
// question generator — graceful fallback
async function generateQuestion(mode, topic) {
    try {
        const res = await authedFetch('/api/claude', {
            method: 'POST',
            body: JSON.stringify({ messages: [...], context: 'question_gen' })
        });
        if (res.status === 503) {
            // EH-5: calls getNextOfflineBankQuestion(mode, topic) from TDD §9.8.4
        //        — serves from pre-generated 100-question bank, never a hardcoded stub.
        return FALLBACK_OFFLINE_QUESTION(mode, topic);  // → getNextOfflineBankQuestion()
        }
        if (res.status === 429) {
            showRateLimitBanner(await res.json());
            return null;
        }
        return await res.json();
    } catch (networkError) {
        // Network failure — same fallback as 503
        return FALLBACK_OFFLINE_QUESTION(mode, topic);
    }
}
```

### 4.2 openFDA / MedlinePlus / RxNorm Errors (Content Cache Indexer)

The content cache is indexed at deploy time by the developer. These errors affect the developer's indexing script, not the running application. The `ContentCacheRefreshService` (batch job) handles them:

```kotlin
// Per-entry runCatching in refresh job — one failed drug never blocks others
results["openFDA"]?.forEach { entry ->
    runCatching {
        val data = openFdaClient.fetchLabel(drugName)
        contentCacheRepository.save(entry.copy(data = data, indexedAt = Instant.now()))
        refreshed++
    }.onFailure { e ->
        log.warn("event=CACHE_REFRESH_FAILED key={} error={}", entry.contentKey, e.message)
        failed++
        // Entry stays in DB with old data — served until next successful refresh
    }
}
```

**Student-facing:** If a `content:fda:{drug}` key returns a stale or missing entry, the voice assistant falls back to the curated NCLEX summary in localStorage. Students never see a raw error.

---

## 5. Frontend Error Boundaries

### 5.1 React Error Boundary Placement

```javascript
// App.tsx — error boundary hierarchy
// Three boundaries: app-level (catch-all), route-level (per page), component-level (questions)

<AppErrorBoundary>           {/* Catches catastrophic failures — shows full-page error */}
  <Router>
    <Route path="/" element={
      <RouteErrorBoundary>  {/* Catches page-level failures — shows in-page error */}
        <HomeScreen />
      </RouteErrorBoundary>
    } />
    <Route path="/progress" element={
      <RouteErrorBoundary>
        <ProgressDashboard />
      </RouteErrorBoundary>
    } />
    <Route path="/settings" element={
      <RouteErrorBoundary>
        <SettingsScreen />
      </RouteErrorBoundary>
    } />
  </Router>
</AppErrorBoundary>
```

```javascript
class AppErrorBoundary extends React.Component {
    state = { hasError: false, errorId: null };

    static getDerivedStateFromError() {
        return { hasError: true, errorId: `err-${Date.now()}` };
    }

    componentDidCatch(error, info) {
        // Log to application — includes component stack
        console.error('[AppError]', error, info.componentStack);
        // In production: send to Railway via structured log endpoint
    }

    render() {
        if (this.state.hasError) return (
            <FullPageError
                message="Something went wrong. Please reload the app."
                errorId={this.state.errorId}  // shown to user for support reference
            />
        );
        return this.props.children;
    }
}

class RouteErrorBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }

    render() {
        if (this.state.hasError) return (
            <InlineError
                message="This page couldn't load. Try refreshing."
                onRetry={() => this.setState({ hasError: false })}
            />
        );
        return this.props.children;
    }
}
```

### 5.2 Question Generator Error States

Questions are the core of the app. Every generation failure must show something useful, never a blank screen.

```javascript
const QUESTION_ERROR_STATES = {
    // Claude API unavailable
    SERVICE_UNAVAILABLE: {
        message: "Can't generate new questions right now.",
        action: "Use offline bank",
        actionFn: () => serveOfflineBankQuestion(),
    },
    // Rate limited
    RATE_LIMITED: {
        message: "You've answered a lot today! Take a break and come back.",
        showRetryAfter: true,
    },
    // ContentDB miss — question needs FDA data not in cache
    CONTENT_UNAVAILABLE: {
        message: "Couldn't load content for this topic.",
        action: "Try a different topic",
        actionFn: () => switchToRandomTopic(),
    },
    // EH-2: NGN safety review failed twice (two consecutive SAFETY_REVIEW_REQUIRED).
    // Fallback chain (TDD §7.1): 1) OpenStax template 2) setMode(mc) 3) offline bank.
    // Result must NEVER be null — never show a blank question card.
    NGN_GENERATION_FAILED: {
        message: "Couldn't generate a case study right now.",
        action: "Try standard question mode",
        actionFn: () => setMode('mc'),
    },
    // Network offline
    OFFLINE: {
        message: "You're offline.",
        action: "Study offline",
        actionFn: () => enterOfflineMode(),
    },
};
```

### 5.3 Stat Sync Error Handling

Stats are the most important data to preserve. Sync failures queue for retry — never silently lost.

```javascript
async function saveStats(stats) {
    try {
        const res = await authedFetch('/api/stats', {
            method: 'PUT',
            body: JSON.stringify(stats)
        });
        if (res.ok) {
            clearSyncError();
            return true;
        }
        if (res.status === 400) {
            // Validation error — log and discard (malformed stats won't save on retry)
            console.error('[Stats] Validation error — discarding update:', await res.json());
            return false;
        }
        // 5xx or network error — queue for retry
        throw new Error(`Stats save failed: ${res.status}`);
    } catch (e) {
        // Queue operation for retry on reconnect
        queueOperation({ type: 'stats', data: stats, timestamp: Date.now() });
        showSyncWarning("Progress saved locally. Will sync when back online.");
        return false;
    }
}
```

---

## 6. User-Facing Error Messages

All user-facing error messages follow these rules:
- Plain English, no technical terms
- Tell the user what happened and what they can do
- Never say "error", "exception", or "failed" — say "couldn't" or "something went wrong"
- Include a recovery action when possible

| Scenario | Message shown to user |
|---|---|
| Login wrong password | "Incorrect email or password." |
| Registration duplicate email | "Registration unsuccessful. Please try again." (intentionally vague — no enumeration) |
| Rate limited on login | "Too many sign-in attempts. Please wait 15 minutes." |
| Session expired (401) | "Your session expired. Please sign in again." |
| Claude API down | "Can't generate new questions right now. Studying from your offline bank." |
| Stats failed to save | "Progress saved on this device. Will sync when back online." |
| Content load failed | "Couldn't load this topic's content. Try a different topic." |
| Account deletion past deadline | "This account has already been permanently deleted." |
| Passkey registration failed | "Couldn't add passkey. Please try again or use your password." |
| Admin: hard delete confirmation | "This action is permanent and cannot be undone. Type the user's email to confirm." |
| General unexpected error | "Something went wrong. Please reload the app. (Ref: {errorId})" |

---

## 7. Retry Logic

### 7.1 Backend — External API Retries

```kotlin
// Exponential backoff for FDA/MedlinePlus/RxNorm in content cache indexer
// Used by ContentCacheRefreshService and developer indexing script
suspend fun <T> withRetry(
    maxAttempts: Int = 3,
    initialDelayMs: Long = 200,
    block: suspend () -> T
): T {
    repeat(maxAttempts - 1) { attempt ->
        try {
            return block()
        } catch (e: Exception) {
            val delayMs = initialDelayMs * (2.0.pow(attempt)).toLong()
            log.warn("event=RETRY_ATTEMPT attempt={} delayMs={} error={}", attempt + 1, delayMs, e.message)
            delay(delayMs)
        }
    }
    return block()  // final attempt — let exception propagate
}
```

### 7.2 Frontend — Sync Queue Retry

```javascript
// Retry on reconnect — exponential backoff with jitter
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

async function retryWithBackoff(fn, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            if (attempt === maxAttempts - 1) throw e;
            const delay = Math.min(
                RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500,
                RETRY_MAX_MS
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
```

---

## 8. Offline Error Handling

When the app is offline, the error handling strategy shifts from "retry immediately" to "queue and defer."

| Operation | Offline behavior |
|---|---|
| Stat sync | Queued to `sync:pending`, flushed on reconnect |
| Question generation | Served from offline bank (100 questions) |
| Voice assistant | Shows "Voice assistant requires internet connection." |
| Content reader (downloaded books) | Works fully offline from IndexedDB |
| Content reader (FDA labels) | Shows "This drug's full label requires internet." Falls back to localStorage NCLEX summary |
| Flag/report question | Queued to `sync:pending` |
| Login | Not possible offline — shows "Sign in requires internet." |
| Passkey login (new device, no session) | Not possible offline. Shows: "Passkey login requires internet. Please connect to sign in." |
| Passkey login (existing session cookie on device) | Works offline — valid session loaded normally, no re-authentication required |
| Passkey-only user on new device, offline | Completely blocked. Shows: "Sign in requires internet. Passkey authentication is not available offline." Accepted limitation per PRD §5.6 — user cannot remove last auth method without password. |

---

## 9. Error Monitoring — Admin Dashboard Surface

Errors are surfaced in the Admin Dashboard via the Audit Log tab. No dedicated error dashboard is needed in v5 — the audit log viewer with event type filtering covers operational needs.

**Key filters for error monitoring:**
```
event_type = 'CLAUDE_CALL_FAILED'     → AI service failures
event_type = 'CACHE_REFRESH_FAILED'  → Content update failures
event_type = 'DELETION_JOB_FAILED'   → GDPR risk
event_type = 'RATE_LIMIT'            → Possible abuse
level = 'ERROR' (Railway logs)       → All server errors (via Railway dashboard)
```

**Error volume KPI** (Admin Dashboard KPI tab):
```sql
-- 5xx error rate today
SELECT COUNT(*) as error_count
FROM audit_log
WHERE event_type IN ('CLAUDE_CALL_FAILED', 'CACHE_REFRESH_FAILED', 'DELETION_JOB_FAILED')
AND created_at >= NOW()::date;
```

---

## 10. Version History

| Version | Date | Changes |
|---|---|---|
| 1.1 | March 2026 | QA review: DataIntegrityViolationException handler (EH-1), NGN fallback chain (EH-2), passkey offline scenarios expanded (EH-3), sanitizeMessage comment (EH-4), FALLBACK_OFFLINE_QUESTION reference (EH-5). |
| 1.0 | March 2026 | Initial error handling strategy: sealed exception hierarchy, GlobalExceptionHandler, Claude/FDA/RxNorm failure handling, React error boundaries, question generator error states, stat sync retry, user-facing message table, offline error handling, retry logic with exponential backoff + jitter. |