# NCLEX Trainer v5 — Logging Strategy
**Author:** SA (Ravi S.)  
**Version:** 1.1  
**Date:** March 2026  
**Related:** NCLEX_Trainer_v5_TDD.md §12.8, §13.1

---

## 1. Overview

This document defines the structured logging specification for NCLEX Trainer v5. It covers log levels, event taxonomy, log format, Railway log drain configuration, retention, and the Admin Dashboard log surface.

**Two logging systems work in parallel:**
- **Application logs** — Logback/SLF4J structured JSON written to stdout, drained by Railway to persistent storage. Machine-readable, searchable, retained 30 days on Railway.
- **Audit log table** — PostgreSQL `audit_log` table (§12.2) — business events only, queryable by Admin Dashboard, retained 90 days then archived by §12.6.4 job.

These are complementary, not redundant. Application logs capture everything including stack traces and system events. The audit log captures only events that admin users need to query — auth, Claude calls, admin actions, rate limit hits.

---

## 2. Log Levels

| Level | When to use | Examples |
|---|---|---|
| `ERROR` | Unrecoverable failure requiring immediate attention | Deletion job failure, DB connection lost, SMTP send failed, content integrity check failed |
| `WARN` | Degraded operation — system continues but something is wrong | Rate limit hit, FDA API returned unexpected format, IDB write retry, cache miss on hot key |
| `INFO` | Normal business events worth retaining | User registered, login success, Claude call completed, batch job started/completed, cache refreshed |
| `DEBUG` | Developer diagnostic — disabled in production | SQL query times, JWT validation steps, ContentDB routing decisions |
| `TRACE` | Verbose diagnostic — never in production | Request/response body logging (PII risk — never enable in prod) |

**Production config:** `INFO` and above. `DEBUG` enabled only in local dev via `SPRING_PROFILES_ACTIVE=dev`.

---

## 3. Log Format — Structured JSON

All logs are emitted as structured JSON to stdout. Railway captures stdout and makes it searchable.

```kotlin
// logback-spring.xml — production profile
<configuration>
  <springProfile name="production">
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
      <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <includeMdcKeyName>requestId</includeMdcKeyName>
        <includeMdcKeyName>userId</includeMdcKeyName>
        <includeMdcKeyName>sessionId</includeMdcKeyName>
      </encoder>
    </appender>
    <root level="INFO">
      <appender-ref ref="STDOUT" />
    </root>
  </springProfile>

  <springProfile name="dev">
    <!-- Human-readable format for local development -->
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
      <encoder>
        <pattern>%d{HH:mm:ss} [%thread] %-5level %logger{36} - %msg%n</pattern>
      </encoder>
    </appender>
    <root level="DEBUG">
      <appender-ref ref="STDOUT" />
    </root>
  </springProfile>
</configuration>
```

**Example structured log entry:**
```json
{
  "timestamp": "2026-03-31T14:22:01.445Z",
  "level": "INFO",
  "logger": "com.nclex.auth.AuthController",
  "message": "User registered",
  "requestId": "req-a1b2c3",
  "userId": null,
  "event": "AUTH_REGISTER",
  "email_prefix": "des***",
  "ip": "203.0.113.42"
}
```

**PII rules in logs:**
- Email: log only first 3 chars + `***` (e.g. `des***`) — never full email
- Password: never logged under any circumstances
- JWT: never logged
- User ID (UUID): safe to log in full
- IP address: log in full — needed for rate limit forensics

---

## 4. Request Correlation — MDC

Every inbound HTTP request gets a `requestId` injected into the MDC (Mapped Diagnostic Context). All log lines within that request automatically include it — enabling full request tracing in Railway log search.

```kotlin
// RequestIdFilter.kt — runs on every request
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestIdFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain
    ) {
        val requestId = request.getHeader("X-Request-ID")
            ?: "req-${UUID.randomUUID().toString().take(8)}"
        MDC.put("requestId", requestId)
        response.setHeader("X-Request-ID", requestId)  // echo back for client debugging
        try {
            chain.doFilter(request, response)
        } finally {
            MDC.clear()
        }
    }
}
```

Authenticated requests also inject `userId` into MDC in the JWT filter — so every log line for an authenticated session includes the user UUID.

**LS-2: MDC userId must be cleared at the start of every request (thread safety):**
The JWT filter must call `MDC.remove("userId")` before attempting JWT extraction. Without this, a previous request's `userId` leaks into the next request's logs on thread pool reuse — an unauthenticated login attempt would log as if it were the previous user. `RequestIdFilter` already calls `MDC.clear()` in its finally block, but the JWT filter runs *after* it and must explicitly clear `userId` at entry:

```kotlin
// JwtCookieFilter — safe MDC handling
override fun doFilterInternal(request: HttpServletRequest, ...) {
    MDC.remove("userId")  // clear residual userId from previous request on this thread
    val token = request.cookies?.find { it.name == "nclex_session" }?.value
    if (token != null) {
        val (userId, _) = jwtUtil.validate(token) ?: run { chain.doFilter(request, response); return }
        MDC.put("userId", userId.toString())
        // ... set SecurityContext
    }
    chain.doFilter(request, response)
    // RequestIdFilter.finally calls MDC.clear() — no additional cleanup needed here
}
```

---

## 5. Event Taxonomy

### 5.1 Auth Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `AUTH_REGISTER` | INFO | App log + audit_log | email_prefix, ip |
| `AUTH_LOGIN` | INFO | App log + audit_log | email_prefix, ip, success |
| `AUTH_LOGIN_FAILED` | WARN | App log + audit_log | email_prefix, ip, reason |
| `AUTH_LOGOUT` | INFO | App log + audit_log | userId |
| `AUTH_PASSWORD_RESET` | INFO | App log + audit_log | userId, actorId (admin) |
| `AUTH_DELETION_REQUESTED` | INFO | App log + audit_log | userId |
| `AUTH_DELETION_CANCELLED` | INFO | App log + audit_log | userId |
| `AUTH_ACCOUNT_DELETED` | INFO | App log + audit_log | userId (anonymized post-deletion) |

### 5.2 Rate Limit Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `RATE_LIMIT_LOGIN` | WARN | App log + audit_log | ip, attemptCount |
| `RATE_LIMIT_REGISTER` | WARN | App log + audit_log | ip, attemptCount |
| `RATE_LIMIT_CLAUDE` | WARN | App log + audit_log | userId, callCount |
| `RATE_LIMIT_PASSKEY` | WARN | App log + audit_log | ip, attemptCount |

### 5.3 Claude Proxy Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `CLAUDE_CALL_START` | INFO | App log | userId, context, tokenEstimate |
| `CLAUDE_CALL_SUCCESS` | INFO | App log + audit_log | userId, context, durationMs |
| `CLAUDE_CALL_FAILED` | ERROR | App log | userId, context, statusCode, error |
| `CLAUDE_CALL_TIMEOUT` | WARN | App log | userId, context, timeoutMs |

**Note:** Input/output content is never logged — patient safety risk and PII concern. Only metadata.

### 5.4 Admin Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `ADMIN_USER_EDIT` | INFO | App log + audit_log | actorId, targetUserId, fieldsChanged |
| `ADMIN_USER_DELETE_SOFT` | INFO | App log + audit_log | actorId, targetUserId |
| `ADMIN_USER_DELETE_HARD` | WARN | App log + audit_log | actorId, targetUserId |
| `ADMIN_PASSWORD_RESET` | INFO | App log + audit_log | actorId, targetUserId |
| `ADMIN_IMPERSONATE` | WARN | App log + audit_log | actorId, targetUserId, expiresAt |
| `ADMIN_PASSKEY_REVOKE` | INFO | App log + audit_log | actorId, targetUserId, credentialCount |
| `ADMIN_REPORT_REVIEWED` | INFO | App log + audit_log | actorId, reportId, action |
| `ADMIN_CACHE_REFRESH` | INFO | App log + audit_log | actorId, source, entriesUpdated |

### 5.5 Batch Job Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `CACHE_REFRESH_START` | INFO | App log | entryCount, cutoffDate |
| `CACHE_REFRESH_SUCCESS` | INFO | App log + audit_log | refreshed, failed, durationMs |
| `CACHE_REFRESH_FAILED` | ERROR | App log | source, error, willRetry |
| `SNAPSHOT_JOB_START` | INFO | App log | eligibleUsers |
| `SNAPSHOT_JOB_SUCCESS` | INFO | App log | snapshotCount, durationMs |
| `DELETION_JOB_START` | INFO | App log | dueCount |
| `DELETION_JOB_SUCCESS` | INFO | App log + audit_log | deletedCount, failedCount |
| `DELETION_JOB_FAILED` | ERROR | App log | failedUserIds, emailAlertSent |
| `AUDIT_ARCHIVED` | INFO | App log | deletedCount, cutoffDate |

### 5.6 Content & Security Events

| Event | Level | Logged to | Fields |
|---|---|---|---|
| `CONTENT_INTEGRITY_FAIL` | ERROR | App log | expectedHash, actualHash |
| `CONTENT_FETCH_FAILED` | WARN | App log | contentKey, source, error |
| `SECURITY_INVALID_JWT` | WARN | App log | ip, reason |
| `SECURITY_UNAUTHORIZED` | WARN | App log | ip, userId, endpoint |
| `SECURITY_CORS_REJECTED` | WARN | App log | origin, endpoint |

---

## 6. AuditLogger Implementation

The `AuditLogger` (TDD §12.8) persists all business events to the `audit_log` PostgreSQL table **and** writes to the application log. The two are in sync — every `audit_log` row has a corresponding structured log entry.

```kotlin
// Full AuditLogger with structured logging and DB persistence
@Component
class AuditLogger(
    private val auditLogRepository: AuditLogRepository,
    private val log: Logger = LoggerFactory.getLogger(AuditLogger::class.java)
) {

    fun logAuth(event: String, userId: UUID?, email: String, ip: String, success: Boolean) {
        val emailPrefix = email.take(3) + "***"
        log.info("event={} email_prefix={} ip={} success={}", event, emailPrefix, ip, success)
        persist(eventType = "AUTH_$event", userId = userId,
            metadata = mapOf("email_prefix" to emailPrefix, "ip" to ip, "success" to success))
    }

    fun logClaudeCall(userId: UUID, context: String?, durationMs: Long) {
        log.info("event=CLAUDE_CALL userId={} context={} durationMs={}", userId, context, durationMs)
        persist(eventType = "CLAUDE_CALL", userId = userId,
            metadata = mapOf("context" to (context ?: "unknown"), "durationMs" to durationMs))
    }

    fun logRateLimit(endpoint: String, userId: UUID?, ip: String) {
        log.warn("event=RATE_LIMIT endpoint={} userId={} ip={}", endpoint, userId, ip)
        persist(eventType = "RATE_LIMIT", userId = userId,
            metadata = mapOf("endpoint" to endpoint, "ip" to ip))
    }

    fun logAdminAction(event: String, actorId: UUID, targetUserId: UUID, detail: String) {
        log.warn("event=ADMIN_{} actorId={} targetUserId={} detail={}", event, actorId, targetUserId, detail)
        persist(eventType = "ADMIN_$event", userId = targetUserId, actorId = actorId,
            metadata = mapOf("detail" to detail))
    }

    fun logBatchJob(event: String, metadata: Map<String, Any>) {
        log.info("event={} {}", event, metadata.entries.joinToString(" ") { "${it.key}=${it.value}" })
        if (event.endsWith("_SUCCESS") || event.endsWith("_FAILED")) {
            persist(eventType = event, metadata = metadata)
        }
    }

    fun logSystemEvent(event: String, userId: UUID?, detail: String) {
        log.info("event={} userId={} detail={}", event, userId, detail)
        persist(eventType = event, userId = userId, metadata = mapOf("detail" to detail))
    }

    private fun persist(eventType: String, userId: UUID? = null,
                        actorId: UUID? = null, metadata: Map<String, Any> = emptyMap()) {
        runCatching {
            auditLogRepository.save(AuditLog(
                eventType = eventType, userId = userId,
                actorId = actorId,
                metadata = metadata
            ))
        }.onFailure { e ->
            // Audit log failure must never break the primary operation
            log.error("Failed to persist audit log event={} error={}", eventType, e.message)
        }
    }
}
```

**Key design principles:**
- Audit log persistence failure never propagates — `runCatching` ensures the primary operation succeeds even if the audit write fails
- Application log always written first — even if DB is down, the log drain has the event
- Both writes happen in the same thread — no async complexity, no lost events between log and DB

---

## 7. Admin Dashboard Log Surface

The Admin Dashboard Audit Log tab (PRD §5.12.4) queries the `audit_log` table. The following queries power each view:

```sql
-- Default view: all events last 7 days, newest first
SELECT id, event_type, user_id, actor_id, metadata, created_at
FROM audit_log
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50 OFFSET :page * 50;

-- Filter by event type
WHERE event_type = :eventType AND created_at > NOW() - INTERVAL '90 days'

-- Filter by user (show all activity for a specific user)
WHERE user_id = :userId ORDER BY created_at DESC

-- Filter by date range
WHERE created_at BETWEEN :startDate AND :endDate

-- Admin actions only (for accountability review)
WHERE event_type LIKE 'ADMIN_%' ORDER BY created_at DESC

-- Rate limit spike detection (group by hour)
-- LS-3: Surfaced in Admin Dashboard KPI tab as a 24h sparkline (PRD §5.12.2 updated)
SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as hits
FROM audit_log
WHERE event_type = 'RATE_LIMIT'
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour ORDER BY hour DESC;

-- Claude cost estimate (calls × tokens × rate)
SELECT COUNT(*) as calls,
       COUNT(*) * 2000 * 0.000003 as estimated_cost_usd
FROM audit_log
WHERE event_type = 'CLAUDE_CALL'
AND created_at >= DATE_TRUNC('month', NOW());
```

**Application logs** (Railway log drain) are accessible from the Railway dashboard at `https://railway.app/project/{id}/logs`. These are not surfaced in the Admin Dashboard — they require Railway access. The Admin Dashboard only surfaces the `audit_log` table entries.

### 7.1 Human-Readable Event Labels

The Admin Dashboard renders `event_type` values as human-readable labels:

| event_type | Displayed as |
|---|---|
| `AUTH_REGISTER` | User registered |
| `AUTH_LOGIN` | Logged in (password) |
| `AUTH_LOGIN_PASSKEY` | Logged in (passkey) |
| `AUTH_LOGIN_FAILED` | Login failed |
| `AUTH_LOGOUT` | Logged out |
| `AUTH_DELETION_REQUESTED` | Requested account deletion |
| `AUTH_DELETION_CANCELLED` | Cancelled account deletion |
| `AUTH_ACCOUNT_DELETED` | Account permanently deleted |
| `RATE_LIMIT_LOGIN` | Rate limit hit (login) |
| `RATE_LIMIT_REGISTER` | Rate limit hit (register) |
| `RATE_LIMIT_CLAUDE` | Rate limit hit (AI calls) |
| `RATE_LIMIT_PASSKEY` | Rate limit hit (passkey) |
| `CLAUDE_CALL_SUCCESS` | AI call completed |
| `ADMIN_USER_EDIT` | Admin edited user |
| `ADMIN_USER_DELETE_SOFT` | Admin deactivated user |
| `ADMIN_USER_DELETE_HARD` | Admin hard-deleted user |
| `ADMIN_PASSWORD_RESET` | Admin reset password |
| `ADMIN_IMPERSONATE` | Admin viewed as user |
| `ADMIN_PASSKEY_REVOKE` | Admin revoked passkeys |
| `ADMIN_REPORT_REVIEWED` | Admin reviewed question report |
| `ADMIN_CACHE_REFRESH` | Admin refreshed content cache |
| `CACHE_REFRESH_SUCCESS` | Content cache refreshed (scheduled) |
| `DELETION_JOB_SUCCESS` | Account deletion job completed |
| `AUDIT_ARCHIVED` | Old audit logs archived |

### 7.2 CSV Export

The audit log viewer's "Export CSV" button downloads all rows matching the current filter. The backend streams the response to avoid loading all rows into memory:

```kotlin
@GetMapping("/audit-log/export")
@PreAuthorize("hasRole('ADMIN')")
fun exportCsv(
    @RequestParam eventType: String?,
    @RequestParam from: LocalDate?,
    @RequestParam to: LocalDate?,
    response: HttpServletResponse
) {
    response.contentType = "text/csv"
    response.setHeader("Content-Disposition",
        "attachment; filename="audit-log-\${LocalDate.now()}.csv"")
    // Stream directly — never load all rows into memory
    auditLogRepository.streamFiltered(eventType, from, to).use { rows ->
        val writer = response.writer
        writer.println("timestamp,event_type,user_email,actor_email,metadata")
        rows.forEach { row ->
            writer.println("\${row.createdAt},\${row.eventType},\${row.userEmail ?: ""},\${row.actorEmail ?: ""},\${row.metadata}")
        }
    }
}
```

---

## 8. Railway Log Drain Configuration

Railway streams stdout to its built-in log viewer with 30-day retention on Hobby tier. No additional configuration is required for basic logging.

**For production hardening (post-launch):** Configure a Railway log drain to forward logs to a persistent log aggregation service (Datadog, Papertrail, Logtail). This extends retention beyond 30 days and enables alerting.

```
# Railway log drain (optional — configure in Railway project settings)
# Format: HTTPS endpoint that accepts JSON log lines
LOG_DRAIN_URL=https://in.logtail.com/  # or your preferred provider
```

**Recommended alert rules (set in Railway or log drain service):**
- `level=ERROR` — immediate alert via email/Slack
- `event=DELETION_JOB_FAILED` — GDPR risk, PagerDuty severity P1
- `event=CONTENT_INTEGRITY_FAIL` — patient safety, PagerDuty severity P1
- `event=RATE_LIMIT count > 50 in 5 min` — possible attack, Slack alert

---

## 9. Log Retention Policy

| Storage | Retention | Notes |
|---|---|---|
| Railway stdout logs | 30 days (Hobby tier) | Extend via log drain for production |
| `audit_log` PostgreSQL table | 90 days | Archived by §12.6.4 monthly job |
| Archived audit logs | Not retained | Deleted at 90 days per GDPR |
| Error emails (admin alerts) | Admin's email inbox | No programmatic retention |

**GDPR note:** Audit log rows are deleted at 90 days (§12.6.4 job). Application logs contain only `email_prefix` (not full email) — this satisfies GDPR minimisation. Full email is never written to any log.

---

## 10. What NOT to Log

These items must **never** appear in any log line, `audit_log` metadata, or Railway log drain:

| Never log | Why |
|---|---|
| Passwords or bcrypt hashes | Credential exposure |
| Full JWT tokens | Session hijacking |
| Full email addresses (log `email_prefix` only — first 20 chars + `***`) | GDPR / PII minimisation |
| Full IP addresses in JSONB metadata (truncate to 45 chars for IPv6 max) | GDPR |
| Claude prompt/response content | Patient safety data + PII |
| SQL query parameters (`org.hibernate.type=OFF`) | Sensitive data in WHERE clauses |
| `ANTHROPIC_API_KEY` value | API key exposure |
| `JWT_SECRET` value | Signing key exposure |
| `SMTP_PASSWORD` value | Credential exposure |
| `DATABASE_URL` (contains credentials) | Database credential exposure |
| `bundled-content.json` content | Unnecessary volume |
| Stack traces in API responses to clients | Internal path disclosure |

**In test environments:** SQL logging may be enabled (`SQL_LOG_LEVEL=DEBUG`) but never committed to production config. CI runs with `SQL_LOG_LEVEL=OFF`.

---

## 11. Version History



| Version | Date | Changes |
|---|---|---|
| 1.1 | March 2026 | Added: SQL/Hibernate log suppression config, human-readable event labels (§7.1), CSV export streaming spec (§7.2), What NOT to Log section (§10). AUTH_LOGIN_PASSKEY event type added to taxonomy. |
| 1.1 | March 2026 | QA review fixes: LS-2 MDC userId clearing in JWT filter, LS-3 rate limit hourly query noted as Admin Dashboard KPI sparkline. |
| 1.0 | March 2026 | Initial logging strategy: structured JSON format, MDC correlation, event taxonomy (6 categories, 35+ events), AuditLogger implementation, Admin Dashboard queries, Railway drain config, retention policy. |