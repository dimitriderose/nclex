# NCLEX Trainer v5 — Test Strategy
**Author:** QA Lead  
**Version:** 1.2  
**Date:** March 2026  
**Coverage Targets:** Line ≥ 90% | Branch ≥ 90% | Instruction ≥ 90%

---

## 1. Overview

This document defines the complete test strategy for NCLEX Trainer v5. It covers all layers: unit, integration, end-to-end, security, performance, and accessibility. Coverage targets of ≥90% across line, branch, and instruction metrics apply to the Kotlin backend. Frontend coverage is measured by component/function coverage using Vitest.

**Tools:**
- **Backend:** JUnit 5, MockK, Spring Boot Test, Testcontainers (PostgreSQL), AssertJ
- **Frontend:** Vitest, React Testing Library, MSW (Mock Service Worker) for API mocking
- **E2E:** Playwright (cross-browser: Chrome, Firefox, Safari/WebKit)
- **Security:** OWASP ZAP (DAST), custom JWT/CSRF test harness
- **Performance:** k6 for load testing, Lighthouse for frontend
- **Accessibility:** axe-core / @axe-core/react for ARIA and screen reader assertions
- **Coverage:** JaCoCo (backend), Vitest coverage (frontend)
- **CI:** GitHub Actions — all suites run on every PR; E2E on merge to main

---

## 2. Test Suite Architecture

```
tests/
├── backend/
│   ├── unit/                    # Pure unit tests — no Spring context
│   │   ├── auth/                # JwtUtil, AuthService, password validation
│   │   ├── stats/               # ReadinessScore algorithm
│   │   ├── content/             # ContentCacheService, content key validation
│   │   ├── security/            # Input sanitization, rate limiter logic
│   │   └── scheduled/           # Batch job logic (mocked repos)
│   ├── integration/             # Spring Boot Test + Testcontainers
│   │   ├── api/                 # Full HTTP round-trip tests per controller
│   │   ├── db/                  # Repository tests against real PostgreSQL
│   │   ├── security/            # Security headers, rate limits, auth flows
│   │   └── scheduled/           # Batch jobs against test DB
│   └── e2e/                     # Playwright — full stack
├── frontend/
│   ├── unit/                    # Vitest — pure functions, hooks, utilities
│   │   ├── contentdb/           # ContentDB routing, IDB wrapper, setBatch
│   │   ├── auth/                # authedFetch, 401 handler, passkey detection
│   │   ├── offline/             # shouldRegenerateBank, sync queue
│   │   ├── readiness/           # Score calculation, band assignment
│   │   └── security/            # bundled-content hash verification
│   │   └── studyplan/           # Study plan sub-topic specificity
│   └── evaluation/              # Golden-set voice assistant evaluation (manual/release gate)
│   ├── component/               # React Testing Library
│   │   ├── questions/           # MC, SATA, NGN, Dosage rendering
│   │   ├── progress/            # Dashboard sections, empty states
│   │   ├── settings/            # Passkey management, account deletion flow
│   │   └── admin/               # Dashboard tabs, KPI rendering
│   └── e2e/                     # Playwright — user journeys
├── build/                       # Build-time content validation (NGN topic count, chapter text)
└── fixtures/                    # Shared test data, factories, mocks
    ├── questions.ts
    ├── users.ts
    └── contentdb.ts
```

---

## 3. Backend Unit Tests

### 3.1 JwtUtil
**Target: 100% branch coverage — security critical**

```kotlin
class JwtUtilTest {
    // Happy path
    @Test fun `generate returns valid signed JWT with userId and tokenVersion`()
    @Test fun `validate returns userId and tokenVersion for valid token`()
    
    // Expiry
    @Test fun `validate returns null for expired token`()
    @Test fun `validate returns null for token signed with wrong secret`()
    @Test fun `validate returns null for malformed token string`()
    @Test fun `validate returns null for token with tampered payload`()
    
    // Secret enforcement
    @Test fun `constructor throws on secret shorter than 32 bytes`()
    @Test fun `constructor throws on human-readable non-base64 secret`()
    
    // Cancellation token
    @Test fun `validateCancellationToken returns userId for valid short-lived token`()
    @Test fun `validateCancellationToken returns null for expired 24h token`()
}
```

### 3.2 AuthService
**Target: 100% branch coverage**

```kotlin
class AuthServiceTest {
    // Registration
    @Test fun `register creates user with bcrypt-hashed password`()
    @Test fun `register throws generic error on duplicate email — no email enumeration`()
    @Test fun `register rejects password shorter than 8 chars`()
    @Test fun `register rejects password longer than 72 chars`()
    @Test fun `register rejects common password from blocklist`()
    @Test fun `register normalizes email to lowercase and trims whitespace`()
    
    // Login
    @Test fun `login returns JWT for valid credentials`()
    @Test fun `login throws UnauthorizedException for wrong password`()
    @Test fun `login throws UnauthorizedException for unknown email`()
    @Test fun `login error message identical for wrong password and unknown email`()
    
    // Logout
    @Test fun `logout increments tokenVersion — existing tokens invalidated`()
    
    // Account deletion
    @Test fun `cancelDeletion restores account within grace period`()
    @Test fun `cancelDeletion throws GoneException if deletion_scheduled_at is past`()
    @Test fun `cancelDeletion throws if no deletion_scheduled_at set`()
    @Test fun `cancelDeletion throws for invalid cancellation token`()
}
```

### 3.3 ReadinessScore Algorithm
**Target: 100% branch — this is the product's core metric**

```kotlin
class ReadinessScoreTest {
    // Minimum threshold
    @Test fun `returns null when totalAnswered less than 50`()
    @Test fun `returns null when fewer than 3 distinct topics answered`()
    @Test fun `returns score at exactly 50 questions across 3 topics`()
    
    // Score computation
    @Test fun `score reflects topic weight — Management of Care weighted 17pct`()
    @Test fun `score reflects NCJMM modifier — Prioritize Hypotheses weighted 1_5x`()
    @Test fun `recency weighting gives last 100 questions higher weight`()
    @Test fun `score is 0-100 bounded — never returns negative or over 100`()
    
    // Band assignment
    @Test fun `score below 55 returns band NeedsWork`()
    @Test fun `score 55-70 returns band OnTrack`()
    @Test fun `score 70-80 returns band Strong`()
    @Test fun `score 80-plus returns band HighConfidence`()
    
    // Edge cases
    @Test fun `score with 100pct accuracy on all topics returns near 100`()
    @Test fun `score with 0pct accuracy on all topics returns near 0`()
    @Test fun `declining trend in last 50 questions reduces score`()
}
```

### 3.4 Input Validation & Sanitization

```kotlin
class InputValidationTest {
    // StatsRequest size caps (SEC-1)
    @Test fun `StatsRequest rejects topicScores map with more than 50 keys`()
    @Test fun `StatsRequest rejects ncjmmStepScores map with more than 10 keys`()
    @Test fun `StatsRequest rejects history list with more than 200 entries`()
    @Test fun `StatsRequest rejects totalAnswered above 100000`()
    @Test fun `StatsRequest rejects negative streak`()
    
    // HTML sanitization
    @Test fun `sanitizeQuestionSnapshot strips all HTML tags from question field`()
    @Test fun `sanitizeQuestionSnapshot strips script tags from rationale`()
    @Test fun `sanitizeQuestionSnapshot preserves plain text unchanged`()
    @Test fun `sanitizeQuestionSnapshot handles null rationale without throwing`()
    
    // Content key validation
    @Test fun `isValidContentKey accepts content:openrn:pharmacology`()
    @Test fun `isValidContentKey rejects key without content: prefix`()
    @Test fun `isValidContentKey rejects key with path traversal slash`()
    @Test fun `isValidContentKey rejects key exceeding 100 chars`()
    @Test fun `isValidContentKey rejects key with whitespace`()
    
    // Reading request
    @Test fun `ReadingRequest rejects negative page number`()
    @Test fun `ReadingRequest rejects content key with SQL injection attempt`()
}
```

### 3.4.1 AuditLogger — PII and MDC Tests (QA LS-1, LS-2)

```kotlin
class AuditLoggerPiiTest {
    @Test fun `logAuth writes email_prefix not full email — ListAppender captures log output`() {
        val listAppender = ListAppender<ILoggingEvent>().also { it.start() }
        (LoggerFactory.getLogger(AuditLogger::class.java) as Logger).addAppender(listAppender)
        auditLogger.logAuth("LOGIN", null, "destiny@test.com", "1.2.3.4", true)
        val messages = listAppender.list.map { it.formattedMessage }
        assertTrue(messages.any { it.contains("des***") }, "Email prefix must appear in log")
        assertFalse(messages.any { it.contains("destiny@test.com") },
            "Full email must NEVER appear — PII violation")
    }

    @Test fun `logAuth never logs password regardless of input`()
    @Test fun `logClaudeCall logs only metadata — never message content`()
    @Test fun `audit log DB write failure never propagates to caller — runCatching absorbs it`()
}

class MdcThreadSafetyTest {
    @Test fun `unauthenticated request has no userId in MDC`() {
        // Perform unauthenticated request — assert userId absent from MDC during processing
        val captured = AtomicReference<String?>()
        // Intercept via custom filter that reads MDC during request
        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"a@b.com","password":"wrong"}"""))
        assertNull(captured.get(), "userId must not be in MDC for unauthenticated request")
    }

    @Test fun `authenticated request injects userId into MDC during processing`()
    @Test fun `MDC fully cleared after request completes — no thread-local leak to next request`()
}
```

### 3.5 Study Plan Generator

```kotlin
class StudyPlanGeneratorTest {
    // PM Gap 1: Study plan must recommend at drug class/condition level, not just NCLEX categories.
    // PRD §5.7.2 explicitly states "Pharmacology — 10 questions" is too vague to be actionable.

    @Test fun `study plan output contains specific drug class or condition — not just NCLEX category`() {
        // Given: user weak in Pharmacology generally
        val stats = statsWithWeakTopic("Pharmacology", accuracy = 0.45)
        val plan = studyPlanGenerator.generate(stats, examDaysAway = 10)
        // Assert: at least one plan item specifies a drug class or condition, not just "Pharmacology"
        val pharmItems = plan.items.filter { it.category == "Pharmacology" }
        assertTrue(pharmItems.all { it.subTopic != null },
            "All Pharmacology plan items must have a drug class or condition sub-topic")
        assertFalse(pharmItems.any { it.subTopic == "Pharmacology" },
            "Sub-topic must not be the same as the parent NCLEX category")
    }

    @Test fun `study plan prioritizes drug classes with lowest accuracy`()
    @Test fun `study plan includes OpenRN reading recommendation when available for topic`()
    @Test fun `study plan respects daily time budget — total estimated time within goal`()
    @Test fun `study plan regenerates after session — reflects updated weak areas`()
    @Test fun `study plan shows exam countdown days remaining`()
}
```

### 3.5 Batch Jobs

```kotlin
class BatchJobTest {
    // Content cache refresh
    @Test fun `refreshStaleEntries skips entries within TTL`()
    @Test fun `refreshStaleEntries re-fetches entries past 90-day TTL`()
    @Test fun `refreshStaleEntries sends alert email on any failure`()
    @Test fun `refreshStaleEntries continues after single source failure`()
    @Test fun `refreshStaleEntries logs CACHE_REFRESH audit event`()
    
    // Readiness snapshot
    @Test fun `snapshotReadinessScores skips users with fewer than 50 questions`()
    @Test fun `snapshotReadinessScores skips users inactive for more than 30 days`()
    @Test fun `snapshotReadinessScores upserts — no duplicate for same day`()
    @Test fun `snapshotReadinessScores stores TIMESTAMPTZ not bare DATE`()
    
    // Account deletion
    @Test fun `processScheduledDeletions skips accounts within grace period`()
    @Test fun `processScheduledDeletions hard-deletes all personal data in FK order`()
    @Test fun `processScheduledDeletions sets question_reports user_id to NULL — retains JSONB`()
    @Test fun `processScheduledDeletions deletes audit_log rows for deleted user`()
    @Test fun `processScheduledDeletions sends failure alert email on any error`()
    @Test fun `processScheduledDeletions continues after single-user failure`()
    
    // Audit archival
    @Test fun `archiveAuditLog deletes rows older than 90 days`()
    @Test fun `archiveAuditLog retains rows within 90 days`()
    @Test fun `archiveAuditLog logs AUDIT_ARCHIVED event with deleted count`()
}
```

---

## 4. Backend Integration Tests

All integration tests use `@SpringBootTest(webEnvironment = RANDOM_PORT)` + Testcontainers PostgreSQL. Each test class gets a fresh schema via `@Sql("/schema.sql")`.

### 4.1 Auth Controller

```kotlin
class AuthControllerIntegrationTest {
    @Test fun `POST register 201 — sets HttpOnly Secure SameSite-Strict cookie`()
    @Test fun `POST register 400 — weak password returns generic error`()
    @Test fun `POST register 400 — duplicate email returns generic error (no enumeration)`()
    @Test fun `POST login 200 — valid credentials sets HttpOnly cookie`()
    @Test fun `POST login 401 — wrong password`()
    @Test fun `POST login 429 — 6th attempt within 15 min returns 429`()
    @Test fun `POST login 429 — response includes Retry-After header`()
    @Test fun `POST logout 200 — clears cookie, increments token_version`()
    @Test fun `GET authenticated endpoint 401 — after logout token rejected`()
    @Test fun `GET authenticated endpoint 401 — after token_version increment`()
    @Test fun `GET authenticated endpoint 403 — is_active=false (pending deletion)`()
}
```

### 4.2 Stats Controller

```kotlin
class StatsControllerIntegrationTest {
    @Test fun `GET stats 200 — returns user stats from PostgreSQL`()
    @Test fun `PUT stats 200 — persists stats, computes readiness score server-side`()
    @Test fun `PUT stats 400 — rejects topicScores map with 51 keys (SEC-1)`()
    @Test fun `PUT stats 400 — rejects payload over 512KB (SEC-1)`()
    @Test fun `PUT stats 200 — server trims history to 200 entries regardless of input`()
    @Test fun `PUT stats 401 — unauthenticated request rejected`()
    @Test fun `PUT stats — readiness score null until 50 questions across 3 topics`()
    @Test fun `PUT stats — offlineBankGeneratedAt persisted for cross-device gate`()
}
```

### 4.3 Admin Controller

```kotlin
class AdminControllerIntegrationTest {
    @Test fun `GET admin/users 403 — user role cannot access admin endpoints`()
    @Test fun `GET admin/users 200 — admin role returns paginated user list`()
    @Test fun `PUT admin/users/id 200 — admin can update email and role`()
    @Test fun `POST admin/users/id/reset-pw 200 — admin sets temp password, logs ADMIN_PASSWORD_RESET`()
    @Test fun `DELETE admin/users/id 200 — soft-delete sets is_active=false`()
    @Test fun `DELETE admin/users/id/hard 200 — hard-delete removes user row`()
    @Test fun `GET admin/users/id/impersonate 200 — logs ADMIN_IMPERSONATE with expiry`()
    @Test fun `GET admin/kpis 200 — returns DAU, WAU, MAU, cost estimate`()
    @Test fun `GET admin/reports 200 — returns unreviewed queue`()
    @Test fun `PUT admin/reports/id 200 — marks report reviewed`()
    @Test fun `GET admin/audit-log 200 — paginated, filterable by event_type`()
    @Test fun `DELETE admin/users/id/passkeys 200 — revokes passkeys, logs audit event`()
    @Test fun `all admin actions — logged in audit_log with actor_id`()
}
```

### 4.7 Error Handler Integration Tests (QA EH-1, EH-4)

```kotlin
class ErrorHandlerIntegrationTest {
    // QA-EH-1: PostgreSQL schema must never leak in responses
    @Test fun `duplicate email returns 409 with generic message — no schema names in response`() {
        seedUser(email = "existing@test.com")
        val res = mockMvc.perform(
            MockMvcRequestBuilders.post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"email":"existing@test.com","password":"ValidPass1!"}"""))
            .andExpect(MockMvcResultMatchers.status().isConflict)
            .andReturn()
        val body = objectMapper.readValue(res.response.contentAsString, ErrorResponse::class.java)
        assertFalse(body.message.contains("users"), "Table name must not appear in response")
        assertFalse(body.message.contains("users_email_key"), "Constraint name must not leak")
        assertFalse(body.message.contains("duplicate key"), "PostgreSQL error text must not leak")
    }

    // QA-EH-4: sanitizeMessage truncation
    @Test fun `error message over 500 chars is truncated to exactly 500 in response`() {
        val sanitized = sanitizeMessage("x".repeat(600))
        assertEquals(500, sanitized.length, "Must be exactly 500 chars")
    }

    @Test fun `internal package names stripped from error messages`() {
        val sanitized = sanitizeMessage("org.springframework.dao.DataAccessException at com.nclex")
        assertFalse(sanitized.contains("org.springframework"))
        assertFalse(sanitized.contains("com.nclex"))
    }

    @Test fun `unexpected exception returns 500 with generic message — no stack trace`() {
        // Force unexpected exception → assert response has no class names or line numbers
    }
}
```

### 4.4 Security Headers

```kotlin
class SecurityHeadersIntegrationTest {
    @Test fun `every response includes X-Content-Type-Options nosniff`()
    @Test fun `every response includes X-Frame-Options DENY`()
    @Test fun `every response includes HSTS with 1-year max-age`()
    @Test fun `every response includes CSP with connect-src restricted to known origins`()
    @Test fun `every response includes Referrer-Policy strict-origin-when-cross-origin`()
    @Test fun `every response includes Permissions-Policy microphone=(self)`()
    @Test fun `OPTIONS preflight from unknown origin returns 403`()
    @Test fun `OPTIONS preflight from CORS_ORIGIN returns 200 with correct headers`()
    @Test fun `startup fails if CORS_ORIGIN does not start with https (SEC-4)`()
}
```

### 4.5 Offline Bank Multi-Device Concurrency (PM Gap 7)

```kotlin
class OfflineBankConcurrencyIntegrationTest {
    // PM Gap 7: Two devices checking shouldRegenerateBank simultaneously must not
    // both trigger generation — offlineBankGeneratedAt in PostgreSQL is the gate.

    // SA note: claimOfflineBankGeneration() MUST use SERIALIZABLE isolation or SELECT...FOR UPDATE.
    // Without it, both threads read NULL simultaneously and both claim generation — the test
    // will pass with optimistic locking but production still has the race condition.
    // Implementation spec: @Transactional(isolation = SERIALIZABLE) on claimOfflineBankGeneration()
    @Test fun `concurrent regeneration check — only one device triggers generation`() {
        val user = seedUser()
        // Simulate two devices fetching stats simultaneously, both seeing null offlineBankGeneratedAt
        val results = (1..2).map { deviceId ->
            CompletableFuture.supplyAsync {
                // Each device: fetch stats, check gate, attempt to claim generation
                // claimOfflineBankGeneration uses SERIALIZABLE isolation — only one wins
                val stats = userStatsRepository.findByUserId(user.id)
                if (stats.offlineBankGeneratedAt == null) {
                    userStatsRepository.claimOfflineBankGeneration(user.id, Instant.now())
                } else false
            }
        }.map { it.get() }

        // Assert: exactly one device claimed generation
        val generationsClaimed = results.count { it == true }
        assertEquals(1, generationsClaimed,
            "Only one device should claim offline bank generation — not $generationsClaimed")
    }

    @Test fun `second device within 24h sees offlineBankGeneratedAt — skips generation`()
    @Test fun `offline bank generation timestamp persisted to PostgreSQL after generation`()
    @Test fun `device without network falls back to localStorage timestamp`()
}
```

### 4.5 GDPR Deletion Flow

```kotlin
class GdprDeletionIntegrationTest {
    @Test fun `POST account/delete — sets deletion_scheduled_at to now+30days, deactivates account`()
    @Test fun `POST account/delete — sends confirmation email with cancel link`()
    @Test fun `POST account/cancel-deletion — restores account within grace period`()
    @Test fun `POST account/cancel-deletion — returns 410 if grace period expired`()
    @Test fun `deletion job — cascades deletes in FK order`()
    @Test fun `deletion job — question_reports user_id set to NULL, JSONB retained`()
    @Test fun `deletion job — audit_log rows deleted for user`()
    @Test fun `deletion job — failure for one user does not abort other deletions`()
    @Test fun `deletion job — failure triggers admin email alert`()
    @Test fun `deleted user — all endpoints return 401 after deletion`()
}
```

### 4.6 Rate Limiting

```kotlin
class RateLimitIntegrationTest {
    @Test fun `login endpoint — 6th attempt within 15 min returns 429 with Retry-After`()
    @Test fun `register endpoint — 4th registration attempt per hour returns 429`()
    @Test fun `claude proxy — 201st call within hour returns 429`()
    @Test fun `passkey login — 6th attempt within 15 min returns 429 (SEC-3)`()
    @Test fun `rate limit headers present on 429 — X-RateLimit-Limit, Remaining, Reset`()
    @Test fun `rate limit buckets evicted after 2h inactivity — Caffeine cache (SEC-2)`()
    @Test fun `different users have independent rate limit buckets`()
}
```

---

## 5. Frontend Unit Tests

### 5.1 ContentDB Routing

```javascript
describe('ContentDB routing', () => {
  it('routes content:openrn:* to IndexedDB')
  it('routes content:openstax:* to IndexedDB')
  it('routes content:fda:* to /api/content endpoint')
  it('routes content:medline:* to /api/content endpoint')
  it('routes content:rxnorm:* to /api/content endpoint')
  it('routes content:drug_nclex:* to localStorage')
  it('routes content:static:* to localStorage')
  it('routes db:meta to localStorage')
  it('routes sync:pending to localStorage')
  it('blocks client-side writes to API-backed keys (SEC policy)')
})

describe('IDB connection caching (SA-F1)', () => {
  it('opens connection once — second call returns cached db')
  it('setBatch() writes all entries in single transaction')
  it('setBatch() is faster than N sequential set() calls')
  it('setBatch() resolves true on success')
  it('setBatch() rejects on IndexedDB error')
  // SA note: must verify all-or-nothing atomicity — partial writes on failure are unacceptable
  it('setBatch() is atomic — no partial writes on mid-batch error', async () => {
    // Inject a failing entry in the middle of a 5-entry batch
    // Assert: zero entries written to IDB after failure — not 2-of-5
    const entries = [['k1', 'v1'], ['k2', 'v2'], [null, 'bad-key'], ['k4', 'v4'], ['k5', 'v5']];
    await expect(IDB.setBatch(entries)).rejects.toThrow();
    for (const key of ['k1', 'k2', 'k4', 'k5']) {
      expect(await IDB.get(key)).toBeNull();  // all-or-nothing
    }
  })
})
```

### 5.2 Authentication Helpers

```javascript
describe('authedFetch (SA-F3)', () => {
  it('sends credentials: include on every call')
  it('on 401 — clears db:meta from localStorage')
  it('on 401 — redirects to /login?reason=session_expired')
  it('on 200 — returns response normally')
  it('on 403 — does not redirect to login')
  it('on 500 — does not redirect to login')
})

describe('passkey support detection', () => {
  it('PASSKEY_SUPPORTED true when PublicKeyCredential available')
  it('PASSKEY_SUPPORTED false when PublicKeyCredential undefined')
  it('hides passkey UI when PASSKEY_SUPPORTED is false')
  it('shows passkey UI when PASSKEY_SUPPORTED is true')
})
```

### 5.3 Offline Bank

```javascript
describe('shouldRegenerateBank (SA-F7)', () => {
  it('returns true when no offline:meta exists')
  it('checks PostgreSQL stats first — returns false if offlineBankGeneratedAt within 24h')
  it('falls back to localStorage if stats unavailable (offline)')
  it('returns true if offlineBankGeneratedAt is more than 24h ago')
  it('returns false if offlineBankGeneratedAt is 23h ago')
})

describe('sync queue', () => {
  it('caps queue at 500 entries — oldest dropped on overflow')
  it('flushes in batches of 50 on reconnect')
  it('preserves stat entries over non-stat entries on overflow')
  it('queues operations when offline')
  it('does not queue when online')
})
```

### 5.4 Readiness Score (Frontend Display)

```javascript
describe('readiness display', () => {
  it('shows unlock message when totalAnswered < 50')
  it('shows unlock message when fewer than 3 topics answered')
  it('displays score and band when threshold met')
  it('renders correct color for NeedsWork band (red)')
  it('renders correct color for OnTrack band (yellow)')
  it('renders correct color for Strong band (green)')
  it('renders correct color for HighConfidence band (blue/checkmark)')
  it('shows exam countdown when examDate is set')
  it('hides exam countdown when examDate is null')
})
```

### 5.5 Bundled Content Integrity (SEC-7)

```javascript
describe('bundled content integrity', () => {
  it('computes SHA-256 of fetched buffer')
  it('proceeds with indexing when hash matches BUNDLED_CONTENT_SHA256')
  it('throws error and aborts indexing when hash does not match')
  it('does not write to IndexedDB if hash check fails')
})
```

---

## 6. Frontend Component Tests

### 6.1 Question Components

```javascript
describe('MultipleChoiceQuestion', () => {
  it('renders question text, all 4 options, NCJMM step badge')
  it('renders per-option rationale after answer selected')
  it('shows WHY CORRECT for correct option')
  it('shows WHY INCORRECT for each wrong option')
  it('shows source attribution badge')
  it('renders Report Question button')
  it('disables all options after answer selected')
  it('highlights selected correct answer green')
  it('highlights selected wrong answer red')
})

describe('SATAQuestion', () => {
  it('renders all options as checkboxes')
  it('allows multiple selections')
  it('shows partial credit score after submit')
  it('shows per-option rationale for all options')
})

describe('NGNCase', () => {
  it('renders all 6 steps in sequence')
  it('prevents skipping to next step before answering current')
  it('no-going-back rule — previous step answers locked')
  it('renders case completion screen after step 6')
  it('shows NCJMM step label on each step')
  // QA-EH-2: NGN safety review fallback — patient safety path
  it('falls back to OpenStax template after two consecutive SAFETY_REVIEW_REQUIRED failures')
  it('OpenStax fallback question is never null or empty — no blank question card')
  it('falls back to MC mode if OpenStax template also fails — three-level cascade')
})

describe('Offline login — passkey scenarios (QA EH-3)', () => {
  it('passkey-only user offline on new device sees correct blocked message', () => {
    render(<LoginScreen isOnline={false} hasSession={false} hasPasswordFallback={false} />)
    expect(screen.getByText(/sign in requires internet/i)).toBeInTheDocument()
    expect(screen.getByText(/passkey authentication is not available offline/i)).toBeInTheDocument()
  })
  it('user with existing session cookie loads app offline without re-auth')
  it('user with password fallback sees standard offline sign-in message')
})

describe('DosageQuestion', () => {
  it('renders step-by-step formula work')
  it('renders formula bank reference')
  it('accepts numeric input only')
  it('shows unit in answer field')
})
```

### 6.2 Progress Dashboard

```javascript
describe('ProgressDashboard', () => {
  // Readiness trend
  it('renders empty state when no readiness history — shows 50-question prompt')
  it('renders line chart with 7-day data on default toggle')
  it('switches to 30-day data on toggle click')
  it('switches to 90-day data on toggle click')
  it('switches to full history on toggle click')
  it('renders exam date marker on chart when examDate set')
  
  // Study calendar
  it('renders current month by default')
  it('renders empty state for new user — all tiles empty with prompt')
  it('renders darker tiles for days with more questions')
  it('navigates to previous month on arrow click')
  it('navigates to next month on arrow click')
  
  // Topic bars
  it('renders 8 NCLEX category bars')
  it('shows empty state when no topic data')
  it('colors bar red for accuracy below 60%')
  it('colors bar yellow for accuracy 60-79%')
  it('colors bar green for accuracy 80%+')
  it('tapping bar navigates to drill mode for that topic')
  
  // NCJMM bars
  it('renders 6 step bars')
  it('shows empty state when no step data')
  it('highlights weakest step with callout')
  it('tapping step bar launches drill filtered to that step')
  
  // Question volume
  it('shows empty state when no questions answered')
  it('renders MC/SATA/NGN/Dosage breakdown')
  it('shows this-week vs last-week trend arrow')
  
  // Flagged queue
  it('shows empty state when no flagged questions')
  it('shows counts for Confused, Guessed, Review Later, Flashcards')
  it('Start Review Session button navigates to spaced rep mode')
})
```

### 6.3 Settings Screen

```javascript
describe('SettingsScreen', () => {
  // Profile
  it('renders email, display name fields')
  it('email change requires current password — shows error if missing')
  it('password change blocked if new password under 8 chars')
  it('password change blocked if new password over 72 chars')
  
  // Passkeys
  it('lists all registered passkeys with label and last-used date')
  it('Add passkey button triggers WebAuthn registration ceremony')
  it('Remove passkey shows confirmation dialog')
  it('Remove button disabled when only one auth method remains')
  it('infers device label from user agent string')
  
  // Study preferences
  it('exam date change updates home screen countdown')
  it('daily goal change updates home screen progress bar')
  
  // Danger zone
  it('Delete account shows warning modal with email confirmation')
  it('Delete account requires typed email to match — rejects mismatch')
  it('Delete account confirmation sends POST to /api/account/delete')
  it('Post-deletion — account suspended, redirected to confirmation screen')
})
```

### 6.4 Admin Dashboard

```javascript
describe('AdminDashboard', () => {
  it('redirects non-admin users to 403 screen')
  it('renders 5 tabs: Users, KPIs, Reports, Audit Log, Content')
  
  // Users tab
  it('renders paginated user list with search')
  it('Edit modal — can change email, role, exam date')
  it('Reset password — sets temp password, shows success')
  it('Delete — soft delete shows confirmation')
  it('Hard delete — shows separate confirmation with warning')
  it('Impersonate — opens read-only student view')
  
  // KPIs tab
  it('renders DAU, WAU, MAU counts')
  it('renders Claude call count and estimated cost')
  it('renders unreviewed report count with link')
  it('auto-refreshes every 60 seconds')
  
  // Reports tab
  it('renders unreviewed reports sorted by report count')
  it('highlights 2+ same-category reports amber')
  it('highlights 3+ same-category reports red')
  it('PM Gap 6 — 3-report question sorted to top of list before 1-report question', () => {
    // Seeds: reportA with 1 report, reportB with 3 same-category reports
    // Asserts: reportB appears at index 0, reportA at index 1 in rendered list
    const { getAllByTestId } = render(
      <ReportsTab reports={[reportA_1count, reportB_3count]} />
    );
    const rows = getAllByTestId('report-row');
    expect(rows[0]).toHaveAttribute('data-report-id', reportB_3count.id);
    expect(rows[1]).toHaveAttribute('data-report-id', reportA_1count.id);
  })
  it('Mark reviewed removes from unreviewed queue')
  it('Dismiss removes from queue')
  
  // Audit log tab
  it('renders paginated log entries')
  it('filters by event type')
  it('filters by date range')
  it('CSV export downloads file')
  
  // Content tab
  it('renders cache status per source with TTL remaining')
  it('renders textbook reader count and avg page from reading_positions')
  it('Manual refresh triggers /api/admin/content-cache/refresh')
})
```

---

## 7. End-to-End Tests (Playwright)

### 7.1 Critical User Journeys

```javascript
test('New user registration and first question', async ({ page }) => {
  // Register → passkey prompt → dismiss → first question in < 5s
})

test('Returning user sub-1-second load', async ({ page }) => {
  // Pre-seed cookies + localStorage → navigate → assert question visible < 1000ms
})

test('Full MC question flow — answer, rationale, flag, report', async ({ page }) => {
  // Answer → per-option rationale shown → flag as Confused → Report as Clinically incorrect
})

test('Full NGN 6-step case flow', async ({ page }) => {
  // Complete all 6 steps → case completion screen → check NCJMM breakdown
})

test('Timed exam mode — no going back, locked rationale', async ({ page }) => {
  // Start timed exam → answer Q1 → attempt to go back → blocked
  // Complete exam → rationale unlocked in end-of-exam report
})

test('Voice assistant — ContentDB-grounded response', async ({ page }) => {
  // Ask about digoxin → response cites OpenRN or FDA source
  // Ask off-topic question → rejection message shown
})

test('Offline mode — study with bank, sync on reconnect', async ({ page, context }) => {
  // Generate offline bank → set offline → answer questions
  // Restore online → verify sync queue flushed → stats updated
})

test('Progress dashboard — full flow', async ({ page }) => {
  // Answer 50+ questions → navigate to /progress
  // Verify readiness chart, calendar, topic bars all populated
  // Tap a topic bar → drill mode launches filtered to that topic
})

test('Passkey registration and login', async ({ page, browser }) => {
  // Register → add passkey via virtual authenticator (Playwright WebAuthn API)
  // Log out → log back in with passkey → verify no password typed
})

test('Multi-device passkey independence (PM Gap 5)', async ({ browser }) => {
  // Each device registers its own passkey credential — both must work independently
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();

  // Device 1: register user and add passkey
  const page1 = await ctx1.newPage();
  await registerUserAndAddPasskey(page1, 'multidevice@test.com', 'ctx1-authenticator');
  const passkey1CredentialId = await getLatestCredentialId(page1);

  // Device 2: log in with password and add a second passkey
  const page2 = await ctx2.newPage();
  await loginWithPassword(page2, 'multidevice@test.com');
  await addPasskeyFromSettings(page2, 'ctx2-authenticator');
  const passkey2CredentialId = await getLatestCredentialId(page2);

  // Assert: two distinct credential IDs registered
  expect(passkey1CredentialId).not.toBe(passkey2CredentialId);

  // Assert: device 1 can still log in with its own passkey (not affected by device 2 registration)
  await page1.goto('/logout');
  await loginWithPasskey(page1, 'ctx1-authenticator');
  await expect(page1).toHaveURL('/');

  // Assert: device 2 can log in with its own passkey independently
  await page2.goto('/logout');
  await loginWithPasskey(page2, 'ctx2-authenticator');
  await expect(page2).toHaveURL('/');

  await ctx1.close();
  await ctx2.close();
})

test('Account deletion — 30-day grace, cancel', async ({ page }) => {
  // Request deletion → confirm with email → account suspended
  // Follow cancel link → account restored → can log in again
})

test('Admin user management — CRUD', async ({ page }) => {
  // Log in as admin → Users tab → edit user email → reset password
  // Soft delete user → verify user cannot log in
})

test('Cross-device stat persistence', async ({ browser }) => {
  // Browser 1: answer 10 questions → stats saved to PostgreSQL
  // Browser 2: log in same account → verify same stats visible
})
```

### 7.2 Regression Smoke Suite (runs on every PR, < 5 min)

```javascript
// 12 critical tests — fast, no AI calls, fully mocked
test('Login and load home screen')
test('Answer one MC question')
test('Flag a question')
test('Open progress dashboard')
test('Open settings screen')
test('Admin dashboard accessible to admin user')
test('Admin dashboard blocked for non-admin user')
test('Report question submits successfully')
test('Offline banner appears when connectivity lost')
test('Passkey UI visible on login screen in supported browser')
test('GDPR deletion flow initiates correctly')
test('Stats persist across page reload')
```

---

## 8. Security Tests

### 8.1 Authentication & Session

```
SEC-T1:  JWT in response body — assert absent on all auth endpoints
SEC-T2:  JWT readable by JS — assert cookie has HttpOnly flag
SEC-T3:  Cookie sent on HTTP — assert cookie has Secure flag
SEC-T4:  CSRF — POST with no CSRF token → 403
SEC-T5:  Token replay after logout → 401 (token_version incremented)
SEC-T6:  Expired JWT → 401 with redirect to login
SEC-T7:  Modified JWT payload → 401 (signature invalid)
SEC-T8:  JWT with wrong tokenVersion → 401
SEC-T9:  is_active=false user → 403 on all endpoints except cancel-deletion
```

### 8.2 Authorization

```
SEC-T10: User accessing /api/admin/* → 403
SEC-T11: User accessing another user's flags → 403 (ownership enforced)
SEC-T12: User accessing another user's stats → 403
SEC-T13: Admin role — promote/demote via PUT /admin/users/{id} → logged in audit_log
SEC-T14: IDOR — GET /api/flags/{uuid} with valid UUID belonging to other user → 403
```

### 8.3 Input & Injection

```
SEC-T15: SQL injection in email field → sanitized, no query breakout
SEC-T16: XSS in question text → Jsoup strips tags, not persisted raw
SEC-T17: Path traversal in content_key → rejected by regex CHECK constraint
SEC-T18: StatsRequest with 51 topicScores keys → 400 (SEC-1)
SEC-T19: Request body > 512KB → 413 (SEC-1)
SEC-T20: Claude proxy — client cannot override model → server-enforced model returned
SEC-T21: Claude proxy — client cannot set system prompt → only server-side prompts used
SEC-T22: Claude proxy — message content > 8000 chars → 400
```

### 8.4 Rate Limiting

```
SEC-T23: 6 login attempts from same IP in 15 min → 429 with Retry-After
SEC-T24: 4 register attempts from same IP in 1 hour → 429
SEC-T25: 201 Claude calls in 1 hour → 429
SEC-T26: 6 passkey login attempts → 429 (SEC-3)
SEC-T27: Rate limit bucket evicted after 2h — 201st call after eviction succeeds (SEC-2)
```

### 8.5 CORS & Headers

```
SEC-T28: Preflight from unknown origin → 403
SEC-T29: CORS_ORIGIN=* at startup → application fails to start (SEC-4)
SEC-T30: CORS_ORIGIN=http://... at startup → application fails to start (SEC-4)
SEC-T31: Permissions-Policy microphone=(self) present on all responses (SEC-8)
SEC-T32: X-Content-Type-Options nosniff on JSON API responses (SEC-10)
```

### 8.6 Content Integrity

```
SEC-T33: bundled-content.json hash mismatch → indexing aborted (SEC-7)
SEC-T34: bundled-content.json hash match → indexing proceeds normally (SEC-7)
SEC-T35: Modified bundled-content.json hash detected before any IDB write
```

---

## 9. Performance Tests (k6)

### 9.1 Load Targets

| Scenario | VUs | Duration | Pass Criteria |
|---|---|---|---|
| Returning session load | 50 | 2 min | p95 < 200ms, 0% errors (Railway Hobby tier — tighten to p95 < 100ms if upgraded) |
| Stats PUT (per question) | 50 | 5 min | p95 < 300ms, 0% errors |
| Claude proxy (question gen) | 10 | 5 min | p95 < 8s (external AI latency — not app code), 0% 5xx |
| Admin KPI dashboard | 5 | 1 min | p95 < 500ms |
| Progress summary (single query) | 20 | 2 min | p95 < 400ms |

### 9.2 Lighthouse Targets (Frontend)

| Metric | Target |
|---|---|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 3.0s |
| Performance score | ≥ 85 |
| Accessibility score | ≥ 90 |
| Initial JS bundle size | < 500KB (excludes bundled-content.json) |

### 9.3 Accessibility Tests — axe-core (PM Gap 8)

NCLEX students may use assistive technology. The following axe-core assertions are required on core question flow components. Integrated into the component test suite via `@axe-core/react`.

```javascript
import { axe } from '@axe-core/react';

describe('Accessibility — core question flow', () => {
  it('MultipleChoiceQuestion has no axe violations', async () => {
    const { container } = render(<MultipleChoiceQuestion {...mcProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('answer options have ARIA labels — screen reader announces option letter and text', () => {
    const { getAllByRole } = render(<MultipleChoiceQuestion {...mcProps} />);
    const options = getAllByRole('radio');
    options.forEach((opt, i) => {
      expect(opt).toHaveAttribute('aria-label');
    });
  });

  it('SATA checkboxes are keyboard navigable — Tab moves focus between options', async () => {
    const user = userEvent.setup();
    const { getAllByRole } = render(<SATAQuestion {...sataProps} />);
    const checkboxes = getAllByRole('checkbox');
    await user.tab();
    expect(checkboxes[0]).toHaveFocus();
    await user.tab();
    expect(checkboxes[1]).toHaveFocus();
  });

  it('NGN case steps announce step number to screen reader', () => {
    const { getByRole } = render(<NGNCase step={2} totalSteps={6} {...ngnProps} />);
    expect(getByRole('heading', { name: /step 2 of 6/i })).toBeInTheDocument();
  });

  it('voice assistant output has axe violations — no violations', async () => {
    const { container } = render(<VoiceAssistantPanel response={mockResponse} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('progress dashboard charts have descriptive aria-labels for screen readers', () => {
    const { getByRole } = render(<ReadinessTrendChart data={mockHistory} />);
    expect(getByRole('img')).toHaveAttribute('aria-label',
      expect.stringContaining('Readiness score trend'));
  });

  it('Report Question modal is focus-trapped — Tab does not leave modal', async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<ReportModal isOpen={true} />);
    const modal = getByRole('dialog');
    // Tab through all focusable elements — should cycle within modal
    await user.tab(); expect(modal).toContainElement(document.activeElement);
    await user.tab(); expect(modal).toContainElement(document.activeElement);
  });
});
```

---

## 10. Coverage Configuration

### Backend (JaCoCo)

```xml
<!-- jacoco.xml — enforced in CI -->
<limits>
  <limit>
    <counter>LINE</counter>
    <minimum>0.90</minimum>
  </limit>
  <limit>
    <counter>BRANCH</counter>
    <minimum>0.90</minimum>
  </limit>
  <limit>
    <counter>INSTRUCTION</counter>
    <minimum>0.90</minimum>
  </limit>
</limits>

<!-- Exclusions — generated code, config boilerplate, Spring entry point -->
<excludes>
  <exclude>**/NclexApplication*</exclude>
  <exclude>**/config/DatabaseConfig*</exclude>
  <exclude>**/*Dto*</exclude>
  <exclude>**/*Entity*</exclude>
</excludes>
```

### Frontend (Vitest)

```javascript
// vitest.config.ts
coverage: {
  provider: 'v8',
  thresholds: {
    lines: 90,
    branches: 90,
    functions: 90,
    statements: 90,
  },
  exclude: [
    'src/main.tsx',
    'src/vite-env.d.ts',
    '**/*.stories.*',
    '**/__fixtures__/**',
  ]
}
```

---

## 11. CI/CD Pipeline

```yaml
# .github/workflows/test.yml
on: [push, pull_request]

jobs:
  backend-unit:
    runs-on: ubuntu-latest
    steps: [./gradlew test jacocoTestReport jacocoTestCoverageVerification]
    # Fails PR if coverage drops below 90%

  backend-integration:
    # SA note: pin to postgres:16-alpine to match Railway provisioning — version mismatch
    # causes silent differences in JSONB indexing and constraint evaluation
    services: { postgres: { image: postgres:16-alpine } }
    steps: [./gradlew integrationTest]

  frontend-unit:
    steps: [npm run test:coverage]
    # Fails PR if coverage drops below 90%

  security-headers:
    steps: [./gradlew integrationTest --tests "*SecurityHeaders*"]

  e2e-smoke:
    steps: [playwright test --grep @smoke]
    # Runs on every PR — must pass to merge

  e2e-full:
    steps: [playwright test]
    # Runs on merge to main only (slower)

  performance:
    steps: [k6 run tests/performance/load.js]
    # Runs on merge to main — non-blocking, alerts on regression

  content-validation:
    steps: [npm run test:build]
    # Validates bundled-content.json: ≥40 NGN topics, all 7 OpenRN books, non-empty chapters
    # Runs on every PR — fails build if content requirements not met

  accessibility:
    steps: [npm run test:a11y]
    # axe-core assertions on core question flow components
    # Runs on every PR — must pass to merge
```

---

## 12. Test Data Strategy

### Factories

```javascript
// fixtures/users.ts
export const userFactory = {
  student: (overrides?) => ({ email: 'student@test.com', role: 'user', ...overrides }),
  admin:   (overrides?) => ({ email: 'admin@test.com',   role: 'admin', ...overrides }),
  pendingDeletion: (overrides?) => ({
    email: 'deleting@test.com', is_active: false,
    deletion_scheduled_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), ...overrides
  }),
  expiredDeletion: (overrides?) => ({
    email: 'expired@test.com', is_active: false,
    deletion_scheduled_at: new Date(Date.now() - 86400000), ...overrides  // 1 day past — deterministic, not flaky
  }),
}

// fixtures/questions.ts
export const questionFactory = {
  mc:     (overrides?) => ({ type: 'multiple_choice', ncjmmStep: 'Recognize Cues', ... }),
  sata:   (overrides?) => ({ type: 'sata', correctOptions: [0, 2], ... }),
  ngn:    (overrides?) => ({ type: 'ngn', steps: Array(6).fill(ngnStep()), ... }),
  dosage: (overrides?) => ({ type: 'dosage', formula: 'desired/have × volume', ... }),
}
```

### Database Seeding (Testcontainers)

```kotlin
// TestDatabaseHelper.kt
fun seedUser(role: String = "user", isActive: Boolean = true): User
fun seedUserWithStats(totalAnswered: Int, topicScores: Map<String, Double>): Pair<User, UserStats>
fun seedReadinessHistory(userId: UUID, days: Int): List<ReadinessHistory>
fun seedAuditLog(userId: UUID, eventCount: Int): List<AuditLog>
```

---

## 13. Known Risk Areas — Test Priority

| Area | Risk | Priority | Why |
|---|---|---|---|
| ReadinessScore algorithm | Wrong score harms student exam prep decisions | P0 | Core product metric |
| Readiness score correlation | PRD goal: High Confidence students pass at >85% rate | P0 post-launch | Requires longitudinal tracking — see §14 |
| GDPR deletion cascade | Incomplete deletion = regulatory violation | P0 | Legal obligation |
| Per-option rationale | Wrong rationale = patient safety risk | P0 | Prof. Linda requirement |
| StatsRequest size caps | SEC-1 storage exhaustion | P0 | Security |
| bundled-content integrity | Poisoned clinical content | P0 | Patient safety |
| JWT revocation on logout | Session still valid after logout | P0 | Security |
| Offline sync queue | Data loss if queue corrupted | P1 | Data integrity |
| IDB batch write | Setup fails on mobile = no access to content | P1 | UX |
| Progress dashboard queries | N+1 regression tanks load time | P1 | Performance |
| Audit log archival | Unbounded table growth | P1 | Operations |

---

*Test strategy covers all PRD sign-off criteria mapped to specific test cases. PM review v1.1; SA annotated v1.2: Estimated suite runtime: unit 2 min, integration 8 min, smoke E2E 5 min, full E2E 25 min, security 10 min, performance 15 min.*

---

## 14. Post-Launch Validation Plan

### 14.1 Readiness Score Correlation (PM Gap 2)

The PRD goals table specifies "Students scoring High Confidence should pass at >85% rate." This cannot be validated before launch — it requires longitudinal data. The following tracking plan satisfies the goal.

**Tracking mechanism:**
- Admin Dashboard KPI tab already collects readiness band distribution per user
- Add a voluntary post-exam outcome field to Settings: "Did you pass your NCLEX? Yes / No / Not yet taken"
- Stored in `user_stats.nclex_outcome` — a new optional TEXT field

**Review schedule:**
- 30 days post-launch: review first cohort of students who self-reported outcomes. If fewer than 10 outcomes, defer to 60-day review.
- 60 days post-launch: calculate pass rate by readiness band. Target: High Confidence band ≥ 85% pass rate.
- If correlation is weak: audit readiness score weighting — NCJMM modifier and topic weighting may need calibration.

**Schema addition:** `ALTER TABLE user_stats ADD COLUMN nclex_outcome TEXT CHECK (nclex_outcome IN ('passed', 'not_passed', 'not_taken'));`

### 14.2 Voice Assistant Golden-Set Evaluation (PM Gap 3)

PRD §3 goal: "100% of assistant responses citing a specific indexed source." Automated validation against a fixed query set.

```javascript
// tests/evaluation/voiceAssistantGoldenSet.test.ts
// SA note: expose via workflow_dispatch trigger in GitHub Actions — runnable manually
// AND automatically on release tags. Not on every PR (requires live Claude API).
// Add to CI: on: [workflow_dispatch, push: tags: ['v*']]

const GOLDEN_SET = [
  { query: "What does OpenRN say about metoprolol nursing considerations?",
    expectedSourcePattern: /openrn|nursing pharmacology/i },
  { query: "What are the black box warnings for warfarin?",
    expectedSourcePattern: /openfda|warfarin label/i },
  { query: "What is the normal potassium level?",
    expectedSourcePattern: /content:labs|lab values/i },
  { query: "Explain the delegation rights for a UAP",
    expectedSourcePattern: /content:delegation|openrn.*management/i },
  { query: "What are the NCLEX NGN case study steps?",
    expectedSourcePattern: /content:strategies|ncjmm/i },
  { query: "What is the antidote for heparin overdose?",
    expectedSourcePattern: /openfda|heparin/i },
  { query: "Describe hypokalemia signs and symptoms",
    expectedSourcePattern: /content:labs|openstax|openrn/i },
  { query: "What isolation precautions for C. diff?",
    expectedSourcePattern: /content:infection_control/i },
  { query: "What are Erikson's developmental stages?",
    expectedSourcePattern: /content:development/i },
  { query: "What is a therapeutic digoxin level?",
    expectedSourcePattern: /content:labs|therapeutic.*level/i },
  // Off-topic rejection queries
  { query: "What is the best treatment for hypertension in general?",
    expectedRejection: true },
  { query: "Can you write me a poem?",
    expectedRejection: true },
];

test('voice assistant golden set — all responses cite indexed source', async () => {
  let citedCount = 0;
  let rejectedCount = 0;
  for (const item of GOLDEN_SET) {
    const response = await callVoiceAssistant(item.query);
    if (item.expectedRejection) {
      expect(response).toMatch(/I can only help with NCLEX|out of scope/i);
      rejectedCount++;
    } else {
      expect(response).toMatch(item.expectedSourcePattern);
      citedCount++;
    }
  }
  const citationRate = citedCount / GOLDEN_SET.filter(q => !q.expectedRejection).length;
  expect(citationRate).toBe(1.0);  // 100% citation rate — PRD §3 goal
});
```

### 14.3 NGN Topic Count Build Assertion (PM Gap 4)

```javascript
// tests/build/contentValidation.test.ts
// Runs as part of the build pipeline — fails build if content requirements not met

import bundledContent from '../../public/bundled-content.json';

test('BUNDLED_CONTENT has at least 40 NGN case study topics', () => {
  const topics = Object.values(bundledContent.openstax.ngn)
    .flatMap((book: any) => book.cases)
    .map((c: any) => c.topic);
  const uniqueTopics = new Set(topics);
  expect(uniqueTopics.size).toBeGreaterThanOrEqual(40);
});

test('BUNDLED_CONTENT has all 7 required OpenRN books', () => {
  const required = ['pharmacology', 'fundamentals', 'skills', 'mentalhealth',
                    'management', 'advancedskills', 'maternal'];
  for (const book of required) {
    expect(bundledContent.openrn).toHaveProperty(book);
  }
});

test('each OpenRN book has at least 3 chapters', () => {
  for (const [book, data] of Object.entries(bundledContent.openrn) as any) {
    expect(data.chapters.length).toBeGreaterThanOrEqual(3);
  }
});

test('each chapter has non-empty text field', () => {
  for (const [_, data] of Object.entries(bundledContent.openrn) as any) {
    for (const chapter of data.chapters) {
      expect(chapter.text.length).toBeGreaterThan(100);
    }
  }
});
```