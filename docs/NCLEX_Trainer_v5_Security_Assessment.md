# NCLEX Trainer v5 TDD — Security Assessment
**Reviewer:** Security Engineer  
**Document reviewed:** TDD v1.5  
**Date:** March 2026  
**Verdict:** DO NOT BUILD AS WRITTEN — 4 critical issues require resolution before Phase 1 begins

---

## Executive Summary

The TDD has a functional architecture but contains four critical security flaws that would result in a compromised Anthropic API key, unauthorized data access, unbounded spending, and stored XSS exposure within days of deployment. Three of these are in the Claude proxy alone. The auth implementation is workable but incomplete. Several medium issues need addressing before production.

Severity scale: **Critical** (fix before any deployment) → **High** (fix before public access) → **Medium** (fix before v5 ships) → **Low** (fix in v6)

---

## Critical Issues

### CRIT-1: Claude Proxy Has No Authorization Check
**Location:** §12.3 `ClaudeProxyController.kt`  
**Severity:** Critical  
**Impact:** Anyone who finds your API endpoint can make unlimited Claude API calls billed to your Anthropic account

### CRIT-2: Claude Proxy Accepts Arbitrary Request Bodies — Prompt Injection and Model Override
**Location:** §12.3 `ClaudeProxyController.kt`  
**Severity:** Critical  
**Impact:** Attacker can override the model, disable safety settings, inject system prompts, or set max_tokens to 100,000

### CRIT-3: No Rate Limiting Anywhere
**Location:** All endpoints  
**Severity:** Critical  
**Impact:** Credential stuffing on login, brute-force on passwords, API cost exhaustion

### CRIT-4: Stored XSS via JSONB question Column
**Location:** §12.2 Schema  
**Severity:** Critical  
**Impact:** Stored XSS — malicious script stored in DB, executed when any user views flagged questions

---

## High Issues

### HIGH-1: JWT Stored in localStorage — XSS Token Theft
### HIGH-2: No Input Validation on Any Endpoint
### HIGH-3: No HTTPS Enforcement
### HIGH-4: Password Policy Not Defined

---

## Medium Issues

### MED-1: No Token Revocation / Logout
### MED-2: No Ownership Check on Flag Delete
### MED-3: External URL Fetching in Reader is an SSRF Vector
### MED-4: No Audit Logging
### MED-5: history JSONB Grows Without Bound

---

## Summary Table

| ID | Issue | Severity | Location | Effort to Fix |
|---|---|---|---|---|
| CRIT-1 | Claude proxy has no auth check | Critical | §12.3 | 30 min |
| CRIT-2 | Proxy passes arbitrary body to Anthropic | Critical | §12.3 | 2 hrs |
| CRIT-3 | No rate limiting anywhere | Critical | All endpoints | 3 hrs |
| CRIT-4 | Stored XSS via JSONB question field | Critical | §12.2 + frontend | 2 hrs |
| HIGH-1 | JWT in localStorage vulnerable to XSS theft | High | §14 Phase 2 | 1 hr |
| HIGH-2 | No input validation on any endpoint | High | All controllers | 3 hrs |
| HIGH-3 | No HTTPS enforcement specified | High | §12.6 | 30 min |
| HIGH-4 | Password policy not defined, bcrypt 72-byte gotcha | High | §12.4 | 1 hr |
| MED-1 | No token revocation / logout | Medium | §12.4 | 2 hrs |
| MED-2 | No ownership check on flag delete | Medium | FlagsController | 30 min |
| MED-3 | External URL fetching is SSRF vector | Medium | §11.3 | 1 hr |
| MED-4 | No audit logging | Medium | All | 1 hr |
| MED-5 | history JSONB grows without bound | Medium | §12.2 | 30 min |

**Total estimated fix effort: ~22 hours** — add to Phase 1 before any other work.

*This assessment covers the architecture and code snippets as documented in TDD v1.5. It does not constitute a penetration test of any deployed system.*