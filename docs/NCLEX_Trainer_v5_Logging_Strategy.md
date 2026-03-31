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