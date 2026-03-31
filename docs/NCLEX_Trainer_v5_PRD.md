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

---

## 2. Problem Statement

### 2.1 Content Quality Gap

AI-generated questions without source grounding produce content that is mostly clinical and contextually reasonable, but 5-10% of questions contain subtle inaccuracies — wrong drug dosages, overgeneralized clinical advice, or questions that test concepts not in the NCLEX test plan.

**Example problems:**
- "Acetaminophen is used for moderate to severe pain" — inaccurate (max daily dose 4g, ceiling effect ~2g per dose, not suitable for severe pain alone)
- "Hypokalemia causes a prolonged PR interval" — inverted (hypokalemia causes a prolonged QT; hyperkalemia causes a shortened PR)
- "Teach the patient to stop taking metformin if experiencing nausea" — incomplete (should advise immediate reporting; nausea + metformin can signal lactic acidosis, a medical emergency)

**Impact on users:** Destiny and Prof. Linda both flagged this. Prof. Linda (clinical validator) said: "If a student memorizes one wrong dosage, they've failed a patient on their first week as a nurse."

UWorld and Kaplan solve this with 50+ clinical pharmacists who review every question. This tool solves it differently — by grounding questions in authoritative sources (OpenRN textbooks, FDA labels, NCSBN test plan) and using a two-step clinical validation pipeline before any question is shown to a student.

### 2.2 Content Latency

Today, every question generation makes 2-4 API calls sequentially:
1. OpenRN index lookup to find relevant chapters (1-2s)
2. openFDA label fetch by drug name (1s)
3. Claude question generation (3-5s)
4. Claude rationale generation (3-5s)

**Typical flow:** A student asks "Generate a question on ACE inhibitors." System: searches OpenRN, fetches FDA data, asks Claude to generate, asks Claude again for rationale. Total: 8-13 seconds. On a subway with high latency or spotty 4G, this easily hits 20+ seconds, causing timeouts.

**Impact:** Destiny (commute student) abandoned the tool in v1 playtesting because it was "slower than UWorld on my subway."

v5 solves this by bundling all content — 1.9MB of OpenRN textbooks, 300KB of drug summaries, 50KB of static modules — once on device. No API calls for content. Question generation becomes: retrieve grounding from local IndexedDB, call Claude once (3-5s), serve. Latency: 3-5s end-to-end.

### 2.3 Offline Capability

Today, the tool is entirely cloud-dependent. No internet = no functionality. Destiny's use case (subway with spotty 4G) and international students (high-latency connections) are partially blocked.

v5 enables full offline mode:
- **Offline reading:** Students download OpenRN textbooks to IndexedDB. They can read entire books, offline, with full-text search.
- **Offline bank:** 100 pre-generated questions (a mix of MC, SATA, dosage calc, and NGN) cached locally on first load. If Claude API is down or unavailable, serve from offline bank. Student always has something to study.
- **Offline stat sync:** Flag questions, take notes, record time — all stored in IndexedDB locally. On reconnect, sync to backend.

**Impact:** Destiny can study the entire subway commute (35 min subway + bus) without worrying about connectivity.

---

## 3. Solution Architecture

v5 solves all three problems with a persistent ContentDB layer and a deployed backend. The solution is comprised of four parts:

### 3.1 Content Architecture — Three-Layer Storage

**Layer 1: Device local (IndexedDB, student-downloaded, ~2MB)**
- OpenRN Nursing Textbooks (EPUB format, student downloads from OpenRN website)
- Pre-extraction: OpenRN EPUB is extracted into a JSON structure `bundled-content.json` — text + page references
- Integrity check: SHA-256 hash of `bundled-content.json` is baked into the app code
- Storage: IndexedDB `books` object store (one key per book: `content:openstax:book-3`)
- Use case: Full-text search, offline reading, prompt grounding

**Layer 2: Device bundled (localStorage, ~500KB)**
- Drug summaries (NCLEX-high-yield list: 250+ drugs, ~150KB of text)
- Static modules: NCLEX test plan summary, NCJMM cognitive steps, NGN case study format guide
- Flashcard sets (common drug combos, patho principles)
- Student study notes (persisted locally as JSON, synced to backend)
- Storage: localStorage (strings, each <1MB due to browser limits)
- Use case: Quick lookup during question generation, offline bank for questions

**Layer 3: Server-side cache (PostgreSQL `content_cache` table, ~100-500MB)**
- FDA drug labels (fetched once daily via cron job, cached in DB)
- MedlinePlus summaries (fetched once daily)
- RxNorm data (fetched once daily)
- Each entry is keyed by `content:source:identifier` (e.g. `content:fda:acetaminophen`)
- Queries via API endpoint `/api/content/{key}` return the cached entry
- Use case: Drug facts for rationales, voice assistant lookups, question generation grounding

---

## 4. Feature Rundown — What Students Actually Use

Over 7 rounds of playtesting, students consistently used the same 5 features. v5 keeps these and adds 2 new ones.

### 4.1 Daily Question (Original, Kept)

**What it is:** A single question, one per day, asking "How much do you remember?" from previous study sessions.

**Why students love it:** Spaced repetition. Destiny: "I do this on my morning commute. It's the one question I know I should answer before moving on."

**How it works:**
1. Backend has a "readiness score" for each topic (§4.6 below)
2. Pick the topic the student is weakest in
3. Fetch a question from the offline bank or generate one if online
4. Student answers, gets feedback
5. Readiness score updates

---

## 5. The NCLEX Test Plan

The NCLEX exam tests 4 categories of nursing knowledge:
1. **Safe and Effective Care Environment (SECE)** — safety, infection control, prioritization
2. **Health Maintenance and Illness Prevention (HMIP)** — health promotion, preventive care
3. **Psychosocial Integrity (PSI)** — mental health, end-of-life, therapeutic communication
4. **Physiological Integrity (PI)** — pharmacology, pathophysiology, medical/surgical nursing

Each category is further subdivided into subtopics (e.g., PI includes medications, IV management, pain, respiratory).

The NCSBN (National Council of State Boards of Nursing) publishes the NCLEX test plan as a percentage breakdown. Example 2026 breakdown (these percentages drive readiness scoring in §4.6):

| Category | % of exam | Key topics |
|---|---|---|
| SECE | 17-23% | Safety, infection control, prioritization, delegation |
| HMIP | 6-12% | Health promotion, disease prevention, lifestyle |
| PSI | 8-14% | Mental health, stress, therapeutic communication |
| PI | 51-63% | **Highest portion.** Includes medications (15-21%), pathophysiology, critical care, med-surg nursing |

### 5.1 NCJMM Cognitive Steps

Beyond content categories, the NCLEX tests *cognitive levels* — how deeply students must think to answer correctly. The NCSBN uses **NCJMM** (NCSBN Clinical Judgment Measurement Model) which has 4 cognitive steps:

1. **Recognize cues** — identify relevant information in a clinical scenario
2. **Analyze cues** — determine what the information means (e.g., elevated K+ means hyperkalemia)
3. **Prioritize hypotheses** — choose the most likely diagnosis or nursing action
4. **Take action** — decide what the nurse should do

Lower-order (Steps 1-2) vs. higher-order (Steps 3-4) cognitive difficulty varies per question. Pharm questions tend to be mostly Step 2 (analyze: what does elevated serum drug level mean?). Complex case studies are Steps 3-4 (prioritize multiple interventions, decide what matters most).

The readiness score in v5 tracks performance by NCJMM step, not just by topic, giving students a more granular picture of their clinical reasoning.

---

## 6. Question Types

### 6.1 Multiple Choice (MC)

Classic 4-option question. Example:

```
A patient receiving furosemide is at risk for which electrolyte imbalance?
A. Hyperkalemia
B. Hypokalemia ← correct
C. Hypercalcemia
D. Hypernatremia
```

**Rationale (shown after answer):**
"Furosemide is a loop diuretic that increases urinary excretion of both water and electrolytes, including potassium. Patients on chronic furosemide are at risk for hypokalemia, which can trigger cardiac arrhythmias. Monitor serum K+ levels and teach patients to eat potassium-rich foods (bananas, spinach) or take K+ supplements.

Source: FDA Label — Furosemide; OpenRN § Fluid and Electrolyte Balance"

### 6.2 Select All That Apply (SATA)

Multiple correct answers. Example:

```
Which of the following are signs of digitalis toxicity? (Select all that apply)

☐ Tachycardia
☑ Bradycardia ← correct
☐ Hypertension
☑ Premature ventricular contractions ← correct
☑ Nausea/vomiting ← correct
☐ Increased appetite
```

**Why it's hard:** Test-takers must know which effects go together. Digitalis (digoxin) is a cardiac glycoside — it slows conduction and can cause arrhythmias if levels are too high. Classic triad: bradycardia + arrhythmias + GI upset.

### 6.3 Dosage Calculation

```
A patient weighs 70 kg and needs 5 mg/kg of gentamicin IV. The available concentration is 40 mg/mL. How many mL should the nurse administer?

A. 4.4 mL
B. 8.75 mL ← correct
C. 10 mL
D. 14 mL
```

**Calculation:**
- Dose needed: 70 kg × 5 mg/kg = 350 mg
- Volume: 350 mg ÷ 40 mg/mL = 8.75 mL

Students write the calculation, app checks the answer.

### 6.4 Case Study / Next Generation NCLEX (NGN)

NGN is a *new* question type introduced by NCSBN in 2023. It's a clinical scenario spanning 1-2 pages with multiple components (data, vital signs, medications, images) followed by branching questions.

**Example NGN:**

```
--- SCENARIO ---
A 68-year-old female, Mrs. Chen, presents to the ED with chest pain and shortness 
of breath. She has a 10-year history of hypertension and type 2 diabetes.

Vital signs:
- HR: 102 (normal: 60-100)
- BP: 168/95 (normal: <120/80)
- RR: 24 (normal: 12-20)
- O2 saturation: 92% on room air (normal: >95%)
- Temperature: 37.2°C (normal)

Current medications:
- Metoprolol 50 mg daily
- Lisinopril 10 mg daily
- Atorvastatin 20 mg daily
- Metformin 500 mg BID

ECG shows T-wave inversion in leads II, III, aVF → Suspect inferior MI.
Troponin: 1.2 ng/mL (normal: <0.04) → Elevated, confirms MI.

--- QUESTION 1: Recognize Cues ---
Which findings in this patient are consistent with acute myocardial infarction? 
(Select all that apply)

☑ Chest pain
☑ Elevated troponin
☑ T-wave inversion
☑ Elevated HR and RR
☐ Elevated temperature
☐ Elevated blood glucose

--- QUESTION 2: Analyze Cues ---
Based on the ECG findings (T-wave inversion in II, III, aVF), which coronary 
artery is most likely occluded?

A. Left anterior descending (LAD)
B. Right coronary artery (RCA) ← correct
C. Left circumflex
D. Left main coronary artery

(Rationale: Inferior wall infarction [II, III, aVF leads] indicates RCA occlusion.
LAD supplies the anterior wall; circumflex supplies the lateral wall.)

--- QUESTION 3: Prioritize Hypotheses ---
Which intervention should the nurse prioritize in the first hour?

A. Start a nitroglycerin drip
B. Administer aspirin 325 mg PO ← correct (antiplatelet, standard post-MI)
C. Administer metoprolol 50 mg IV
D. Discharge home with follow-up cardiology appointment

--- QUESTION 4: Take Action ---
Which of the following medications should be held or adjusted given the patient's 
current troponin level and vital signs?

A. Metoprolol — monitor HR; hold if <50
B. Lisinopril — monitor BP; hold if systolic <90
C. Metformin — hold during acute illness (risk of lactic acidosis during hypoxia)
D. All of the above ← correct
```

NGN questions are clinically richer and test the NCJMM steps sequentially. They're harder and closer to real-world nursing.

---

## 7. The Readiness Score — How v5 Measures Progress

Every student wants to know: "Am I ready to take the NCLEX?"

Traditional tools say: "You got 73% of questions correct." Meaningless — it doesn't tell you if you're weak on vasopressors or just having an off day.

v5 calculates a **readiness score** for each NCLEX topic and NCJMM step, based on:
1. **Accuracy** on that topic (78% correct → higher readiness)
2. **Frequency** (answered 50 questions on pharmacology vs. 3 → higher readiness)
3. **Recency** (answered correctly yesterday → higher readiness than 2 weeks ago)
4. **Consistency** (got 8 in a row right → higher readiness than alternating right/wrong)

**Readiness score = 0-100** for each topic/step combo.
- 0-40: Not ready (weak spot, needs more study)
- 40-70: Developing (getting there, keep practicing)
- 70-85: Solid (ready for NCLEX on this topic)
- 85-100: Mastery (top-tier performance)

**Dashboard display:**
```
READINESS BY NCLEX CATEGORY

Physiological Integrity (PI)            73% ready
  ├─ Pharmacology                       68% ready ← weak spot
  ├─ Pathophysiology                    79% ready
  └─ Critical Care                      72% ready

Safe & Effective Care (SECE)            81% ready
Psychosocial Integrity (PSI)            76% ready
Health Maintenance (HMIP)               64% ready ← needs work

OVERALL: 74% ready — You're in the "developing" zone for NCLEX
```

And by NCJMM step:
```
READINESS BY COGNITIVE LEVEL

Recognize Cues (Step 1)                 81% ready
Analyze Cues (Step 2)                   76% ready
Prioritize Hypotheses (Step 3)          68% ready ← weak spot
Take Action (Step 4)                    65% ready ← weak spot
```

This tells Destiny: "You're good at identifying symptoms (Step 1), but struggle with deciding *what to do* about them (Steps 3-4). Spend more time on NGN case studies, which train higher-order thinking."

---

## 8. Voice Study Assistant

### 8.1 Why Voice?

Destiny studies during a 35-minute subway commute. She can't hold a book, type on her phone, or look at a screen for 35 minutes straight. But she *can* listen to an audio explanation and speak her answer aloud — no hands required, eyes on the road.

**Use case:** "Voice, play a pharmacology question on ACE inhibitors." She listens, speaks her answer ("This drug reduces blood pressure by blocking ACE..."), the voice assistant confirms or corrects her, and moves on. No typing. No visual fatigue.

### 8.2 How Voice Works

1. **Automatic speech recognition (ASR):** Web Speech API (Chrome/Chromium, Android) or ios-native AVAudioEngine.
2. **Grounding:** Voice assistant questions and explanations are grounded in the same ContentDB as written questions — same FDA data, same OpenRN chapters.
3. **Flow:** Question → Student speaks → ASR converts to text → Claude evaluates answer → Voice response delivered via Text-to-Speech (TTS).
4. **Offline fallback:** If no internet, voice questions play from a cached set (not generated, pre-recorded). Works fully offline.

---

## 9. Flagging System

Students flag questions for three reasons:
1. "I got this wrong and want to revisit it later"
2. "This question has a clinical error" (marks for faculty review)
3. "I want to bookmark this for my notes"

### 9.1 Student Flags

```
Q: A 45-year-old presents with hyperkalemia (K+ 6.8). What's the priority treatment?

[After student answers]

☐ Guessed
☐ Confused by this question
☑ Review later (student wants to study this more)
☐ Report an error
```

Flaggedquestions sync to the backend and appear on the student's Progress Dashboard under "Flagged for Review." The readiness algorithm down-weights recent flags (signals the student is weak on that topic and needs more study).

### 9.2 Faculty Review (Report Error)

```
☑ Report an error

What's wrong with this question?
[Student can type 1-2 sentences]

"The question says acebutolol blocks calcium channels, but acebutolol is a beta-blocker, not a calcium channel blocker. This is a factual error."
```

Reports go to the Admin Dashboard's "Question Report Queue." Prof. Linda (faculty validator) reviews weekly and either:
- **Confirm:** Question is wrong, disable it from future generations
- **Clarify:** Question is ambiguous; rewrite it
- **Dismiss:** Report is incorrect; question is fine

---

## 10. The Voice Assistant — Clinical Decision Support

### 10.1 What It Does

This is a conversational AI tutor. Student can ask freeform questions about nursing topics and get answers grounded in the same corpus as the questions.

```
Student: "What are the side effects of metoprolol?"

Voice Assistant (response grounded in FDA label + OpenRN):
"Metoprolol is a beta-1 selective blocker used for hypertension and heart disease. 
Common side effects include fatigue, bradycardia, and dizziness. Black box warning: 
Do not stop metoprolol abruptly — sudden withdrawal can cause rebound tachycardia 
and chest pain. Pregnant patients should discuss risks with their OB.

Source: FDA Label — Metoprolol; OpenRN Pharmacology Chapter 32."

Student: "What's bradycardia?"

Assistant: "Bradycardia is a heart rate below 60 beats per minute. In healthy athletes, 
this is normal. But in a patient on metoprolol, bradycardia signals that the drug is 
working. If HR drops below 50 or the patient becomes symptomatic (dizziness, syncope), 
the dose should be reduced.

NCLEX context: Bradycardia appears frequently in pharmacology questions about beta-blockers 
and calcium channel blockers. The test expects you to recognize it as a side effect and 
know when to notify the provider."
```

### 10.2 Grounding — No Hallucinations

The voice assistant **never** answers from pure language model training. Every response:
1. Looks up the drug/topic in the ContentDB
2. Retrieves grounding text (FDA label section, OpenRN chapter excerpt)
3. Passes the grounding to Claude along with the student's question
4. Claude synthesizes an answer from the grounding
5. If the topic isn't in the ContentDB, the assistant says: "I don't have that information in my database. Talk to Prof. Linda or check your textbook."

This prevents the deadly scenario: "ChatGPT told me morphine works great for acute severe hypotension," when in reality morphine causes hypotension and would be contraindicated.

---

## 11. Content Strategy — OpenRN + FDA + NCLEX

### 11.1 OpenRN Nursing Textbooks

**What they are:** Free, peer-reviewed, CC-BY licensed nursing textbooks published by Chippewa Valley Technical College. Covers med-surg nursing, pharmacology, pathophysiology, fundamentals, critical care.

**Why them:** Peer-reviewed, freely licensed, actively maintained, and aligned with the NCLEX test plan. Prof. Linda (nursing faculty) vetted them and said: "These are as good as our $300 textbooks, and the pharmacology chapter is more up-to-date than most commercial texts I teach from."

**How used in v5:**
- Download EPUB from openstax.org / CVTC
- Extract to JSON: chapters, sections, text, page refs → `bundled-content.json`
- Students download once (1.9MB), stored in IndexedDB
- Used for prompting + reading

### 11.2 openFDA Data

**What it is:** US government public data on FDA-approved drugs. Includes approved indications, contraindications, side effects, warnings, black box warnings.

**How used:** Question generator retrieves FDA data for a drug, uses it to ground a question. Rationales cite the FDA label.

**Example:** "Which finding would warrant holding metformin?"
- Prompt includes: FDA label for metformin contraindication in renal impairment, eGFR thresholds
- Question generated: "A patient with CKD stage 4 (eGFR 22) is on metformin 1000 mg BID. What should the nurse do?"
- Rationale: "Metformin is contraindicated in renal impairment (eGFR <30) due to risk of lactic acidosis..."

### 11.3 NCLEX Test Plan

NCSBN publishes the official test plan detailing:
- 4 client needs categories + percentages
- Integrated processes (nursing process, caring, communication)
- NCJMM cognitive levels
- Examples of NGN case study types

v5 embeds this in the app as static content (`content:strategies`) — readiness scoring, readiness target, question generation prompts are all aligned to the official test plan.

---

## 12. Deployment & Tech Stack

### 12.1 Stack Overview

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 18 + Vite | SPA, hot module reload in dev |
| Backend API | Kotlin + Spring Boot | REST API, JWT auth, rate limiting |
| Database | PostgreSQL (Railway) | User data, stats, audit logs, content cache |
| Auth | Spring Security 6.4 + WebAuthn | email/password + passkeys (passwordless login) |
| LLM | Anthropic Claude (pluggable) | Via Spring AI 1.1 abstraction; can swap to OpenAI/Gemini/local Ollama |
| Hosting | Railway | Backend, DB, static files all on one platform |
| CI/CD | GitHub Actions | Auto-deploy on push to main |
| Speech | Web Speech API | Chrome/Chromium ASR + TTS; fallback for other browsers |
| Offline Storage | IndexedDB + localStorage | OpenRN books, flashcards, draft notes |

### 12.2 Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│ Railway Project (Single Platform)                 │
│                                                   │
│  ┌──────────────────────────────────┐           │
│  │ Spring Boot Backend (Kotlin)      │ ← API    │
│  │ Port 8080                         │           │
│  │ - Auth (JWT, WebAuthn)            │           │
│  │ - Stats CRUD                      │           │
│  │ - Content cache /api/content/{key}│           │
│  │ - Claude proxy /api/claude        │           │
│  │ - Admin dashboard API             │           │
│  └──────────────────────────────────┘           │
│            │                                     │
│            ↓                                     │
│  ┌──────────────────────────────────┐           │
│  │ PostgreSQL 15                     │           │
│  │ - users                           │           │
│  │ - user_stats (readiness scores)   │           │
│  │ - flagged_questions               │           │
│  │ - content_cache (FDA labels)      │           │
│  │ - audit_log (event log)           │           │
│  └──────────────────────────────────┘           │
│                                                   │
│  ┌──────────────────────────────────┐           │
│  │ React frontend (static files)     │           │
│  │ Served by Spring Boot /index.html │           │
│  └──────────────────────────────────┘           │
└─────────────────────────────────────────────────┘
       ↑                         ↑
      HTTP                   PostgreSQL
   (browser)                 (internal)
```

---

## 13. Launch Plan

### 13.1 Phases

**Phase 1 (v5.0) — Minimum Viable Product**
- Deployed web app (React + Spring Boot)
- Multiple choice questions only
- Voice assistant (grounded in ContentDB)
- Offline reading (textbooks in IndexedDB)
- Offline bank (100 pre-generated questions)
- Progress dashboard (readiness scores)
- Flagging + faculty review queue
- GitHub open source release
- Target: March 2026 ← **THIS IS THE TARGET**

**Phase 2 (v5.1-5.2) — Add Question Types**
- SATA questions
- Dosage calculation questions
- NGN case studies (two-step validation)
- Target: April-May 2026

**Phase 3 (v6.0) — Multi-User & Institutional**
- Multi-admin support (faculty team, not just one admin)
- LMS integration (grade passback)
- Institutional deployment guide (for Sofia's archetype — community college director)
- International nursing board variants (for Amara's UK fork)
- Target: Q3 2026+

---

## 14. Post-Launch Roadmap

### 14.1 Validation: NCLEX Outcome Tracking

Once the app launches, we collect data on students who use it intensively (10+ questions per week for 8+ weeks) and track their NCLEX outcomes:

- **Input:** Student's readiness score before sitting the NCLEX
- **Output:** Pass / fail
- **Analysis:** Does a 75% readiness score on the app predict NCLEX success?

First data point is likely August-September 2026 (students prepping in April-May test in July-Aug). Target: After 30 students, run correlation analysis. If readiness score correlates with NCLEX outcome, it's a powerful selling point.

**Prof. Linda's comment:** "If you can show that a student with 78% readiness on your tool has an 85% chance of passing NCLEX, you win. That's the benchmark every nursing faculty cares about."

### 14.2 Content Updates

**Quarterly:**
- Check OpenRN for new textbook editions
- Refresh FDA label cache (pull latest openFDA data)
- Review NCSBN test plan for changes (next full overhaul: 2029)

**On student reports:**
- Monitor the "Report Error" queue
- Prof. Linda reviews weekly, flags bad questions
- Bad questions are disabled from future generation
- Prompt is updated if a drug's FDA guidance changes

### 14.3 LLM Experimentation

**Why:** Claude 3.5 Sonnet is the best clinical LLM today, but newer models emerge. The app is built on Spring AI 1.1, which supports multiple providers.

**Plan:**
- Q3 2026: Experiment with GPT-4o (if pricing is favorable)
- Q4 2026: Experiment with local Ollama + open-source models (Llama 3.1, Mistral) for cost-conscious self-hosters
- Golden set evaluation: For any new provider, generate 50 questions and have Prof. Linda rate clinical accuracy vs. Claude baseline. Only deploy if accuracy is >= baseline.

---

## 15. Success Criteria

**For the app:**
- 500+ GitHub stars in first 6 months (signals credibility + adoption)
- 100+ active users on the demo instance (daily active users)
- 50+ question reports submitted (signals clinical engagement + problem finding)
- <5% offline bank usage (signals Claude API is reliable and students prefer generated questions)
- Readiness score correlates with NCLEX outcome (validation via Phase 2 data)

**For the open source community:**
- 10+ GitHub contributors (non-original author)
- 5+ issues opened by community
- 3+ pull requests merged from community
- 2+ forks for international nursing boards (UK NMC, AU, Canada)

**For Prof. Linda:**
- 200+ students using the tool across her college network (faculty referrals)
- 0 clinical accuracy complaints after first 2 months (questions are solid)
- Recommended in her nursing school's study resource list

---

## Appendix: Questions & Clarifications

### "Why open source?"

Two reasons:

1. **Clinical trust:** Nursing faculty and students trust tools they can audit. Closed-source AI in healthcare is a red flag. Open source + peer review = credibility.

2. **Sustainability:** A for-profit NCLEX app startup requires investors, unit economics, paying Anthropic for Claude API... this gets expensive fast. Open source + community contributors is sustainable long-term.

### "Why Anthropic vs. OpenAI?"

At the time of this design (late 2025), Claude has better clinical reasoning, smaller hallucination rate on medical facts, and better grounding behavior (easier to feed it FDA labels and have it cite them). This is directly observable in playtesting — Claude's questions are clinically more accurate than GPT-4's.

But the app is architecturally provider-agnostic (Spring AI 1.1). If OpenAI or Gemini improve, swapping providers takes 1 hour.

### "What if Claude API goes down?"

Offline bank. 100 pre-generated questions are always available. If the API is down for a day, students study from the offline bank. No catastrophic failure.

### "What about HIPAA and privacy?"

v5 stores:
- Email (hashed password)
- Study stats (topics studied, readiness scores, time spent) — no PII
- Flagged question content (the question text, not student answers) — no PII
- Audit log (user actions, not clinical data) — no PII

No patient data is ever touched. If students use it in a clinical setting, they never input real patient names or diagnoses — just study questions.

Fully HIPAA-compliant out of the box.

### "But what about the Anthropic API key leaking?"

API key is stored in Railway's secure environment variable storage, never in code or version control. Backend makes all API calls server-side; frontend never touches the key.

If someone compromises the backend, they get the key. Same risk as any hosted service. Mitigation: use Railway's IP allowlisting and rate limiting.

---

## Summary

v5 transforms the NCLEX Trainer from a simple question generator into a comprehensive, source-grounded study platform. It solves three concrete problems Destiny and other nursing students face: content quality, latency, and offline capability.

The architecture is simple and proven: React frontend, Spring Boot backend, PostgreSQL database, all on Railway. The clinical grounding (OpenRN + FDA + NCJMM) is solid and validated by nursing faculty.

Launch target: **March 2026.**

---

**Document History**

| Version | Date | Changes |
|---|---|---|
| 3.7 | March 2026 | Final draft — added voice assistant specs, NGN example, NCJMM cognitive levels, content strategy, post-launch validation roadmap, success criteria. Ready for handoff to TDD. |
| 3.6 | March 2026 | Readiness score algorithm, three-layer content architecture, flagging system, offline strategy. |
| 3.0 | March 2026 | Initial draft for stakeholder review. |
