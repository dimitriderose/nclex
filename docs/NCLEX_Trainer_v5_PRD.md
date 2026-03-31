# NCLEX Trainer v5 — Product Requirements Document

**Author:** Product Manager  
**Version:** 3.7  
**Date:** March 2026  
**Status:** Draft — Updated

---

## 1. Executive Summary

The NCLEX Trainer is an AI-powered study tool for nursing students preparing for the NCLEX-RN exam. Over seven rounds of playtester feedback, the tool has evolved from a simple question generator (v2, avg 5.0/10) to a comprehensive prep platform with voice assistance and NGN case studies (v4+, avg 8.8/10).

Version 5 is both a content architecture rebuild and a deployment upgrade. The app moves from a Claude.ai artifact to a standalone deployed web application — React + Vite frontend, Kotlin + Spring Boot backend, Railway PostgreSQL database, all deployed on Railway.

The content problem it solves: today every question makes live API calls to openFDA, MedlinePlus, and Claude at generation time, creating latency and shallow content grounding. v5 replaces this with a persistent ContentDB layer: OpenRN and OpenStax textbooks downloaded once to IndexedDB on device; curated drug summaries and static modules bundled in localStorage; FDA labels and government API data cached in PostgreSQL and served via API.

The deployment upgrade enables real cross-device persistence: a student who studies on her phone during her commute picks up exactly where she left off on her laptop at home. Stats, flagged questions, and reading positions all sync via the backend. The Anthropic API key moves server-side, never exposed in the browser. Authentication supports both email/password and passkeys (WebAuthn/FIDO2) for passwordless login.

The question modes, scoring engine, voice assistant, flagging system, and NGN case study structure all carry forward from v4.