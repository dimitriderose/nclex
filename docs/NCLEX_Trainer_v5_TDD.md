# NCLEX Trainer v5 — Technical Design Document

**Author:** Solutions Architect  
**Version:** 4.1  
**Date:** March 2026  
**Status:** Draft — Updated

---

## 1. Overview

This document describes the technical architecture for NCLEX Trainer v5. The primary change from v4 is the introduction of a persistent ContentDB layer that replaces per-question live API calls with a locally-indexed corpus of nursing education content. All existing UI modes, question types, scoring logic, and voice assistant features carry forward with targeted improvements.

**Deployment:** Standalone web app — Railway (backend + DB + static files)
**Frontend:** React + Vite SPA
**Backend:** Kotlin + Spring Boot — Claude API proxy, auth, user data CRUD
**Database:** Railway PostgreSQL — user stats, flags, reading positions
**Content storage:** IndexedDB (textbooks, device-local) + localStorage (static modules, drug summaries, flashcards) + PostgreSQL content_cache (FDA labels, MedlinePlus, RxNorm — server-side)
**AI:** Pluggable LLM via Spring AI 1.1 — Anthropic Claude (default), OpenAI, Gemini, or Ollama (local). Provider selected by `LLM_PROVIDER` env var. API keys never in browser. Frontend always calls `/api/claude` — provider swap is backend-only.
**Auth:** Email + password + optional passkey (WebAuthn/FIDO2). JWT in HttpOnly cookie on success. bcrypt for passwords. Spring Security 6.4+ native WebAuthn support.
**Speech:** Web Speech API (SpeechRecognition + SpeechSynthesis, graceful fallback)