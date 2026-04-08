# NCLEX Trainer v5 — Open Source Personas

**Author:** Product Manager  
**Version:** 1.0  
**Date:** March 2026  
**Purpose:** Defines the expanded user personas for the open source release of NCLEX Trainer v5. Extends the original three playtester personas (Destiny, Prof. Linda, Marcus) to cover the full spectrum of users who will engage with this project once open sourced.

---

## Original Personas (v5 Core)

These three personas drove all v5 design decisions and remain the primary target users.

---

### Persona 1 — Destiny R.
**Role:** Nursing Student (Primary User)  
**Age:** 24  
**Location:** New York City  

**Background:**  
Recent nursing grad preparing to retake the NCLEX-RN. Works part-time as a patient care technician. Studies on her iPhone during her subway commute — 35 minutes each way, often without reliable internet. Has used UWorld but can't afford to renew the subscription. Benchmarks every tool against UWorld's question quality and rationale depth.

**Goals:**  
- Pass NCLEX-RN on the next attempt
- Study during commute without burning through data
- Understand *why* each answer is right or wrong, not just which one
- Track whether she's actually improving over time

**Frustrations:**  
- UWorld costs $200+ and her subscription expired
- Free tools have shallow rationales and no clinical source citations
- Apps that take 10 seconds to load on a moving subway are unusable
- Starting over every session because nothing persists

**Technical comfort:** Low. Doesn't know what an API is. Uses apps, not websites.

**Device:** iPhone 14, occasionally MacBook at home.

**Key behaviors:**  
- Studies in 20-30 minute bursts, not long sessions
- Needs offline mode to be completely seamless
- Will use voice assistant while folding laundry or commuting
- Flags questions she found confusing to review later

**Quote:** *"I just need something that works like UWorld but doesn't cost $200 every time I need to retake."*

---

### Persona 2 — Prof. Linda T.
**Role:** Nursing Faculty (Secondary User / Clinical Validator)  
**Age:** 52  
**Location:** Houston, TX  

**Background:**  
Associate Professor of Nursing at a community college. Has been teaching pre-licensure nursing for 22 years. Recommends study tools to her students and holds herself responsible if she points them toward something clinically inaccurate. Has reviewed the OpenRN pharmacology textbook and contributed to its national peer review. Evaluates every tool through the lens of NCLEX test plan fidelity and clinical accuracy.

**Goals:**  
- Recommend a free, credible tool to students who can't afford UWorld
- Verify that AI-generated questions cite authoritative sources
- Ensure pharmacology content reflects current FDA-approved information
- Trust that wrong content gets flagged and corrected

**Frustrations:**  
- AI tools that hallucinate drug dosages or contraindications
- Questions that don't align with the 2026 NCLEX test plan
- No faculty review layer on AI-generated clinical content
- Tools that treat NCLEX as a memorization test rather than a clinical judgment exam

**Technical comfort:** Medium. Uses LMS platforms and online course tools daily, but not a developer.

**Device:** Windows laptop, occasionally iPad.

**Key behaviors:**  
- Will test a tool extensively before recommending it to students
- Submits question reports when she spots clinical inaccuracies
- Reviews the Admin Dashboard report queue to validate content quality
- Wants to see NGN case studies that match NCSBN's published case formats

**Quote:** *"If a student studies with wrong rationales, I've failed them before they even sit the exam."*

---

### Persona 3 — Marcus D.
**Role:** Nursing Student / QA Engineer (Tertiary User / Technical Validator)  
**Age:** 28  
**Location:** Austin, TX  

**Background:**  
Second-career student in an accelerated BSN program. Spent five years as a QA engineer in fintech before going back to school. Approaches nursing school the way he approached software testing — systematically, with data. Tracks his performance metrics obsessively. Equally comfortable reading a PRD and reading a nursing pharmacology textbook.

**Goals:**  
- Understand the source behind every question and rationale
- Track his own performance trends at a granular level (topic × NCJMM step × time)
- Find content errors and report them through a proper channel
- Deploy and self-host the app if he wants to

**Frustrations:**  
- Black-box AI that can't tell him *where* the answer came from
- Study apps with no data export or performance analytics
- Tools that show "81% accuracy" with no breakdown by topic, question type, or cognitive step
- No way to report factual errors to the people running the tool

**Technical comfort:** High. Developer-adjacent. Will read the TDD, file GitHub issues, and potentially submit PRs.

**Device:** MacBook Pro, Android phone.

**Key behaviors:**  
- Reads source attribution badges on every question
- Checks the readiness score algorithm logic to understand how it weights topics
- Uses the progress dashboard more than any other feature
- Likely to contribute to the open source repo

**Quote:** *"I want to know if my 78% on cardiac questions is from MC questions or NGN cases, and whether it's trending up or down over the last two weeks."*

---

## New Open Source Personas

These personas emerge from the open source release and were not part of the original v5 design. They inform future feature prioritization and community decisions.

---

### Persona 4 — Taiwo A.
**Role:** International Nursing Student  
**Age:** 31  
**Location:** Lagos, Nigeria (planning to relocate to Canada)  

**Background:**  
Registered nurse in Nigeria with 6 years of clinical experience. Preparing for the NCLEX-RN as part of her immigration pathway to Canada. Has strong clinical skills but needs to adapt to US/Canadian nursing exam format and NCSBN test plan language. Cannot afford UWorld or Kaplan — international payment methods often don't work on US platforms. Found the GitHub repo through a Nigerian nursing Facebook group.

**Goals:**  
- Pass NCLEX-RN to qualify for Canadian licensure
- Access a credible, free prep tool that accepts no payment at all
- Understand the US NCLEX format (NGN, CAT algorithm, NCJMM) which differs from her nursing board exam
- Self-host a local instance to avoid unreliable internet during exam prep

**Frustrations:**  
- US tools that don't accept non-US payment methods
- Content that assumes familiarity with US healthcare system terminology
- Slow load times on high-latency connections
- No offline mode — her internet drops without warning

**Technical comfort:** Low-medium. Uses smartphones and web apps confidently but not a developer.

**Special needs for this project:**  
- Offline mode is not a nice-to-have — it's required
- `bundled-content.json` must be downloadable separately for low-bandwidth users
- Currency/payment references in any UI copy should be absent (this tool is free — nothing implies otherwise)
- Future: content adaptation for NCLEX-PN or international nursing boards

**Quote:** *"I've been a nurse for six years. I just need a tool that explains the American way of thinking about nursing care — and I can't afford $300 for it."*

---

### Persona 5 — Dr. Rajesh K.
**Role:** Nursing Faculty / Open Source Contributor  
**Age:** 45  
**Location:** Seattle, WA  

**Background:**  
Associate Professor of Nursing Informatics at a large state university. Teaches a graduate-level course on technology in nursing education. Has been following the OpenRN project since its DoE grant announcement. Discovered this project through the OpenRN project team's mention of it. Wants to use it as a teaching case study and potentially integrate it into his curriculum. Has a team of graduate students who could contribute to the codebase.

**Goals:**  
- Adapt the drug list and static content modules for his university's specific curriculum
- Contribute prompt variants for a new LLM provider his department has an institutional license for
- Use the admin dashboard data (reader analytics, readiness trends) as a research dataset for a nursing informatics paper
- Deploy a class-specific instance for his 40 nursing informatics students

**Frustrations:**  
- Tools that don't support self-hosting or customization
- No API for integrating with the university's LMS
- Clinical content that can't be updated without forking the entire codebase
- No academic citation pathway for the tool (he needs to cite it in a paper)

**Technical comfort:** High. Comfortable with Docker, GitHub, and reading code. Not a daily developer but can review PRs.

**What he contributes:**  
- OpenAI prompt variant PR (his department has a GPT-4o enterprise license)
- Bug reports from the admin dashboard
- A nursing informatics paper citing the NCJMM two-step validation architecture
- Graduate student contributors to the repo

**Quote:** *"This is the first open source NCLEX tool I've seen that takes clinical accuracy seriously at the architecture level. I want my students building things like this."*

---

### Persona 6 — Amara S.
**Role:** Self-Hosting Developer / Healthcare Tech Enthusiast  
**Age:** 34  
**Location:** London, UK  

**Background:**  
Software engineer working in NHS digital health. Not a nurse but has a sister who is preparing for her OET (Occupational English Test) and UK NMC nursing registration exams. Discovered the project on Hacker News. Wants to fork and adapt it for UK nursing exam prep (NMC registration, not NCLEX). Has experience with Kotlin/Spring Boot from his day job. Plans to swap the drug list for UK BNF drug data and replace the NCJMM framework with NMC competency standards.

**Goals:**  
- Fork and adapt the tool for UK nursing exam prep
- Swap content modules (drug list, strategies) without touching application code
- Contribute the LiteLLM sidecar Docker Compose config back to the main repo
- Run it for free using Ollama locally rather than paying for Anthropic API

**Frustrations:**  
- Apps hardcoded to US NCLEX that can't be adapted for other nursing boards
- Proprietary tools with no self-hosting option
- Having to read 3,500 lines of TDD to find the seam where he can swap content

**Technical comfort:** Very high. Senior developer. Will read every line of the TDD.

**What he contributes:**  
- UK nursing board fork (NMC exam adaptation)
- LiteLLM + Ollama Docker Compose configuration
- PR documenting how to swap `NCLEX_Drug_List_Prof_Linda.md` for BNF drug data
- Issue reports on the `bundled-content.json` schema where it has NCLEX-specific hardcoding

**Quote:** *"The architecture is clean. I just need to swap three files and the LLM config and this works for the UK boards."*

---

### Persona 7 — Sofia M.
**Role:** Nursing Program Director / Institutional Deployer  
**Age:** 48  
**Location:** San Antonio, TX  

**Background:**  
Director of Nursing Education at a mid-size community college with 180 pre-licensure nursing students per cohort. Her NCLEX first-attempt pass rate dropped from 88% to 74% after the 2023 NGN format change. The college can't afford institutional UWorld licenses for all students. Found this project through the OpenRN project mailing list. Wants to deploy a college-branded instance for all her students and integrate it with the college's student success tracking system.

**Goals:**  
- Deploy a college-branded instance for 180 students at no per-student cost
- Give faculty access to the admin dashboard to monitor student readiness trends
- Integrate student readiness scores with the college's early alert system (flags at-risk students)
- Provide the tool as a condition of enrollment in NCLEX prep courses

**Frustrations:**  
- Procurement process for commercial tools takes 6-12 months
- Per-seat licensing becomes cost-prohibitive at institutional scale
- No ability to see aggregate student performance across a cohort
- Faculty can't monitor student engagement or flag struggling students

**Technical comfort:** Low. Will rely on IT department to deploy. Evaluates tools at the administrative and pedagogical level, not the code level.

**What she needs from the project:**  
- A clear "deploy for your institution" guide in plain language (not developer docs)
- FERPA compliance documentation (student data stored on college's own server)
- The admin dashboard to support multiple faculty accounts, not just one admin (currently v5 limitation — v6 candidate)
- An institutional citation for procurement conversations ("it's built on OpenRN, which is DoE-funded")

**Quote:** *"I don't need the fanciest tool. I need a tool I can deploy for free, that my faculty can monitor, and that actually prepares students for the NGN format."*

---

### Persona 8 — Jordan T.
**Role:** Nursing Student, Open Source First-Timer  
**Age:** 22  
**Location:** Atlanta, GA  

**Background:**  
BSN student in their second year. Has never contributed to an open source project but uses GitHub to download things. Heard about this project from a classmate who shared it in their nursing school Discord server. Passed their first pharmacology course with a B and wants to improve. Noticed that the drug list is missing a drug their professor mentioned — wants to add it but doesn't know how.

**Goals:**  
- Use the tool to prepare for NCLEX (primary goal)
- Figure out how to add a missing drug to the list
- Maybe submit their first ever GitHub PR

**Frustrations:**  
- Open source contribution guides written for senior engineers
- No clear "first contribution" pathway for non-developers
- Drug list doesn't include the drugs their professor emphasizes most

**Technical comfort:** Very low on code. Can follow step-by-step instructions. Can edit a markdown file if someone explains how.

**What this project needs for them:**  
- A `CONTRIBUTING.md` with a "Non-developer contributions" section covering: how to edit `NCLEX_Drug_List_Prof_Linda.md`, how to submit a question report through the app, how to open a GitHub issue for a clinical inaccuracy
- A `good first issue` label on GitHub for markdown-only changes
- A Discord or discussion forum where they can ask questions without needing to know Git

**Quote:** *"I don't know how to code but I know that acebutolol isn't in the drug list and it was on my last ATI exam."*

---

## Persona Summary Table

| Persona | Role | Technical Level | Primary Need | Key Risk |
|---|---|---|---|---|
| Destiny R. | Nursing student | Low | Free UWorld alternative, offline | Loses interest if first impression is slow |
| Prof. Linda T. | Nursing faculty | Medium | Clinically credible, faculty-reviewable | One wrong rationale ends her endorsement |
| Marcus D. | Student / QA engineer | High | Data transparency, self-host | Will file issues faster than they can be resolved |
| Taiwo A. | International student | Low-medium | Free, offline, no payment required | High-latency connection; needs lightweight first load |
| Dr. Rajesh K. | Faculty / Contributor | High | Customizable, citable, researchable | Needs LMS integration and multi-admin (v6) |
| Amara S. | Developer / Fork | Very high | Non-NCLEX adaptation, self-host | Will expose every NCLEX-specific hardcoding |
| Sofia M. | Program director | Low | Institutional deploy, cohort monitoring | Blocked without FERPA docs and IT-friendly guide |
| Jordan T. | Nursing student | Very low | Use it, maybe contribute one PR | Abandoned if contribution pathway is too complex |

---

## Implications for Open Source Roadmap

**Immediate (before public launch):**
- `CONTRIBUTING.md` with non-developer section for drug list edits and question reports
- `DEPLOY.md` for Sofia's IT team — plain-language Railway deployment guide
- `FERPA.md` — brief data handling summary for institutional procurement conversations
- `good first issue` labels on GitHub for markdown-only contributions (Jordan)

**v6 candidates driven by new personas:**
- Multi-admin roles (Sofia — faculty need dashboard access without full admin)
- LMS integration / grade passback (Sofia — FERPA and student success tracking)
- International nursing board adaptation guide (Amara)
- Low-bandwidth mode: serve `bundled-content.json` in chunks (Taiwo)
- DOI / academic citation via Zenodo (Dr. Rajesh — needed for paper citations)

*Personas 1-3 remain the primary design constraint. Personas 4-8 inform open source community decisions and v6 prioritization but should not pull v5 scope.*

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | March 2026 | Initial document: 3 original playtester personas + 5 new open source personas (international student, faculty contributor, self-hosting developer, institutional deployer, first-time contributor). Persona summary table. Open source roadmap implications. |