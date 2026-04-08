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
AI-generated questions without source grounding produce content that is mostly correct but lacks the clinical precision of faculty-reviewed material. Pharmacology questions may miss black box warnings. NGN case studies may use unrealistic lab values. A student preparing for a licensing exam deserves questions grounded in the same sources their nursing professors use.

### 2.2 Latency Problem
Every question currently requires 1-3 live API calls before Claude can generate. On a spotty mobile connection this can take 15-22 seconds. While prefetching partially addresses this, it only helps after the first question and only when the predicted topic matches what's actually needed.

### 2.3 Session Persistence
Stats, topic scores, streaks, and session history reset on every page reload. Students cannot track progress across days. The adaptive weak-area system has no memory.

### 2.4 NGN Content Thinness
The current NGN mode generates case studies from 15 hardcoded topics entirely from Claude's training data. No real unfolding cases from faculty-authored sources. No bow-tie or trend items. No custom topic input.

### 2.5 Incomplete Source Integration
RxNorm drug interaction data is not used. DailyMed is referenced in OpenRN textbooks but not integrated. Full OpenRN chapter content (not just summaries) is never fetched. OpenStax NGN-specific unfolding cases are untouched.

### 2.6 UWorld Parity Gap
The benchmark for NCLEX prep quality is UWorld — the tool Destiny, our primary user, explicitly compares against. UWorld's strengths: 2,700+ clinician-written questions, per-option rationale explanations, CAT simulation, pass probability scores, spaced repetition, and visual diagrams. v5 must meet or exceed these specifically: per-option rationale quality, readiness scoring, spaced repetition for flagged questions, timed exam simulation, and NCJMM step analytics. Our differentiators over UWorld: infinite AI-generated questions grounded in authoritative sources, voice assistant with ContentDB grounding, hands-free mode, deeper drug corpus, native textbook reader, and NCJMM step tracking by individual question.

### 2.7 Voice Assistant Grounding Gap
The v4 voice assistant answers from Claude's general training knowledge. It has no access to the specific sources the questions are built on. A student who asks "what does OpenRN say about digoxin toxicity?" gets a Claude-generated answer, not the actual OpenRN text. This creates a trust gap — the assistant and the questions are not drawing from the same pool of knowledge. The assistant also has no NCLEX focus enforcement, meaning it can discuss general medical topics unrelated to exam preparation, diluting its value as a study tool.

---

## 3. Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Eliminate per-question API latency | Time to first question — returning user | < 1s from app open to first question |
| First-device setup | Time to first question — new device | < 5s (Phase 1 bundle loads, then study immediately) |
| Ground all questions in authoritative sources | % of questions with verified source attribution | 100% |
| Cross-session persistence | Stats available on next session open | Yes |
| NGN topic coverage | Number of available case study topics | 40+ |
| Voice assistant grounding | % of assistant responses citing a specific indexed source | 100% |
| Voice assistant focus | Assistant refuses to answer non-NCLEX questions | Yes |
| Playtester score | Average across Destiny, Prof. Linda, Marcus | ≥ 9.0/10 |
| Prof. Linda specifically | Her score | ≥ 9.0/10 |
| NCLEX Readiness Score accuracy | Readiness score correlates with actual performance | Students scoring "High" should pass at >85% rate |
| NCJMM step analytics | Track accuracy by cognitive step, not just topic | All 6 steps tracked and displayed |

---

## 4. Users

### 4.1 Primary — Destiny R. archetype
Recent nursing grad preparing to retake NCLEX-RN. Studies on phone during commute. Needs fast load times, SATA practice, dosage calculations, and voice-assisted study. Low tolerance for friction. Benchmark: UWorld.

### 4.2 Secondary — Nursing faculty (Prof. Linda archetype)
Recommends tools to pre-licensure students. Evaluates academic credibility of content sources. Requires NGN format fidelity, correct SATA partial credit scoring, and clinical accuracy in pharmacology questions.

### 4.3 Tertiary — Self-directed learner (Marcus archetype)
Second-career or accelerated BSN student. Analytical, tracks own performance data, wants to understand why answers are right/wrong. Expects data integrity and transparent source attribution.

---

## 5. Feature Requirements

### 5.1 ContentDB — Persistent Source Database

**P0 — Must have**

The ContentDB is the foundation of v5. It is split across three storage layers:

- **IndexedDB (device-local)** — OpenRN and OpenStax textbook text, downloaded by the student on first use. No size limit (unlike localStorage). Same content for every student — never synced to server. One OpenRN textbook is ~1.9MB of text / ~470K tokens; IndexedDB handles this cleanly where localStorage cannot.
- **localStorage (device-local)** — lightweight content only: 15 static modules (labs, formulas, delegation, drug summaries, etc.), user-generated flashcards, study guide bookmarks, offline question bank, device preferences, `db:meta`, `sync:pending`. Total estimated ~500KB — well within the 5-10MB limit.
- **Railway PostgreSQL** — two purposes: (1) all user-specific data (stats, flags, reading positions, flashcard queue) synced across devices; (2) server-side content cache for FDA drug labels, MedlinePlus summaries, and RxNorm data — indexed once at deploy time, served to clients via `/api/content/{key}`.

**Why FDA labels move to PostgreSQL:**
One OpenRN textbook alone is ~1.9MB of text. FDA labels for ~300 drugs at ~15KB each = ~4.5MB. Together they would exceed the 5-10MB localStorage limit. FDA labels are the same for every student — there is no reason to re-index them per device. They are indexed once by the developer at deploy time and served from the database.

**Why drug NCLEX summaries stay in localStorage:**
Prof. Linda's curated drug summaries in `NCLEX_Drug_List_Prof_Linda.md` are compact clinical reference data — hold parameters, black box warnings, nursing considerations — averaging ~300-500 bytes per drug. 319 drugs × ~400 bytes = ~130KB total. These are bundled with the app and stored in localStorage as `content:drug_nclex:{drugname}`. Question generators use these for context. The full FDA label is only fetched from the server when the voice assistant needs deep drug detail.

**Session startup — two completely different flows:**

```
App opens → authenticated?
  No  → Login / register screen
  Yes → db:meta exists in localStorage?
          No  → FIRST-DEVICE SETUP   (once per device, ~90 sec)
          Yes → RETURNING SESSION    (every subsequent login, < 1 sec)
```

**Returning user session (every login after first-device setup):**
This is the normal case — any student who has opened the app on this device before. Zero indexing, zero API calls, no waiting.
1. Validate HttpOnly cookie (~200ms)
2. `GET /api/stats` — load topic scores, streak, readiness score (~200ms)
3. Render home screen — student is studying within 1 second

All ContentDB content is already in localStorage. Nothing is re-fetched, nothing is re-indexed. This addresses the playtester question directly: **returning users never see an indexing screen.**

**First-device setup (once per device, never repeated):**
Triggered only when `db:meta` is absent in localStorage — brand-new account or new device.

- Display "Building your content library" full-screen
- **Phase 1 — instant (~2 seconds):** Load all bundled static modules into localStorage: 15 content keys (labs, formulas, strategies, drug summaries, drug suffixes, delegation, communication, diagnostics, health equity, development, infection control, herbals, IV fluids, vaccines). Student can start drilling MC, SATA, and pharmacology questions immediately — drug NCLEX summaries are already available.
- **Phase 2 — user-triggered (one-time download):** "📥 Download textbooks for offline use" prompt. Student taps to download OpenRN and OpenStax EPUB text into IndexedDB. Each book ~1.9MB text. This unlocks NGN cases and deep content reader for that book. Student can skip and use the app without offline textbook access.
- **Phase 3 — transparent (every session):** FDA labels, MedlinePlus, and RxNorm are fetched from the PostgreSQL content_cache via `/api/content/{key}` as needed — no download, no indexing, no waiting. The developer indexed these once at deploy time.
- Write `db:meta` with `version`, `indexedAt`, per-source `status: "ok"` — this skip flag prevents setup ever running again on this device.
- **Interruptible:** closing mid-setup saves partial progress. On next open, only sources with `status: "partial"` or missing are re-fetched.

**What is never re-indexed on login:**
- OpenRN / OpenStax bundled content — only updates on app version release
- All 15 static modules — same
- FDA labels with TTL > 90 days
- RxNorm with TTL > 180 days

Manual refresh is always available from the Content Admin screen if the student wants updated drug labels.

**2026 NCLEX-RN Test Plan alignment (effective April 1, 2026):**
All content modules are aligned to the current 2026 NCLEX-RN Test Plan. Key 2026-specific content:
- Health equity and SDOH — new explicit emphasis, covered in `content:health_equity` and OpenStax indexed content
- Updated terminology throughout: "Safety and Infection Prevention and Control", "substance misuse"
- NGN question types unchanged from 2023 — all 14 types still in effect
- OpenRN and OpenStax source materials updated to 2023 NCLEX-RN test plan; OpenStax updated January 2026

**Content indexed:**

**IndexedDB (device-local — student downloads on first use):**

| Key Pattern | Source | Content |
|---|---|---|
| `content:openrn:{topic}` | OpenRN EPUB (student downloads, pre-extracted) | Chapter text, learning activities, SATA scenarios, clinical cases. One book ~1.9MB text / ~470K tokens — requires IndexedDB, not localStorage |
| `content:openstax:ngn:{topic}` | OpenStax Nursing EPUB (student downloads, pre-extracted) | NGN unfolding case studies, NCJMM-aligned questions |

**localStorage (bundled with app — instant, ~500KB total):**

| Key Pattern | Source | Content |
|---|---|---|
| `content:drug_nclex:{drugname}` | Bundled — `NCLEX_Drug_List_Prof_Linda.md` | Curated NCLEX summary per drug: hold parameters, black box warnings, nursing considerations, drug class. ~300-500 bytes/drug × 319 drugs = ~130KB total |
| `content:drug_suffixes` | Bundled static | Drug naming patterns — 20+ suffixes/prefixes mapping to drug class, mechanism, NCLEX concern |
| `content:static:{category}` | Bundled static | Herbal supplements (8), IV fluids (7), vaccines (7) — not FDA-regulated |
| `content:labs` | Bundled static | Normal lab value ranges, ABG interpretation, therapeutic drug levels |
| `content:formulas` | Bundled static | Dosage calculation formula bank |
| `content:strategies` | Bundled static | 2026 NCLEX test plan, CAT algorithm, NGN types, exam day procedures |
| `content:diagnostics` | Bundled static | Pre/post-procedure nursing care for high-yield procedures |
| `content:communication` | Bundled static | Therapeutic communication framework |
| `content:delegation` | Bundled static | RN/LPN/UAP scope, 5 rights of delegation, priority frameworks |
| `content:health_equity` | Bundled static | SDOH 5 domains, health disparities, unbiased care, 2026 test plan emphasis |
| `content:development` | Bundled static | Erikson/Piaget stages, motor/language milestones, developmental red flags |
| `content:infection_control` | Bundled static | Standard precautions, contact/droplet/airborne, C. diff, PPE, sterile technique |
| `db:meta` | Internal | ContentDB version, download status per book — skip gate for returning sessions |

**PostgreSQL content_cache (server-side — indexed once at deploy, served via `/api/content/{key}`):**

| Key Pattern | Source | Content |
|---|---|---|
| `content:fda:{drugname}` | openFDA REST API | Full drug label: indications, warnings, adverse reactions, contraindications, dosage. ~15KB/drug × ~300 drugs = ~4.5MB — too large for localStorage, same for all users |
| `content:medline:{topic}` | MedlinePlus API | Full health topic summary |
| `content:rxnorm:{drugname}` | RxNorm API | Drug class, interactions, related drugs |

**Content Admin screen:**
- Accessible from home screen
- Shows each source: last indexed, item count, storage size
- "Refresh all" and per-source refresh buttons
- Shows when a source failed to index with retry option

### 5.2 Question Generation — Source-Grounded

**P0 — Must have**

All question generation must pull context from ContentDB rather than making live API calls:

- **MC questions**: Pull relevant OpenRN chapter excerpt + MedlinePlus summary from DB; for Management of Care and Health Promotion questions, also pull from `content:health_equity` to generate SDOH-aware scenarios aligned to 2026 test plan
- **SATA questions**: Pull OpenRN learning activity scenarios from DB as question seeds
- **Pharmacology questions**: Pull `content:drug_nclex:{drugname}` from localStorage (curated NCLEX summary — instant, always available) for question context. For deep voice assistant queries, fetch `content:fda:{drugname}` from `/api/content/fda/{drugname}` (full FDA label from PostgreSQL). Herbal supplements, IV fluids, and vaccines use `content:static:{category}` from localStorage.
- **Dosage questions**: Pull FDA dosage/administration section from DB for realistic dose ranges

**NCJMM step tagging — every question tagged at generation time:**

| Step | What it tests | Example question type |
|---|---|---|
| Recognize Cues | Identify relevant data from chart | "Which findings require immediate follow-up?" |
| Analyze Cues | Connect data to clinical meaning | "Which condition is this patient most likely experiencing?" |
| Prioritize Hypotheses | Rank urgency of problems | "Which is the priority nursing concern?" |
| Generate Solutions | Plan interventions | "Which intervention should the nurse implement?" |
| Take Action | Execute nursing care | "What is the nurse's first action?" |
| Evaluate Outcomes | Assess response to care | "Which finding indicates the intervention was effective?" |

The Claude question generator receives the target NCJMM step as part of the prompt and tags each generated question with it. This enables NCJMM-step performance analytics — a differentiator UWorld cannot offer.
- **NGN case studies**: Use OpenStax unfolding case as structural template + generate patient variation

RxNorm drug interaction data used for pharmacology and dosage questions to add interaction scenarios.

**Rationale quality standard — every question must meet this spec:**

Every answer explanation must address all options, not just the correct one. This is UWorld's single most praised feature and what builds pattern recognition:

```
Correct answer: B — Administer oxygen first
  ✓ B is correct: O2 sat of 88% indicates hypoxemia. Airway/breathing takes priority per ABC framework. Oxygen is the immediate intervention.
  ✗ A is incorrect: Repositioning is appropriate but secondary — airway comes before position.
  ✗ C is incorrect: Calling the provider is appropriate after initiating oxygen — nurse acts first, reports second.  
  ✗ D is incorrect: Pursed-lip breathing is a technique for COPD management, not acute hypoxemia intervention.
  
  NCJMM step tested: Take Action
  Source: OpenRN Fundamentals — Oxygenation
```

The Claude prompt for every question generation must explicitly require:
1. The correct answer with full clinical reasoning
2. Why each wrong answer is plausible but incorrect
3. The NCJMM step this question primarily tests
4. The ContentDB source it drew from

**Question accuracy reporting:**
Every question card has a "⚑ Report" button distinct from the flag system. Tapping it opens a brief form:
- Options: "Clinically incorrect", "Confusing wording", "Wrong answer marked", "Other"
- Optional free-text comment (max 200 chars)
- Submits to `/api/reports` endpoint → stored in a `question_reports` table
- The developer reviews reports via a simple admin view; in v6, build a faculty review portal

This is non-negotiable for a tool that trains nurses. A single clinically incorrect pharmacology question — wrong antidote, wrong hold parameter, wrong contraindication — could reinforce a dangerous clinical habit. The report mechanism must exist at launch.


### 5.3 Pharmacology Drug Corpus

**P0 — Must have**

The pharmacology content is driven by a curated drug list of ~319 high-yield NCLEX drugs compiled and reviewed by a nursing faculty member (Prof. Linda T., MSN, RN, CNE). This is the definitive drug scope for v5 — all pharmacology question generation, voice assistant responses, and dosage calculations draw from this list.

**Drug corpus breakdown:**

| Category | Count | Source for App |
|---|---|---|
| Cardiovascular | 47 | openFDA API |
| Anti-Infectives | 38 | openFDA API |
| Psychiatric and CNS | 35 | openFDA API |
| Respiratory | 14 | openFDA API |
| Neurological | 15 | openFDA API |
| Pain and Opioids | 18 | openFDA API |
| Endocrine | 22 | openFDA API |
| GI and Antiemetics | 16 | openFDA API |
| Oncology and Immunosuppressants | 10 | openFDA API |
| Obstetric and Gynecologic | 12 | openFDA API |
| Hematologic | 6 | openFDA API |
| Renal and Electrolytes | 8 | openFDA API |
| Miscellaneous | 15 | openFDA API |
| Vasopressors and ICU | 7 | openFDA API |
| Urologic and BPH | 5 | openFDA API |
| Additional Antidotes | 5 | openFDA API |
| Additional Ophthalmic | 2 | openFDA API |
| **Herbal Supplements** | **8** | **Static curated — no openFDA** |
| **IV Fluids and Solutions** | **7** | **Static curated — no openFDA** |
| **Immunizations and Biologics** | **7** | **Static curated — no openFDA** |
| **Total** | **~319** | |

**Static content categories** (herbal supplements, IV fluids, vaccines) are not FDA-regulated prescription drugs and return no results from openFDA. These are stored as `content:static:{category}` keys in localStorage — bundled with the app, loaded instantly at Phase 1, no API call required. They are NOT in `content_cache` (which is PostgreSQL-only for FDA/MedlinePlus/RxNorm).

**Cache TTL by category:**
- openFDA drug labels: 90 days (mature drugs rarely change)
- RxNorm drug classes: 180 days (classifications almost never change)
- Static entries (herbal, IV fluids, vaccines): no expiry — update only on app version release

**Reference document:** `NCLEX_Drug_List_Prof_Linda.md` — full list with per-drug NCLEX focus points, organized by category. This document is the source of truth for which drugs are in scope and what NCLEX tests about each one.

### 5.4 NGN Case Studies — v2

**P0 — Must have**

Addresses every playtester complaint about NGN:

**Expanded topics (40+):** Generated from indexed OpenStax content covering all NCLEX client needs categories including OB, pediatrics, psychiatric, med-surg, and community health.

**Custom topic input:** Free-text field on NGN mode card. Student types any condition ("Postpartum Hemorrhage", "Pediatric Asthma") and gets a case study generated on it.

**Case completion screen:** After step 6, display:
- Total score across all 6 steps
- Per-step breakdown (step name, question type, score/result)
- Weakest step highlighted
- "Study this topic" link directly to relevant OpenRN content
- "Try another case" button

**OpenStax-grounded charts:** Patient chart vitals, labs, and nursing notes drawn from indexed OpenStax case study content rather than pure AI generation.

**Bow-tie and trend items:** Deferred to v6. Scope decision — not blocked by any technical constraint. (Mammoth.js is available as a standard npm package; MNWC source documents are accessible. The decision to defer is deliberate.)

### 5.5 Additional Content Modules — Lab Values, Formulas, Test Strategies

**P0 — Must have**

The following content modules are missing from v4 and must be built into v5 ContentDB:

**Lab Values Reference:**
A structured, searchable reference of normal ranges for all commonly tested lab values:
- CBC: WBC, RBC, Hgb, Hct, platelets, differential
- BMP/CMP: sodium, potassium, chloride, CO2, BUN, creatinine, glucose, calcium
- Coagulation: PT/INR, PTT, bleeding time
- Cardiac markers: troponin I/T, BNP, CK-MB
- Therapeutic drug levels: digoxin (0.5-2 ng/mL), lithium (0.6-1.2 mEq/L), phenytoin (10-20 mcg/mL), vancomycin trough (15-20 mcg/mL), theophylline (10-20 mcg/mL)
- ABGs: pH, PaO2, PaCO2, HCO3, O2 sat — with acid-base interpretation framework
- Stored as `content:labs` static key — referenced by voice assistant and question generators

**Dosage Calculation Formula Bank:**
All formulas needed for the dosage calc question mode, stored as structured data:
- Basic: D/H × Q
- Weight-based: mg/kg/day calculations
- IV drip rate: (volume × drop factor) / time
- mL/hr: ordered dose / concentration on hand × 60
- Reconstitution: desired concentration calculations
- Pediatric weight-based dosing with safe dose range checking
- Stored as `content:formulas` static key

**NCLEX Test-Taking Strategies (2026 Test Plan aligned):**
A dedicated content module aligned to the April 2026 NCLEX-RN Test Plan. Stored as `content:strategies` static key — voice assistant teaches these on request.

CAT Algorithm (accurate for 2026):
- Minimum scored questions: 70 (RN); maximum: 135 (RN) — plus 15 unscored pilot questions embedded throughout
- Exam ends when 95% confidence interval rule is met, maximum items reached, or time expires (5 hours RN)
- Three stopping rules: 95% Confidence, Maximum-Length (final ability estimate decides), Run-out-of-time (fail if < minimum answered)
- Getting harder questions = good sign — means CAT estimates your ability is above passing standard
- Number of questions does NOT indicate pass/fail — stop interpreting question count as performance signal
- At question 85 it is NOT over — many students pass or fail at higher counts
- Partial credit scoring (NGN): +/- scoring for SATA, 0/1 for MC, rationale scoring for some NGN items

2026 Test Plan specifics (effective April 1, 2026):
- Content weights unchanged from 2023: Management of Care 15-21%, Safety & Infection Prevention and Control 9-15%, etc.
- Category rename: "Safety and Infection Control" → "Safety and Infection Prevention and Control"
- Terminology update: "substance abuse" → "substance misuse"
- New emphasis: health equity, unbiased care, LGBTQ+ dignity, social determinants of health
- New statement: perform care regardless of culture, ethnicity, sexual orientation, gender identity
- Timing rule removed: the old "1-2 minutes per question" guideline is gone — "maintain a reasonable pace"
- No new NGN question types in 2026; NGN format is now the established standard

NGN question types (all current for 2026):
Case study items (12 types): Matrix multiple-choice, Matrix multiple-response, Multiple-response SATA, Multiple-response Select N, Multiple-response Grouping, Drag-and-drop Cloze, Drag-and-drop Rationale, Drop-down Cloze, Drop-down Rationale, Drop-down Table, Highlight Text, Highlight Table
Stand-alone items (2 types): Bow-tie (condition + 2 actions + 2 monitoring parameters), Trend (analyze patient data over time)

Priority frameworks (embedded in every NGN case):
- Maslow: physiological needs before psychological needs
- ABC: airway before breathing before circulation — always
- Safety before comfort, actual before potential, unstable before stable, acute before chronic
- NCJMM sequence: Recognize Cues → Analyze → Prioritize → Generate → Take Action → Evaluate

Elimination strategies:
- Eliminate options that harm the patient
- When two options seem correct: choose the one addressing higher-priority need
- Assessment before intervention UNLESS patient safety is immediately threatened
- SATA: each option is independent true/false — do not look for patterns or count required selections
- NGN highlight items: highlight only what is clinically significant, not everything abnormal

Exam day (Pearson VUE — current 2026 procedures):
- Arrive 30 minutes early — forfeit appointment if >30 minutes late
- Required ID: government-issued with photo and signature; name must exactly match registration
- Biometrics collected: signature, photo, palm vein scan (new since 2021)
- No personal items in testing room — phone must be stored in sealed Pearson plastic bag
- Provided: on-screen calculator, erasable note board and marker
- Two optional breaks after question 30 and question 70 (do not skip — fatigue is real)
- Quick Results available within 48 hours for $7.95 via Pearson VUE (unofficial but highly reliable)
- Official results from state board within 2-6 weeks
- Retake policy: 45-day waiting period between attempts; maximum 8 attempts per year
- Candidate Performance Report (CPR) provided to those who fail — shows relative performance by category
- Remote testing (NCLEX Online): in development by NCSBN, NOT available in 2026 — all testing still in-person at Pearson VUE centers

**Therapeutic Communication Framework:**
High-yield for psychosocial integrity questions:
- Therapeutic techniques: open-ended questions, reflection, clarification, silence, focusing
- Non-therapeutic techniques to avoid: false reassurance, giving advice, defensive responses, changing the subject
- SBAR communication framework
- Stored as `content:communication` static key

**Drug Suffix / Prefix Cheat Sheet:**
One of the most searched NCLEX pharmacology resources — not in any current content module. Students who know drug naming patterns can identify class, mechanism, and expected side effects from an unfamiliar drug name alone.

High-yield suffixes and prefixes:
- `-olol` (e.g., metoprolol, atenolol) → beta-blocker; expect bradycardia, hold if HR < 60
- `-pril` (e.g., lisinopril, captopril) → ACE inhibitor; expect dry cough, hyperkalemia
- `-sartan` (e.g., losartan, valsartan) → ARB; no cough; teratogenic
- `-pine` (e.g., amlodipine, nifedipine) → calcium channel blocker; expect edema
- `-statin` (e.g., atorvastatin, rosuvastatin) → HMG-CoA reductase inhibitor; monitor LFTs, myopathy
- `-parin` (e.g., heparin, enoxaparin) → anticoagulant; monitor for bleeding
- `-mycin` / `-micin` (e.g., erythromycin, gentamicin) → macrolide or aminoglycoside antibiotic
- `-cillin` (e.g., amoxicillin, ampicillin) → penicillin antibiotic; check allergy
- `-floxacin` (e.g., ciprofloxacin, levofloxacin) → fluoroquinolone; tendon rupture risk
- `-azole` (e.g., fluconazole, metronidazole) → antifungal or antiprotozoal
- `-tidine` (e.g., ranitidine, famotidine) → H2 blocker; reduces gastric acid
- `-prazole` (e.g., omeprazole, pantoprazole) → PPI; take before meals
- `-zepam` / `-zolam` (e.g., diazepam, midazolam) → benzodiazepine; CNS depression, dependence
- `-pam` → often benzodiazepine (lorazepam, clonazepam)
- `-tidine` → H2 blocker (ranitidine, famotidine, cimetidine)
- `-mab` (e.g., rituximab, infliximab) → monoclonal antibody; infusion reaction risk
- `-umab` → humanized monoclonal antibody
- `-tinib` (e.g., imatinib, erlotinib) → tyrosine kinase inhibitor (oncology)
- `-gliptin` (e.g., sitagliptin, saxagliptin) → DPP-4 inhibitor; pancreatitis risk
- `-gliflozin` (e.g., empagliflozin, canagliflozin) → SGLT2 inhibitor; UTI/yeast infections
- `-glutide` (e.g., liraglutide, semaglutide) → GLP-1 agonist; pancreatitis risk
- `-triptan` (e.g., sumatriptan, rizatriptan) → migraine; avoid with MAOIs, CAD
- Stored as `content:drug_suffixes` static key

**Pediatric Growth and Development:**
Tested in every NCLEX prep course; missing from all previous versions.
- Erikson's psychosocial stages: trust vs. mistrust (0-1yr) through integrity vs. despair (65+)
- Piaget's cognitive stages: sensorimotor (0-2), preoperational (2-7), concrete operational (7-11), formal operational (12+)
- Motor milestones by age: head control (1mo), rolling (4-6mo), sitting unsupported (6-7mo), crawling (9mo), walking (12-15mo)
- Language milestones: cooing (2mo), babbling (6mo), first words (12mo), 2-word phrases (24mo)
- NCLEX red flags that require follow-up
- Stored as `content:development` static key

**Infection Control and Isolation Precautions:**
Renamed to "Safety and Infection Prevention and Control" in the 2026 test plan — represents 9-15% of exam.
- Standard precautions: hand hygiene, PPE, respiratory hygiene, safe injection practices — apply to ALL patients
- Contact precautions: gloves and gown; examples: C. diff, MRSA, VRE, RSV — private room required
- Droplet precautions: surgical mask within 3 feet; examples: influenza, pertussis, meningitis
- Airborne precautions: N95 respirator; negative pressure room; examples: TB, measles, varicella
- Combination precautions: chickenpox = airborne + contact
- C. diff specific: soap and water (NOT alcohol-based hand sanitizer — spores survive alcohol)
- PPE donning/doffing order: gown → gloves → mask/respirator → goggles (don); goggles → gown → gloves → mask (doff)
- Sterile technique vs. clean technique: which procedures require which
- Stored as `content:infection_control` static key

**Delegation and Prioritization Rules:**
High-yield for management of care:
- RN scope: assessment, teaching, unstable patients, IV push medications, care planning
- LPN/LVN scope: stable patients, routine medications, dressing changes, data collection
- UAP/CNA scope: ADLs, vital signs on stable patients, non-sterile procedures
- Right tasks for delegation: right task, right circumstance, right person, right directions, right supervision
- NCLEX priority frameworks: unstable before stable, acute before chronic, actual before potential
- Stored as `content:delegation` static key

**Health Equity and Social Determinants of Health (NEW — 2026 Test Plan):**
This is the most significant new emphasis in the 2026 NCLEX-RN Test Plan. Health equity is now an explicit clinical skill, not just background knowledge. Questions will present scenarios where social determinants of health affect care delivery and require the nurse to adapt their interventions.

Core concepts:
- Health equity definition: every individual has a fair opportunity to achieve optimal health regardless of social or demographic characteristics
- Social determinants of health (SDOH) — 5 domains (Healthy People 2030): economic stability, education access and quality, health care access and quality, neighborhood and built environment, social and community context
- Health disparities: preventable differences in health outcomes between population groups

NCLEX clinical application (what gets tested):
- Identifying SDOH barriers in patient scenarios: patient lacks transportation → how does this change discharge planning? Patient has limited English → interpreter required, not a family member
- Unbiased care: provide same quality care regardless of race, ethnicity, sexual orientation, gender identity — explicitly named in the 2026 test plan
- Client dignity: maintain privacy and dignity during care — new explicit activity statement
- Social media and confidentiality: recognize scenarios where a nurse inadvertently breaches HIPAA on social media
- Substance misuse (updated from "substance abuse"): recognize non-judgmental, evidence-based terminology

Source alignment: OpenStax Medical-Surgical Nursing §2.3 (Health Equity and Disparities, updated January 2026) and OpenStax Population Health for Nurses Chapter 8 (SDOH, updated January 2026) both have current, CC-BY 4.0 content on this exact topic — already in our downloaded source material.

- Stored as `content:health_equity` static key — also drawn from indexed OpenStax content

### 5.5.1 Diagnostic Tests and Procedures Reference

**P0 — Must have**

Stored as `content:diagnostics` static key. Covers pre- and post-procedure nursing care for all commonly tested diagnostic procedures, aligned with the 2026 NCLEX-RN Test Plan's Reduction of Risk Potential category.

**Imaging Studies:**
- X-ray: no prep needed for most; remove metal; portable for unstable patients
- CT scan without contrast: no prep; reassure claustrophobic patients
- CT scan with contrast: assess for iodine/shellfish allergy; NPO 4 hours; hold metformin 48 hours before/after (lactic acidosis risk); adequate hydration post-procedure; monitor for contrast reaction (hives, dyspnea, hypotension)
- MRI: absolute contraindications — pacemakers, cochlear implants, metallic implants; remove all metal; assess for claustrophobia; IV gadolinium contrast — same hydration precautions
- Ultrasound: bladder ultrasound requires full bladder; obstetric ultrasound may require full bladder in early pregnancy; no radiation
- Nuclear medicine scans (bone scan, V/Q scan): radioactive tracer injection; patient is briefly radioactive — avoid prolonged contact with pregnant women and children post-scan

**Cardiac Tests:**
- ECG/EKG: 12 leads; clean dry skin; no metal; lie still; patient education: painless
- Holter monitor: 24-48 hour continuous ECG; avoid bathing/swimming; keep activity diary
- Echocardiogram: no prep; lie on left side; transesophageal echo (TEE) requires NPO 4-6 hours, sedation, gag reflex monitoring post-procedure
- Stress test (treadmill): wear comfortable shoes; hold beta-blockers if ordered; have crash cart available; stop if chest pain, severe dyspnea, ST changes, BP drop

**Invasive Procedures:**
- Cardiac catheterization (angiography): NPO 4-6 hours; assess contrast allergy; shave/prep insertion site; post: bedrest 2-6 hours depending on closure device; monitor for hematoma, bleeding at insertion site; keep extremity straight if femoral access; monitor pulses, color, temperature distal to insertion site
- Lumbar puncture (LP): lateral fetal position or sitting leaning forward; post: flat for 4-8 hours (controversial but common practice); force fluids; monitor for headache (CSF leak), neurological changes; NEVER perform if signs of increased ICP
- Liver biopsy: NPO; coagulation studies beforehand; post: lie on RIGHT side for 2 hours (tamponade effect); monitor for bleeding, bile peritonitis
- Bone marrow biopsy: posterior iliac crest most common; pressure dressing post-procedure; monitor for bleeding
- Thoracentesis: sit leaning forward over table; post: chest X-ray to rule out pneumothorax; monitor breath sounds; no more than 1000-1500 mL removed at once to prevent re-expansion pulmonary edema
- Paracentesis: bladder must be emptied first; post: monitor for hypotension (fluid shift), albumin may be given for large-volume

**GI Procedures:**
- Upper endoscopy (EGD): NPO 6-8 hours; sedation; post: monitor gag reflex before oral intake; sore throat normal
- Colonoscopy: bowel prep night before (clear liquids, laxatives); post: mild cramping/gas normal; monitor for perforation (severe pain, fever, rigid abdomen)
- Barium swallow/upper GI series: NPO 4-8 hours; post: chalky white stools; force fluids; laxative to prevent constipation
- Barium enema: low-residue diet 1-2 days prior; clear liquids day before; bowel prep; post: same as barium swallow

**Respiratory:**
- Bronchoscopy: NPO 4-6 hours; sedation; topical anesthesia to throat; post: NPO until gag reflex returns; monitor for laryngospasm, hemoptysis, respiratory distress; hoarseness is normal

**Neurological:**
- EEG (electroencephalogram): shampoo hair (no products); sleep-deprived protocol if ordered; avoid caffeine 8-12 hours prior; non-invasive, no post-procedure restrictions
- CT head: as above; if VP shunt present — notify radiology
- MRI brain: as above

**Lab Tests (Collection Notes):**
- 24-hour urine: discard first void, keep all subsequent urine on ice or refrigerated, collect final void at end of 24 hours; post sign in bathroom
- Blood cultures: two sets from two different sites before antibiotics; clean technique; label with time and site
- Peak and trough levels: trough drawn 30 minutes before next dose; peak drawn per specific drug protocol (e.g., gentamicin peak 30 min after IV infusion ends)
- Glucose tolerance test (GTT): NPO after midnight; baseline fasting glucose; drink 75g glucose solution; draw at 1 and 2 hours; no eating, drinking, smoking, or exercise during test

---

### 5.6 Cross-Session Persistence & Auth

**P0 — Must have**

All user-specific data persists in Railway PostgreSQL and syncs across devices via the backend API.

**Authentication — two methods, both supported:**

**Email + password (always available):**
- Required for first-time registration
- Fallback when passkey is unavailable (new device, lost device, account recovery)
- JWT stored in HttpOnly cookie — never in localStorage, never readable by JS

**Passkey (passwordless, optional after registration):**
- Student registers with email + password once, then optionally adds a passkey
- On future logins: biometric or device PIN replaces password — Face ID, Touch ID, Windows Hello
- Faster for mobile use: one tap replaces typing a password during a commute study session
- Built on WebAuthn / FIDO2 — phishing-resistant, no shared secret ever sent to server
- Syncs across devices via iCloud Keychain / Google Password Manager if student enables it
- Requires HTTPS — works automatically on Railway deployment; not testable on plain http://localhost

**Login screen priority:**
1. If passkey registered on this device: show "Sign in with passkey" prominently, email/password below
2. If no passkey: show email/password form with "Add a passkey after login" prompt on success

**Passkey management (Settings screen):**
- List all registered passkeys with label and last used date
- Add new passkey (triggers WebAuthn registration ceremony)
- Remove passkey (with confirmation — cannot remove last auth method if no password exists)
- Labels: browser autofills device name ("iPhone 15", "MacBook Pro") — student can rename

- No OAuth for v5 — add Google/GitHub login in v6

**Data persisted per user (PostgreSQL):**
- Topic accuracy scores per NCLEX category
- Total questions answered, correct, streak, best streak
- Session history log (last 200 questions with topic, type, result, timestamp)
- Flagged questions with category (Guessed / Confused / Review later)
- Last studied date per topic
- Reading positions per content key
- NGN cases completed and per-step accuracy

**Data stored in IndexedDB (device-local, large):**
- OpenRN and OpenStax textbook text — downloaded by student on first use, ~1.9MB per book

**Data stored in localStorage (device-local, lightweight ~500KB):**
- 15 bundled static content modules (labs, formulas, strategies, drug NCLEX summaries, drug suffixes, etc.)
- User-generated flashcards and study guide bookmarks
- Offline question bank (100 pre-generated questions)
- Device preferences (theme, font size, brief/full mode)
- `db:meta` — ContentDB book download status
- `sync:pending` — offline stat update queue

Note: JWT is stored in an HttpOnly cookie set by the server — not in localStorage.

Stats panel on home screen updated to show "All time" vs "This session" toggle, pulling from PostgreSQL on load.



### 5.7 UX Improvements

**P0 — Must have**

- **Skeleton loading screens** replacing generic spinners — show question card outline while loading
- **Named source badges on every question** — "📗 OpenRN · Pharmacology" shown under each question
- **NGN loading feedback** — "Building patient chart (1/2)..." → "Writing clinical questions (2/2)..." 
- **Topic accuracy bars** on home screen showing all-time performance per topic
- **Streak calendar** — 7-day visual showing study consistency
- **Exam countdown** — shown on home screen when exam date is set: "14 days to your NCLEX" with a progress bar. Set via /settings Study Preferences.
- **Daily goal progress** — "23 / 30 questions today" progress bar based on daily goal set in /settings. Disappears when goal is reached.
- **Progress shortcut** — tapping the readiness score badge on the home screen navigates to the full /progress dashboard
- **Study Guides hub** — dedicated "Study" tab on home screen listing all ContentDB modules as named study guides organized by NCLEX Client Needs category. Student taps any guide and enters full-screen reader mode directly. No need to go through a question to access content.

**P1 — Should have**

- **Expanded flagging** — flag with category: "Guessed", "Confused", "Review later"
- **Question difficulty indicator** — Easy / Medium / Hard badge based on source difficulty rating

### 5.7.0 Question Accuracy Reporting — P0

**Added per Prof. Linda's review:** There is no human review layer on AI-generated questions. A clinically incorrect question can train nurses on wrong reasoning. This is a patient safety issue.

Every question card has a **"⚠️ Report question"** button distinct from the flag system. Tapping it opens a modal:
```
Report this question
[ ] Clinically incorrect answer
[ ] Wrong rationale
[ ] Outdated information  
[ ] Confusing / poorly worded
[ ] Other: [text field]
[Submit Report]
```

Reports are stored in a `question_reports` PostgreSQL table with the full question JSON, report category, freetext, user ID, and timestamp. The Content Admin screen shows a **"Reports: N unreviewed"** badge. The developer reviews reports via the Content Admin screen (no separate portal needed for v5). Questions with 2+ reports on the same issue are auto-flagged in the admin view.

This is P0 — it must ship at launch. Incorrect clinical content would make Prof. Linda refuse to recommend this tool.

### 5.7.1 NCLEX Readiness Score — P0

A running readiness estimate displayed on the home screen, updated after every session. Mirrors what UWorld calls "pass probability" — the metric students check obsessively.

**Calculation inputs (all available from PostgreSQL stats):**
- Overall accuracy across all sessions
- Topic accuracy weighted by NCLEX category percentage (Management of Care 17%, Pharmacology 16%, etc.)
- NCJMM step accuracy — gaps in Prioritize Hypotheses weighted more heavily (most common failure point)
- Recency weighting — last 100 questions weighted more than older history
- Weak topic trend — improving or declining

**Display:**
```
NCLEX Readiness
[===========----]  68%

🟡 On Track — Keep studying
Weakest area: Prioritize Hypotheses (41%)
Weakest topic: Management of Care (52%)
Exam date: 14 days away
Recommended: 45 questions/day
```

**Minimum threshold before display:**
The readiness score does not display until the student has answered at least **50 questions across at least 3 different NCLEX categories**. Before this threshold, show: "Answer 50 questions across 3 topics to unlock your Readiness Score." This prevents misleading scores from tiny sample sizes — 5 questions all answered correctly would show 100%, which is useless and potentially harmful.

**Readiness bands:**
- 🔴 Below 55% — Needs significant work
- 🟡 55-70% — On track, focused study needed
- 🟢 70-80% — Strong, refine weak areas
- ✅ 80%+ — High confidence, maintain consistency

### 5.7.2 Study Plan Generator — P0 (upgraded from P1)

UWorld has a static study planner. Ours is dynamic — generated from actual weak areas and exam date.

**Inputs:** exam date (student enters once), topic accuracy by NCLEX category AND by drug class / condition (one level below category), NCJMM step accuracy, session history, time available per day (15 / 30 / 60 / 90 min)

**Output:** daily schedule with specific drug class / condition focus — not just broad NCLEX categories. "Pharmacology — 10 questions" is too vague to be actionable. The plan must drill down: "Cardiac drugs — beta-blockers" or "Endocrine — insulin management." Regenerates after each session as performance data updates.

```
Today's Plan — 10 days to exam
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Priority: Delegation & Prioritization (52%) — 15 questions
🟡 Reinforce: Cardiac drugs — beta-blockers & ACE inhibitors — 10 questions
🟠 Review: Fluid & Electrolytes — hypokalemia — 5 questions
📖 Read: OpenRN Management Ch. 4 — Delegation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Est. time: 50 min
```

The plan uses drug class data from `content:drug_nclex:{drugname}` (class field) and condition tags from question history to identify specific sub-topic weaknesses, not just the 8 broad NCLEX categories.

### 5.7.3 Spaced Repetition for Flagged Questions — P0

UWorld has spaced repetition flashcards. We have flagging but no re-surfacing logic. Every flagged question must reappear on a schedule:

- **"Confused" flag**: resurface after 1 day, then 3 days, then 7 days
- **"Guessed" flag**: resurface after 3 days, then 7 days
- **"Review later" flag**: resurface after 7 days
- **Mastered**: if answered correctly 3 times in spaced repetition, auto-archive from active queue

The home screen shows a "Due for review" count badge. Clicking opens a focused mode serving only spaced-repetition due questions.

**AI-generated flashcards from rationales:**
Every rationale has an "Add to flashcard +" button. Tapping it sends the rationale to Claude, which extracts the single most important clinical fact and generates a clean front/back card automatically. No manual typing required.

```
[Student taps "+" after getting heparin antidote question wrong]

Claude generates:
  Front: What is the antidote for heparin overdose?
  Back:  Protamine sulfate — 1mg neutralizes 100 units of heparin
         Source: openFDA — heparin label

[Card added to spaced repetition queue — due tomorrow]
```

Cards are stored in the `flagged_questions` table with type `flashcard`, distinct from the question-flag queue. They follow the same spaced repetition schedule but display in a classic flip-card format rather than as a full question with answer options.

### 5.7.4 NCJMM Step Performance Analytics — P0 (differentiator vs UWorld)

UWorld shows accuracy by NCLEX category. We show accuracy by both category AND NCJMM cognitive step. This is something UWorld explicitly cannot do — and the research confirms it's the gap students most need filled.

**Stats panel additions:**
- New tab: "Clinical Judgment" alongside existing "Topics" tab
- Radar chart or bar chart showing accuracy across all 6 NCJMM steps
- Highlight: "Your weakest step is Prioritize Hypotheses at 38% — this affects ALL topics"
- Link: "Practice Prioritize Hypotheses questions" → filtered question mode

This works because every generated question is tagged with its primary NCJMM step at generation time (§5.2).

### 5.7.5 Timed Exam Simulation Mode — P0 upgrade

Current PRD mentions exam mode but doesn't specify fidelity. For students to build exam-day stamina, the simulation must be accurate:

- **Timer**: 5-hour countdown visible in corner (dismissible but not hidden)
- **No going back**: once a question is submitted, it cannot be revisited (mirrors real NCLEX)
- **No rationales until end**: rationales locked during exam mode, revealed in full report afterward
- **Question count**: 85-150 questions (student selects or auto-stops at 95% confidence simulation)
- **End-of-exam report**: topic breakdown, NCJMM step breakdown, readiness score update, per-question review with rationales
- **Interface**: clean minimal UI matching Pearson VUE aesthetic — no drawer, no voice assistant, no reader during exam mode

### 5.8 Voice Assistant — Full ContentDB Grounding

**P0 — Must have**

The voice assistant is fundamentally redesigned in v5. In v4 it answered questions from Claude's general training knowledge with the current question as context. In v5 it answers exclusively from the indexed ContentDB — OpenRN textbook text, OpenStax case content, FDA drug labels, MedlinePlus summaries, and RxNorm drug class data. It is a closed-domain assistant: it only knows what is in the database, and it knows all of it.

**Core behavior change:**

| v4 Behavior | v5 Behavior |
|---|---|
| Answers from Claude training knowledge | Answers only from ContentDB corpus |
| Generic "study assistant" persona | NCLEX-RN specialist grounded in specific sources |
| No source attribution in responses | Every response cites the source it drew from |
| Knows nothing about indexed drug labels | Knows every indexed FDA label by name |
| Generic clinical advice | Tied specifically to NCLEX test plan and NCJMM |
| No student performance awareness | Knows full session history, topic scores, streaks |
| Gives answers freely | Guides toward answers; only reveals when student is struggling |

**What the assistant knows (from ContentDB):**
- All OpenRN chapter content across all 8 NCLEX topics
- All OpenStax NGN unfolding case study content
- Full FDA label for every drug in the indexed set (warnings, contraindications, adverse reactions, nursing considerations, dosage)
- RxNorm drug class and interaction data for all indexed drugs
- MedlinePlus full summaries for all indexed topics
- The student's current question, topic, weak areas, and session performance
- Full cross-session history: topic accuracy, streak, questions answered, last studied dates

**Student progress awareness:**
The assistant has full visibility into the student's performance data at all times:
- **Topic accuracy per NCLEX category** — knows if she's at 85% on Pharmacology but 42% on Management of Care
- **Recent wrong answers** — knows which topics she missed in the last session
- **Streak and consistency** — knows if she hasn't studied a topic in 5 days
- **Flagged questions** — knows which questions she marked as "Guessed" or "Confused"
- **NGN case performance** — knows which NCJMM steps are weak (e.g., consistently misses Prioritize Hypotheses)

The assistant proactively uses this data: if she asks about heart failure and her Physiological Adaptation score is 48%, the assistant says so and suggests she drill that topic before her exam.

**Answer-withholding by default (Socratic teaching model):**
The assistant does not give answers unless the student has demonstrated genuine struggle. The progression:

1. **First ask**: Guide with a question — "What's your primary concern when you see an O2 sat of 91%?"
2. **Second ask (same question)**: Narrow the hint — "Think about the ABC framework. Which comes first?"
3. **Third ask (same question)**: Provide the reasoning path — "The answer relates to airway/breathing priority. Now can you identify which option addresses that?"
4. **Struggling threshold** (3+ wrong answers on same topic in session, or explicit "I don't know / just tell me"): Provide the full explanation with rationale

Struggle signals that trigger full explanation:
- Student says "I give up", "just tell me", "I don't understand", "I don't know"
- Student has gotten 3+ questions wrong on this topic in the current session
- Student has flagged 2+ questions on this topic as "Confused"
- Student has < 50% accuracy on this topic across all sessions

**Resource surfacing — DB and online:**
The assistant actively recommends resources when it detects confusion or weakness:

*From ContentDB — opens in native reader (always checked first):*
- "The OpenRN Pharmacology chapter on cardiovascular drugs covers this in detail — tap to read it now." → opens reader to that chapter
- "Your indexed MedlinePlus entry for heart failure has a good summary — tap to read it." → opens reader to that card
- "The FDA label for metoprolol covers contraindications in detail — tap to read it." → opens reader to FDA card

*Readable external content — opens in native reader:*
- **DailyMed**: for drugs beyond the indexed set — fetched and rendered in the native reader
- **OpenRN chapters**: already in ContentDB from downloaded source — opens instantly in native reader
- **MedlinePlus full articles**: deep dives beyond the indexed summaries — fetched and rendered
- **Any publicly accessible nursing reference URL** — fetched, cleaned, rendered in reader

*Video resources — link-out only (cannot be read):*
- **YouTube channels**: RegisteredNurseRN, SimpleNursing, Level Up RN, Ninja Nerd Nursing — link-out to browser with specific search query
- Always provide the exact search query: "Search 'RegisteredNurseRN heart failure NCLEX' on YouTube"
- Never attempt to embed or display YouTube content in the reader

*Interactive/auth-required — link-out only:*
- **NurseAchieve NCSBN sample pack** — requires account, link-out
- **nclex.com exam preview** — interactive, link-out
- **Maryland MNWC test bank** — link-out if not scraped

The assistant never recommends paid tools (UWorld, Kaplan, ATI) unless the student explicitly asks. When recommending any resource, state what it covers and why it's relevant to NCLEX. For readable resources, the recommendation renders as a tappable card that opens the reader directly.

**Named source lookup commands:**
Students can ask the assistant to retrieve specific content from the database:
- *"What does OpenRN say about digoxin toxicity?"* → assistant pulls `content:openrn:pharmacology`, finds digoxin, quotes the relevant passage
- *"Show me the FDA warnings for warfarin"* → assistant pulls `content:fda:warfarin`, reads the warnings section
- *"What drug class is metoprolol?"* → assistant pulls `content:rxnorm:metoprolol`
- *"Explain the Recognize Cues step"* → assistant pulls NCJMM step definition from indexed NCJMM content
- *"What am I weak on?"* → assistant reads topic scores and identifies bottom 3 topics with specific drill recommendations
- *"What should I study today?"* → assistant analyzes weak areas, last studied dates, and session history to recommend a focused study plan

**Hands-free commute mode:**
- Toggle in voice assistant header
- When enabled: auto-reads each new question aloud when it appears
- Auto-activates mic after reading for 3 seconds (listens for voice answer or question)
- Reads rationale aloud after answer is submitted
- Designed for phone-in-bag, earbuds-in study sessions

**Brief/Full mode (carried from v4):**
- Brief (default): 2-3 sentence responses optimized for commute listening
- Full: complete explanation with source citations, for seated study sessions

**System prompt size and latency:**
The full ContentDB corpus injected into the system prompt at conversation start is ~8-10K tokens. This does NOT increase per-message latency — system prompts are processed once at conversation start, not on each message. The cost implication is ~$0.024 per conversation start (8K tokens × $0.003/1K input tokens). This is acceptable. Static module excerpts are loaded from localStorage (sync, instant). Drug detail for the current question is fetched from `/api/content/fda/{drugname}` if needed. Textbook excerpts are loaded from IndexedDB.

**Why the excerpt approach is a hard architectural constraint, not a choice:**
The standard Sonnet 4.6 API tier has a 200K input token context window. The full ContentDB corpus is ~500K tokens (~2MB) — this physically exceeds the 200K limit and cannot be injected regardless of cost. The excerpt-based approach (~8-10K tokens per conversation start) is the only viable design on the standard tier. It fits comfortably within 200K alongside conversation history, and costs ~$0.024 per start.

**What the assistant explicitly does NOT do:**
- Discuss clinical topics not covered in the indexed sources
- Give free answers to questions the student hasn't genuinely tried
- Answer questions about other nursing exams (NCLEX-PN, HESI, ATI)
- Provide general health or medical advice unrelated to NCLEX content
- Recommend paid prep tools unprompted
- Speculate beyond what the indexed sources say

**Response format requirements:**
- Every response must end with a source citation: "— OpenRN Pharmacology 2e" or "— openFDA label: [drug name]" or "— MedlinePlus: [topic]"
- If the answer cannot be found in indexed sources, say so and recommend where to look
- Responses must always relate back to NCLEX clinical judgment framework (NCJMM steps or NCSBN Client Needs categories)
- When recommending resources, include what the resource covers and why it's relevant to NCLEX

---

### 5.9 Integrated Content Reader

**P0 — Must have**

A native content reader built directly into the trainer renders all readable study material — OpenRN chapters, OpenStax case studies, MedlinePlus summaries, FDA drug labels, and any fetchable external URL (DailyMed articles, nursing reference pages, etc.) — without leaving the app.

**What is readable vs. link-out:**

| Content | Treatment |
|---|---|
| OpenRN textbook chapters | Native reader — text already in ContentDB |
| OpenRN textbook full EPUB | Download to device Downloads folder (student's existing viewer) |
| OpenRN textbook full PDF | Download to device Downloads folder (student's existing viewer) |
| OpenStax NGN case studies | Native reader — text already in ContentDB |
| MedlinePlus health topic summaries | Native reader — structured card view |
| FDA drug labels | Native reader — formatted card (not raw regulatory text) |
| DailyMed drug pages | Native reader — fetches and renders the URL |
| Any fetchable article/URL | Native reader — fetches and renders |
| YouTube videos | Link-out only — cannot be read, opens in browser |
| NurseAchieve / nclex.com | Link-out only — requires auth or interactive content |

**Library tab — dedicated textbook browser:**

A **Library** tab in the main navigation gives students direct access to all 6 OpenRN textbooks independent of any active question or voice assistant session. Each book entry shows three actions:

- **Read online** — opens the full textbook in the native ContentReader (fetches from Pressbooks/NCBI, requires internet)
- **Download EPUB** — triggers browser `<a download>` to the student's Downloads folder
- **Download PDF** — triggers browser `<a download>` to the student's Downloads folder

Downloaded files open in the student's existing PDF/EPUB viewer on their device. The app does not manage or store downloaded files — they live in the Downloads folder like any other downloaded document. This is intentional: no IndexedDB blobs, no Origin Private File System, no file management UI needed.

For Destiny: download once on Wi-Fi, read the full pharmacology chapter on the subway from her Files app with no internet required.

**Placement — context-sensitive:**

- **During question drilling modes** (Daily Practice, SATA, Dosage, Exam, NGN): right-side drawer on desktop (~65% screen width), bottom sheet on mobile (~60% viewport height). Slides in without displacing the active question. Student can read and answer simultaneously.
- **During Study Topic mode**: full-screen primary view. The reader is the main interface; a fixed "Practice Questions →" button at the bottom transitions to drilling.
- **Trigger points**: "📖 Read" button on every question card (opens to auto-matched chapter), source attribution badges (opens that specific source), and voice assistant recommendations (tapping a recommended resource opens the reader directly to it).

**Reader features (native, no external dependency):**
- Paginated view (~400 words per page) — no infinite scroll on mobile
- Three themes: light, sepia, dark — controlled by toggle in reader header
- Adjustable font size (3 sizes: small, medium, large)
- Reading position saved to `db:stats` per content key — resumes where student left off
- Topic breadcrumb: "OpenRN › Pharmacology › Cardiovascular Drugs"
- "Ask assistant about this" button — opens voice assistant panel pre-filled with context about what the student is reading

**Auto-matching logic:**
When the reader is triggered from a question, it automatically opens to the chapter that matches the question's NCLEX topic. Student does not need to navigate. If the question topic is "Pharmacology" and the drug is metoprolol, the reader opens to the OpenRN cardiovascular drugs chapter AND shows the indexed FDA metoprolol label as a sidebar card.

**Voice assistant → reader integration:**
When the assistant recommends a readable resource, the recommendation message renders as a tappable card rather than plain text. Tapping opens the reader to that exact content. This makes the assistant's recommendations immediately actionable rather than descriptive.

**External URL fetching:**
For content not in ContentDB (DailyMed drug pages, nursing reference articles), the reader fetches the URL, strips navigation/ads using `DOMParser`, and renders clean text in the same paginated interface. Reading position for external content is saved by URL hash.

**YouTube — link-out only:**
YouTube videos cannot be rendered in the reader. The assistant recommends them with a specific search query ("Search 'RegisteredNurseRN heart failure NCLEX' on YouTube"). Tapping opens YouTube in a new browser tab. No attempt is made to embed or proxy video content.

---

## 5.10 Deployment & Infrastructure

**Deployment target:** Standalone web application, fully deployed on Railway.

**Stack:**

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite | SPA, served as static files |
| Backend | Kotlin + Spring Boot | Claude API proxy, auth, user data CRUD |
| Database | Railway PostgreSQL | User stats, flags, reading positions, content_cache (FDA/MedlinePlus/RxNorm) |
| Batch job | Spring Boot @Scheduled | 90-day content_cache refresh + quarterly textbook reminder email |
| Textbook storage | Browser IndexedDB | OpenRN + OpenStax text — student-downloaded, device-local |
| Static content | Browser localStorage | Drug summaries, static modules, flashcards, offline bank — ~500KB |
| Content cache | Railway PostgreSQL | FDA labels, MedlinePlus, RxNorm — server-indexed, served via API |
| Hosting | Railway | Single platform for backend + DB + static files |

**Backend API surface:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/register` | POST | Create account |
| `/api/auth/login` | POST | Login, returns JWT |
| `/api/claude` | POST | Proxy to Anthropic API (key server-side) |
| `/api/stats` | GET / PUT | Load / save user stats |
| `/api/flags` | GET / POST / DELETE | Flagged questions |
| `/api/reading` | GET / PUT | Reading positions per content key |

**Auth:** Email + password, JWT, bcrypt password hashing. No OAuth for v5.

**Environment variables (Railway):**
- `ANTHROPIC_API_KEY` — never exposed to browser
- `DATABASE_URL` — Railway PostgreSQL connection string
- `JWT_SECRET` — token signing key
- `CORS_ORIGIN` — frontend URL

**No auth = no access:** All `/api/stats`, `/api/flags`, and `/api/reading` endpoints require a valid JWT. The Claude proxy endpoint also requires auth to prevent API key abuse.

---

### 5.11 Offline Mode — P1

**Why this matters for Destiny specifically:** Subway commutes, spotty mobile signal, airplane mode study sessions. Destiny failed once and is retaking — she cannot afford to lose study time to bad connectivity.

**What works offline vs what requires internet:**

| Feature | Offline? | Notes |
|---|---|---|
| Questions from offline bank | ✅ Yes | Pre-generated during last online session |
| Spaced repetition review | ✅ Yes | Queue stored locally |
| Flashcard review | ✅ Yes | Stored locally |
| ContentDB reading (OpenRN, drug labels, study guides) | ✅ Yes | Already in localStorage |
| Stats viewing | ✅ Yes | Cached locally |
| Stats syncing | ⏳ Queued | Sync when connection restores |
| New AI question generation | ❌ No | Requires Claude API |
| Voice assistant | ❌ No | Requires Claude API |
| FDA/MedlinePlus re-indexing | ❌ No | Requires API access |

**Offline bank — 100 questions pre-generated:**

The app silently pre-generates 100 questions in the background and stores them in localStorage as `content:offline:bank`. The bank regenerates **once per day maximum** — if the bank was generated in the last 24 hours it is not regenerated, even if the student has multiple sessions. Bank generation triggers on session end if: (a) no bank exists, OR (b) bank was last generated more than 24 hours ago.

**Cost model:** ~100 questions × ~$0.003/question = ~$0.30 per student per day for offline bank generation. At 100 daily active users = ~$30/day. Acceptable at this scale. If DAU grows beyond 1,000, implement a tiered approach: generate 50 questions instead of 100 for users who rarely go offline (detected from sync queue history).

Bank composition (based on topic weights and weak areas from stats):
- 20 MC questions covering the student's 3 weakest topics
- 20 SATA questions (high NCLEX frequency)
- 15 pharmacology questions (rotated through drug list)
- 15 dosage calculation questions
- 15 NGN case study questions (pre-generated full 6-step case)
- 15 mixed topic MC questions

**Offline question flow:**
```
Student opens app — no internet detected
→ "Offline Mode" amber banner shown at top
→ Question counter: "Offline bank: 87 questions available"
→ All drilling modes work normally — pull from bank instead of generating live
→ Correct/incorrect recorded locally in pending sync queue
→ Spaced repetition queue, flashcards, ContentDB reader all work normally
→ Voice assistant panel shows: "Voice assistant requires internet connection.
   Your content library and offline questions are fully available."
→ New question generation button disabled with explanation
```

**Stats sync queue:**
Stat updates accumulated while offline are stored in `localStorage` as `sync:pending`. When internet connection restores (detected via `navigator.onLine` event + a lightweight fetch probe), the app automatically flushes the pending queue to PostgreSQL in the background. Student never manually syncs.

```javascript
// Pending sync entry shape
{ type: "stats_update", payload: { ...statsSnapshot }, timestamp: "..." }
{ type: "flag_add", payload: { question: {...}, category: "Confused" }, timestamp: "..." }
{ type: "flag_delete", payload: { id: "uuid" }, timestamp: "..." }
```

**Sync queue limits and batching:**
- Maximum queue size: 500 entries. If queue reaches 500, oldest `stats_update` entries are consolidated (only keep the most recent stats snapshot — intermediate snapshots are redundant).
- On flush, operations are batched: all `stats_update` entries collapsed to one final PUT; flag operations sent individually (they're not batchable). Maximum 50 operations per flush attempt to avoid timeout.
- If flush fails after 3 retries, show a non-blocking warning: "Some study data couldn't sync. Will retry when connection improves." 

**Connectivity detection:**
```javascript
// Two-layer detection — navigator.onLine can lie
async function isOnline() {
  if (!navigator.onLine) return false;
  try {
    await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

// Listen for changes
window.addEventListener('online', () => flushPendingSync());
window.addEventListener('offline', () => showOfflineBanner());
```

**Service Worker (optional enhancement):**
A lightweight Service Worker can cache the app shell (HTML, JS, CSS) so the app loads instantly even without network — no app store required. This is a P1 enhancement within offline mode, not a requirement.

**What offline mode does NOT do:**
- Does not generate new questions via AI
- Does not run the voice assistant
- Does not re-index ContentDB (FDA/MedlinePlus calls)
- Does not guarantee the offline bank is always full (if student never had an online session, bank is empty)

**First-run note:** On first use, the student must complete onboarding online. Offline mode becomes available after the first full online session.

---

### 5.12 Roles and Admin Dashboard — P0

**Two roles: `user` and `admin`.** Every account is `user` by default. Admin is assigned manually via PostgreSQL on first deploy. There is one admin in v5 — the developer/owner.

**Admin route:** `/admin` — same React app, role-gated. If a `user` role account navigates to `/admin`, they receive a 403. The route is not exposed in any UI element for non-admin users.

**How admin is assigned (v5):**
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```
Run once via Railway PostgreSQL console after first deploy. No self-service admin promotion exists.

---

#### 5.12.1 User Management

Full CRUD on all user accounts.

| Action | Detail |
|---|---|
| View all users | Email, role, created date, last active, total questions answered, readiness score |
| Search / filter | By email, by role, by date range, by readiness band |
| Edit user | Email, role (promote/demote admin), exam date |
| Reset password | Admin sets a temporary password; student must change on next login |
| Revoke passkeys | Admin can remove all passkeys from a user account (e.g. lost device recovery) |
| View passkeys | List of registered passkeys per user with labels and last used dates |
| Delete account | Soft-delete — marks account inactive, anonymizes PII. Hard-delete available separately. |
| View user stats | Full stats snapshot: topic scores, NCJMM step scores, session history, flagged questions |
| Impersonate (read-only) | Admin can view exactly what the student sees — their home screen, readiness score, study plan. No write access in impersonation mode. |

---

#### 5.12.2 KPI Dashboard

Real-time metrics pulled from PostgreSQL. Auto-refreshes every 60 seconds.

**User Growth & Engagement:**
- Total registered users
- Daily / Weekly / Monthly Active Users (DAU/WAU/MAU) — based on `last_studied`
- New registrations last 7 / 30 days
- Retention: % of users who return within 7 days of registration
- Streak distribution (histogram: 0, 1-3, 4-7, 7+ day streaks)

**Content Quality:**
- Total questions answered (all users, all time)
- Question type breakdown: MC / SATA / NGN / Dosage (pie chart)
- Average readiness score across all users with ≥ 50 questions
- Readiness band distribution: % in each band (Needs Work / On Track / Strong / High Confidence)
- Weakest NCJMM step across all users (aggregate step accuracy)
- Top 5 weakest NCLEX topics across all users
- Unreviewed question reports count (link to report queue)

**Cost Metrics:**
- Claude API calls today / this week / this month
- Estimated API cost: calls × avg tokens × $3/MTok
- Rate limit hits today + 24-hour sparkline (hourly breakdown from audit_log — indicates abuse or attack pattern)
- Content cache last refresh: date, entries refreshed, failures
- Offline bank generations today (cost: ~$0.30/generation)

**Testing / Content Metrics:**
- NCJMM step tag accuracy proxy: % of questions on a given step that are reported as "Clinically incorrect" or "Wrong rationale" — a high report rate on one step suggests the generator prompt is tagging that step incorrectly
- NGN completion rate: % of started NGN cases that reach step 6
- Most-reported drug names (signals FDA label quality issues)
- Most-flagged question topics (signals content gaps)

---

#### 5.12.3 Question Report Queue

The full review interface for "⚠️ Report question" submissions — replaces the badge count placeholder in the existing Content Admin screen.

| Column | Detail |
|---|---|
| Submitted | Timestamp |
| User | Email (anonymized: first 3 chars + ***) |
| Category | Clinically incorrect / Wrong rationale / Outdated / Confusing / Other |
| Comment | Student's freetext |
| Question | Full question text + all options + rationale |
| NCJMM Step | Step tag on the reported question |
| Topic | NCLEX category |
| Actions | Mark reviewed ✓ / Flag for fix 🔧 / Dismiss ✗ |

Questions with 2+ reports in the same category are highlighted in amber. Questions with 3+ reports are highlighted in red and sorted to the top.

Admin can filter by: unreviewed only, by category, by topic, by date range.

---

#### 5.12.4 Audit Log Viewer

Searchable, paginated view of the `audit_log` table.

Events shown:
- AUTH events: login, failed login, registration, logout, password reset
- CLAUDE calls: user ID, context (question_gen / voice_assistant / flashcard_gen), timestamp
- RATE_LIMIT hits: endpoint, user ID, timestamp
- CACHE_REFRESH: entries refreshed, failures, duration
- ADMIN actions: any admin CRUD on users is logged with admin user ID

Filters: by event type, by user email, by date range.
Export: CSV download for any filtered result set.

---

#### 5.12.5 Content Admin (Expanded)

The existing Content Admin screen (cache status, refresh buttons) is merged into the Admin Dashboard as a tab. Additions:

- Textbook download status per book (which students have downloaded which books)
- Content cache table: all entries with key, source, indexed_at, TTL remaining
- Manual re-index button per source (triggers immediate refresh outside the 90-day schedule)
- Last batch job run: timestamp, refreshed count, failure count

**Textbook usage analytics** — zero new data collection, aggregated from existing `reading_positions` table:

| Book / Chapter | Readers | Avg page reached | Notes |
|---|---|---|---|
| content:openrn:pharmacology | 12 | 4.2 | |
| content:openstax:ngn:medsurg | 15 | 1.0 | Drop-off after page 1 |
| content:openrn:fundamentals | 8 | 2.1 | |

If a chapter has many readers but low average page, the content may be too dense or the reader UX has friction. If a book has zero downloads, the download prompt may need to be more prominent. This data directly informs which OpenRN editions to prioritize updating in the quarterly textbook review.

---

### 5.13 Account Management & Student Progress Dashboard — P0

---

#### 5.13.1 Multi-Device Passkeys

Each device registers its own passkey credential stored as a separate row in `user_credentials`. A student with an iPhone and a MacBook has two passkeys — one per device, each with its own label. This is the default WebAuthn design — no additional complexity beyond what is already specced in §5.6.

The Settings screen shows all registered passkeys individually (not as a single toggle), enabling per-device management.

---

#### 5.13.2 Account Management (Settings Screen)

A dedicated `/settings` route accessible from the home screen header. Sections:

**Profile**
- Display name (shown on home screen greeting — optional, defaults to email prefix)
- Email address — change requires current password confirmation + re-authentication
- Current password — change requires current password + new password (min 8 chars)

**Passkeys**
- List of all registered passkeys: device label, last used date, registered date
- "Add passkey on this device" button — triggers WebAuthn registration ceremony
- Per-passkey remove button — confirmation dialog; blocked if this is the only remaining auth method (no password set, no other passkeys)
- Device labels are auto-filled on registration (iPhone, MacBook, etc.) but student can rename

**Study Preferences**
- Exam date — used by Study Plan Generator; shows countdown on home screen
- Daily study time goal: 15 / 30 / 60 / 90 min
- Preferred question mode default (MC / Mixed / NGN)

**Danger Zone**
- Delete account — see §5.13.4

---

#### 5.13.3 Student Progress Dashboard

A dedicated `/progress` route. Accessible from home screen. Full-screen view of study analytics.

**Section 1 — Readiness Score Trend**
Line chart showing readiness score over time. Toggle: 7 days / 30 days / 90 days / Full history.
Requires daily snapshot storage — see TDD §12.2 `readiness_history` table.
Shows: score line, readiness band color zones (red/yellow/green/blue), exam date marker if set.
Empty state: "Answer 50 questions across 3 topics to unlock your readiness trend." No blank chart.

**Section 2 — Study Calendar**
Monthly calendar view. Each day shows:
- Studied: colored tile (darker = more questions answered that day)
- Not studied: empty tile
- Streak indicators: current streak highlighted
Navigation: previous/next month arrows. Current month default.
Data source: `session_history` entries grouped by date.
Empty state (new user, no sessions yet): calendar renders with all empty tiles and a prompt: "Start studying to fill in your calendar." 

**Section 3 — Topic Breakdown**
Horizontal bar chart: all 8 NCLEX Client Needs categories.
Each bar shows: accuracy % + questions answered.
Color-coded: < 60% red, 60-79% yellow, ≥ 80% green.
Tappable: opens drill-down to practice that topic.
Empty state: "Answer questions in each topic to see your breakdown."

**Section 4 — NCJMM Step Breakdown**
Same bar chart format for all 6 cognitive steps.
Highlights weakest step with a callout: "Focus area: Prioritize Hypotheses (41%)"
Tappable: tapping any step bar launches a drill session filtered to that NCJMM step — consistent with topic bars.
Empty state: "Answer questions to see your NCJMM step breakdown."

**Section 5 — Question Volume**
Summary stats:
- Total questions answered (all time)
- Breakdown by type: MC / SATA / NGN / Dosage (pie or donut chart)
- Questions answered this week vs last week (trend arrow)
- Average session length in questions
Empty state: "No questions answered yet. Start drilling to see your stats."

**Section 6 — Flagged Queue Summary**
- Confused: N questions due for review
- Guessed: N questions
- Review later: N questions
- Flashcards due: N
- "Start review session" button — launches spaced repetition mode
Empty state: "No flagged questions yet. Flag questions while drilling to build your review queue."

---

#### 5.13.4 Account Deletion — GDPR / CCPA Compliant

Both GDPR Article 17 (right to erasure) and CCPA grant users the right to request deletion of their personal data. Hard delete is required — anonymization alone does not satisfy either regulation.

**Flow:**
1. Student taps "Delete my account" in Settings → Danger Zone
2. Warning modal: "This will permanently delete your account and all study progress. You have 30 days to cancel before deletion is final."
3. Student types their email to confirm
4. Account enters `pending_deletion` state: login blocked, data intact, deletion_scheduled_at set to NOW() + 30 days
5. Confirmation email sent: "Your deletion request was received. Your account will be permanently deleted on [date]. [Cancel deletion link]"
6. Student can cancel via the link in the email — restores account to active within 30 days
7. After 30 days: scheduled job hard-deletes all personal data (see TDD §12.6.2)

**What is deleted (hard delete):**
- `users` row (email, password hash, role)
- `user_stats` row (all scores, history, readiness data)
- `flagged_questions` rows
- `reading_positions` rows
- `question_reports` rows (user_id set to NULL, question content retained for clinical review)
- `user_credentials` rows (all passkeys)
- `audit_log` rows where user_id matches (GDPR requires deletion of personal data in logs too)

**What is retained (not personal data under GDPR):**
- Aggregate KPI snapshots already computed (total user count, platform-wide averages) — these contain no personal identifiers
- `readiness_history` daily snapshots are personal data — deleted with the user

**Privacy Policy requirement (GDPR Article 13):**
GDPR requires a privacy policy informing users of: what data is collected, how long it is retained, who it is shared with, and how to exercise rights including deletion. A privacy policy must exist and be linked from the registration screen and settings before launch. Writing the policy is out of scope for this PRD — see §6.

**Schema addition:** `deletion_scheduled_at TIMESTAMPTZ` column on `users` table.

---

## 6. Out of Scope for v5

- Maryland MNWC Word document parsing (requires Mammoth.js integration — evaluate for v6)
- Bow-tie and trend NGN item formats (pending MNWC parsing)
- Multi-user / shared leaderboards
- Export to Anki flashcard format
- NCLEX-PN support (currently NCLEX-RN only)
- Privacy Policy and Terms of Service documents (required for GDPR Article 13 compliance — must exist and be linked from registration and settings before public launch; writing them is outside the scope of this PRD)
- Push notifications (e.g. daily study reminder, streak protection alert at 9pm if no session logged) — requires service worker + push API or a native app wrapper; evaluate for v6

---

## 7. Open Questions

1. ~~**localStorage limits** — CLOSED.~~ IndexedDB handles textbooks (no size limit). localStorage holds only static modules, drug summaries, flashcards, and offline queue (~500KB total). No chunking needed.

2. ~~**Pre-extraction format** — CLOSED.~~ `BUNDLED_CONTENT` JSON schema is fully defined in TDD §4.1 with chapter/cases shape, field names, and ContentDB key mapping. Developer follows that schema when running the offline extraction script.

3. ~~**Herbal supplements and IV fluids in content_cache** — CLOSED.~~ Architecture changed: herbals, IV fluids, and vaccines are bundled as `content:static:{category}` in localStorage (loaded instantly at Phase 1, no API call, no content_cache row). `content_cache` is PostgreSQL-only for FDA labels, MedlinePlus, and RxNorm. No action needed.

4. ~~**RxNorm rate limits** — CLOSED.~~ content_cache is indexed by the developer at deploy time, not during student onboarding. Rate limiting is a one-time developer concern handled in the batch indexing script with 200ms spacing and exponential backoff. No runtime student impact.

5. ~~**Mammoth.js for MNWC** — CLOSED. Available as standard npm package; bow-tie/trend items deferred to v6 as deliberate scope decision, not a technical limitation.~~

6. **Reader app**: Integration is intentionally out of scope for v5. The NCLEX trainer is self-contained — all content renders in the native reader. Revisit for v6.

7. **Email verification**: No email verification in v5 — users can register with any email including typos. Admin can reset passwords via the Admin Dashboard (§5.12.1). Add email verification + self-service password reset via email link in v6.

8. **SMTP provider for batch job emails**: The 90-day cache refresh, quarterly textbook reminder, and account deletion confirmation emails require an SMTP provider. Gmail app passwords work for low-volume admin alerts. Set `ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` in Railway environment variables before first deploy.

---

## 8. Playtester Sign-off Criteria

The build is considered complete when:

**Session & Auth**
- Destiny: returning session — home screen loads and first question ready in < 1 second ✓
- Destiny: returning user never sees an indexing screen ✓
- Marcus: JWT implemented as HttpOnly cookie — no JWT in localStorage, no JWT in API response body ✓
- Destiny: "Sign in with passkey" option visible on login screen when browser supports WebAuthn ✓
- Destiny: after registration, prompt "Add a passkey for faster login?" is shown ✓
- Destiny: registering a passkey from Settings screen works and label auto-fills device name ✓
- Destiny: registered passkey appears in Settings with label and last used date ✓
- Destiny: passkey login completes with one biometric tap — no password typed ✓
- Destiny: passkey removed from Settings prompts confirmation and prevents removing last auth method ✓
- Marcus: passkey login blocked on HTTP — only works on HTTPS Railway deployment ✓
- Marcus: admin can view all passkeys for a user (label, last used) in User Management ✓
- Marcus: admin can revoke all passkeys for a user from the Admin Dashboard ✓
- Marcus: passkey revocation is logged in the audit log ✓

**ContentDB & First-Device Setup**
- Destiny: first-device setup — Phase 1 complete (pre-bundled content loaded) and first non-pharmacology question available in < 5 seconds ✓
- Destiny: first-device setup — pharmacology questions unlock progressively as FDA indexing completes in background ✓
- Marcus: stats persist correctly across browser close/reopen ✓
- Marcus: db:meta correctly reflects all ContentDB keys with timestamps — every key in §5.1 ContentDB table present with status 'ok' ✓
- Marcus: Admin Dashboard Content tab shows per-book reader count and average page reached from reading_positions ✓

**Account Management & Progress Dashboard**
- Destiny: Settings screen accessible from home screen header ✓
- Destiny: email change requires current password confirmation ✓
- Destiny: all registered passkeys listed individually with label and last used date ✓
- Destiny: adding passkey on a second device registers a separate credential (both work independently) ✓
- Destiny: removing last passkey blocked if no password fallback exists ✓
- Destiny: Progress Dashboard shows readiness trend with 7/30/90/Full toggle ✓
- Destiny: Study Calendar shows monthly view with per-day question count tiles ✓
- Destiny: Topic and NCJMM step bars are tappable and launch drill mode ✓
- Destiny: exam countdown shows on home screen when exam date is set ✓
- Marcus: account deletion enters 30-day grace period, confirmation email sent ✓
- Marcus: after 30 days all personal data hard-deleted (users, stats, flags, passkeys, audit log rows) ✓
- Marcus: cancellation link in deletion email restores account within 30 days ✓
- Marcus: question_reports rows retain question content but user_id set to NULL on deletion ✓
**Question Generation**
- All three: every question shows per-option rationale (why each wrong answer is wrong, not just why correct is right) ✓
- All three: every question displays its NCJMM step tag ("🧠 Prioritize Hypotheses") ✓
- Prof. Linda: all pharmacology questions cite a specific drug name and FDA source ✓
- Prof. Linda: herbal supplement questions correctly note no openFDA source and use static curated content ✓
- All three: dosage calc questions use formula bank with step-by-step work shown ✓
- Prof. Linda: NGN cases reference OpenStax as source ✓
- All three: NGN completion screen shows per-step breakdown ✓
- All three: 40+ NGN topics available ✓

**UX & Analytics**
- Destiny: NCLEX Readiness Score displays after 50+ questions across 3+ topics ✓
- Destiny: Readiness Score updates after every session ✓
- All three: NCJMM step performance analytics tab shows accuracy across all 6 cognitive steps ✓
- Destiny: Study Plan Generator produces a daily schedule showing: at least one priority topic, a specific question count, and at least one reading recommendation from ContentDB — all derived from actual weak area data and exam date ✓
- Destiny: spaced repetition queue surfaces "Due for review" badge on home screen ✓
- Destiny: "Add to flashcard +" button on every rationale auto-generates a front/back card ✓
- Destiny: Study Guides hub accessible from home screen — tapping any guide opens full-screen reader ✓
- Prof. Linda: pharmacology questions cover all 21 drug categories including vasopressors, herbals, and IV fluids ✓
- Prof. Linda: pediatric growth and development content accessible via Study Guides hub ✓
- Prof. Linda: infection control and isolation precautions content accessible via Study Guides hub ✓
- Prof. Linda: drug suffix/prefix cheat sheet accessible via Study Guides hub ✓
- All three: tapping a readable resource recommendation opens the native reader ✓
- All three: tapping a YouTube recommendation opens browser tab, not the reader ✓

**Timed Exam**
- Destiny: timed exam mode has no-going-back rule and locks rationales until end-of-exam report ✓
- Destiny: timed exam end report shows topic breakdown, NCJMM breakdown, and readiness score update ✓

**Voice Assistant & Reader**
- Destiny: voice assistant in hands-free mode reads question aloud and auto-listens ✓
- Prof. Linda: voice assistant response to "what does OpenRN say about [topic]?" returns actual indexed text with citation ✓
- Prof. Linda: voice assistant refuses to answer "what's the best treatment for hypertension?" (off-topic medical advice) ✓
- All three: every voice assistant response ends with a source citation ✓
- Marcus: voice assistant system prompt contains full ContentDB corpus at call time ✓
- Prof. Linda: voice assistant knows lab normal ranges and can answer "what is the therapeutic level for digoxin?" ✓
- Destiny: voice assistant can teach NCLEX test-taking strategies on request ✓
- Prof. Linda: voice assistant response to "what are the developmental milestones for a 6-month-old?" draws from content:development ✓
- Destiny: reader opens automatically to topic-matched chapter from question card ✓
- Destiny: voice assistant recommendation → reader tap works in drawer mode ✓
- Prof. Linda: Study Topic mode launches reader as full-screen primary view ✓
- Prof. Linda: FDA drug labels render as formatted card, not raw regulatory text ✓
- Marcus: reading position persists in db:stats across session close/reopen ✓

**Offline Mode**
- Destiny: offline mode shows "Offline — N questions available" banner on app open without internet ✓
- Destiny: 100-question offline bank available after first online session ✓
- Destiny: studying offline correctly queues stat updates and syncs when connection restores ✓
- Destiny: voice assistant shows clear offline message rather than failing silently ✓
- Marcus: offline bank regenerates once per 24 hours maximum — not on every session end ✓
- Marcus: sync queue caps at 500 entries with batching on flush ✓

**Reporting & Admin**
- Prof. Linda: "⚠️ Report question" button present on every question card ✓
- Prof. Linda: question reports stored in database and visible as badge count on Content Admin screen ✓
- Marcus: question_reports table exists in PostgreSQL with correct schema ✓
---

## 9. Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | March 2026 | Initial draft |
| 1.1 | March 2026 | Voice assistant redesigned: full ContentDB grounding, closed-domain NCLEX-only scope, hands-free mode, source-cited responses, off-topic rejection |
| 1.2 | March 2026 | Voice assistant: student progress awareness, Socratic answer-withholding model, struggle detection, resource surfacing (YouTube/official), proactive coaching |
| 1.3 | March 2026 | Native content reader: context-sensitive placement (drawer/full-screen), ContentDB + external URL rendering, YouTube link-out only, voice assistant → reader integration, reading position persistence |
| 1.4 | March 2026 | Textbook sourcing: OpenRN and OpenStax downloaded by developer, pre-extracted as static JSON bundled with app. No runtime scraping, no CORS risk, no LibreTexts. Reader app integration out of scope for v5. |
| 1.5 | March 2026 | Standalone deployment: React + Vite frontend, Kotlin + Spring Boot backend, Railway PostgreSQL, JWT auth, cross-device sync for user data. ContentDB corpus stays in localStorage. |
| 1.6 | March 2026 | Drug list expanded to ~319 drugs across 21 categories (Prof. Linda T. curation + gap analysis). Static content_cache for herbals and IV fluids. Added lab values, dosage formulas, test strategies, therapeutic communication, and delegation rules as ContentDB modules. |
| 1.7 | March 2026 | Strategies module web-searched for 2026 accuracy: CAT 70-135 scored + 15 pilot, exam day Pearson VUE procedures, retake policy. Diagnostics module added. |
| 1.8 | March 2026 | Health equity dedicated module (§5.4), 2026 test plan alignment note (§5.1), OpenStax Jan 2026 sourcing, SDOH 5 domains, unbiased care, updated terminology throughout. |
| 1.9 | March 2026 | Prof. Linda UWorld parity review. Added: per-option rationale spec (§5.2), NCJMM step tagging on every question (§5.2), NCLEX Readiness Score (§5.5.1), Study Plan Generator P1→P0 (§5.5.2), Spaced Repetition for flagged questions (§5.5.3), NCJMM Step Analytics differentiator (§5.5.4), Timed Exam Simulation fidelity (§5.5.5), UWorld parity problem statement (§2.7). |
| 2.0 | March 2026 | Flashcards and study guides review. AI-generated flashcards from rationales (§5.5.3), Study Guides hub navigation (§5.5 UX), drug suffix/prefix cheat sheet module (content:drug_suffixes). ContentDB now has 13 static/indexed content keys. |
| 2.1 | March 2026 | Offline mode added as §5.9 (P1): 100-question pre-generated bank, spaced repetition + flashcards + ContentDB reading all work offline, pending sync queue flushes when connection restores, connectivity detection, Service Worker optional. |
| 2.2 | March 2026 | Playtester review fixes: section renumbering (§5.4-§5.11), JWT contradiction resolved (HttpOnly cookie throughout), progressive onboarding unlock, Report Question mechanism (§5.7.0 P0), pediatric development module, infection control module, readiness score threshold (50q/3 topics), offline bank once-per-day trigger with cost model, sync queue 500-entry cap with batching, VA system prompt latency explained, Mammoth.js question closed. |
| 2.3 | March 2026 | Architecture fix: session startup split into returning user (< 1 second, zero indexing) vs first-device setup (once per device, ~90 seconds). Returning users never see an indexing screen — everything already in localStorage + PostgreSQL. Goals table and sign-off criteria updated to reflect two distinct latency targets. |
| 2.4 | March 2026 | Final cleanup: ContentDB table deduplicated (one row each for all keys), duplicate module descriptions removed (development and infection_control), exec summary corrected ('Claude.ai artifact'), blank lines before §5.5.1 fixed, §2.6/§2.7 correct order confirmed, email verification added to §7, study plan sign-off acceptance bar added. |
| 2.5 | March 2026 | Bug fixes: §5.6 triplicated block removed (kept one clean instance), JWT removed from localStorage list (it is HttpOnly cookie), question_reports SQL block removed from PRD (schema is TDD concern), stats:session removed from ContentDB table (stats are PostgreSQL), bow-tie Mammoth.js reference updated to explicit scope deferral. |
| 2.6 | March 2026 | Round-4 playtester fixes: duplicate minimum threshold paragraph removed (§5.7.1), Q5 closed properly, Q7 merge artifact removed, difficulty indicator bullet moved to §5.7 P1, duplicate sign-off block removed (24 redundant criteria), offline bank trigger sign-off aligned to 24-hour policy. |
| 2.7 | March 2026 | stats:session removed from ContentDB table (stats are PostgreSQL not localStorage), hardcoded '15 keys' in sign-off replaced with 'all ContentDB keys', sign-off criteria grouped into 8 feature areas, 1M context window cost note added to voice assistant section. Model confirmed as claude-sonnet-4-6-20260218 (Sonnet 4.6). |
| 2.8 | March 2026 | Context window corrected: standard Sonnet 4.6 API tier = 200K tokens. Full ContentDB (~500K tokens) physically cannot be injected — excerpt approach is a hard architectural constraint, not a cost optimization. |
| 2.9 | March 2026 | Storage architecture overhaul: three-layer model — IndexedDB for textbooks (student-downloaded, no size limit), localStorage for static modules + drug NCLEX summaries + flashcards (~500KB), PostgreSQL content_cache for FDA labels / MedlinePlus / RxNorm (server-indexed once, served via API). content:drug_nclex:{drugname} key added for curated NCLEX summaries. Driven by real measurement: one OpenRN book = 1.9MB text / ~470K tokens, proving localStorage was wrong for textbooks. |
| 3.0 | March 2026 | 90-day content_cache batch refresh added (Spring Boot @Scheduled, daily 2am). Quarterly textbook update email reminder added (every 3 months, links to OpenRN + OpenStax). SMTP env vars documented in open questions. Deployment table updated. |
| 3.1 | March 2026 | §5.12 Roles and Admin Dashboard added (P0): user/admin roles, /admin route, full CRUD user management with impersonation, KPI dashboard (growth/content/cost/testing metrics), question report queue, audit log viewer, expanded content admin. Password reset moved from PostgreSQL console to admin dashboard. |
| 3.2 | March 2026 | Passkey / WebAuthn support added (§5.6): passwordless login via biometric/device PIN, optional after initial email+password registration, passkey management in settings, admin can revoke passkeys. Built on Spring Security native WebAuthn support (Spring Security 6.4+). |
| 3.3 | March 2026 | Passkey sign-off criteria expanded (6→10 criteria: post-registration prompt, label display, remove safeguard, admin view + revoke + audit). Textbook usage analytics added to Admin Dashboard Content tab (§5.12.5): per-book reader count and avg page from reading_positions, no new data collection. Analytics sign-off criterion added. |
| 3.4 | March 2026 | §5.13 added: multi-device passkeys clarified (separate credential per device), account management (/settings: profile, passkeys, preferences, danger zone), student progress dashboard (/progress: readiness trend 7/30/90/full, monthly study calendar, topic/NCJMM bars, question volume, flagged queue). GDPR/CCPA account deletion: 30-day grace period then hard delete of all personal data. |
| 3.5 | March 2026 | Playtester round-5 fixes: stale goals table updated, empty states added to all 6 progress dashboard sections, NCJMM step bars made tappable, home screen exam countdown + daily goal + progress shortcut added to §5.7, Privacy Policy noted in §5.13.4 and §6, version history deduplicated. |
| 3.7 | March 2026 | §5.9 Library tab added: dedicated textbook browser with Read online, Download EPUB, Download PDF per book. Downloads via browser <a download> to device Downloads folder — no internal storage. |
| 3.6 | March 2026 | Round-6 playtester fixes: Q7 text restored (email verification note complete), Q3 closed (herbals are localStorage not content_cache, §5.1 description corrected), study plan deepened to drug class/condition level (not just NCLEX categories), push notifications added to §6 Out of Scope. |
| 3.7 | March 2026 | Playtester round-7 housekeeping: Q1, Q2, Q4 closed (localStorage confirmed fine, BUNDLED_CONTENT schema in TDD §4.1, content_cache indexed at deploy not runtime), Q8 merge artifact removed. |

---

*This document reflects requirements derived from 8 rounds of playtester feedback from Destiny R. (nursing student), Prof. Linda T. (nursing faculty), and Marcus D. (QA engineer / nursing student).*