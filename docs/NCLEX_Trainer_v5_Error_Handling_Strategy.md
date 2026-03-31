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