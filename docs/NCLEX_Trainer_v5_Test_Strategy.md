# NCLEX Trainer v5 — Test Strategy
**Author:** QA Lead  
**Version:** 1.2  
**Date:** March 2026  
**Coverage Targets:** Line ≥90% | Branch ≥90% | Instruction ≥90%

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