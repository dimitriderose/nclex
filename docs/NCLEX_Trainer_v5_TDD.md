# NCLEX Trainer v5 — Technical Design Document

**Author:** Solutions Architect  
**Version:** 4.2  
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

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          React UI Layer                              │
│  Home · /settings · /progress · /admin                              │
│  Daily · SATA · Dosage · NGN · Study · Exam · Voice · Reader         │
└────────────┬──────────────────────────────┬──────────────────────────┘
             │                              │
┌────────────▼──────────┐   ┌──────────────▼──────────────────────────┐
│  Question Generation  │   │  Voice Assistant                         │
│  generateMCQuestion() │   │  buildSystemPrompt() — excerpts from     │
│  generateSATAQuestion │   │  localStorage + IndexedDB + /api/content │
│  generateNGNCase()    │   │  Closed-domain NCLEX-RN, source-cited    │
└────────────┬──────────┘   └──────────────┬──────────────────────────┘
             │                              │
             └──────────────┬───────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│                     ContentDB Router                                 │
│  content:openrn:* / content:openstax:*  →  IndexedDB (device)        │
│  content:fda:* / content:medline:* / content:rxnorm:*  →  API        │
│  everything else  →  localStorage (~500KB, bundled)                  │
└──────┬────────────────────┬─────────────────────────┬────────────────┘
       │                    │                          │
┌──────▼──────┐  ┌──────────▼──────────┐  ┌──────────▼──────────────┐
│  IndexedDB  │  │  localStorage        │  │  Spring Boot API         │
│  ~15-20MB   │  │  Drug summaries      │  │  /api/content/{key}      │
│  OpenRN +   │  │  Static modules ×15  │  │    → PostgreSQL          │
│  OpenStax   │  │  Flashcards          │  │      content_cache       │
│  (user DL)  │  │  Offline bank        │  │      (FDA/MedlinePlus/   │
└─────────────┘  └──────────────────────┘  │       RxNorm, 90d TTL)  │
                                           │  /api/stats /api/flags   │
                                           │  /api/account /api/admin │
                                           │    → PostgreSQL          │
                                           │      user data tables    │
                                           └─────────────────────────┘
```

---

## 3. ContentDB Module

### 3.1 Storage Architecture

ContentDB is split across three storage layers:

**IndexedDB (device-local)** — OpenRN and OpenStax textbook text, stored after student download. No size limit (unlike localStorage). One OpenRN book = ~1.9MB text / ~470K tokens — this is why localStorage was insufficient. Keys: `content:openrn:*`, `content:openstax:*`.

**localStorage (device-local, lightweight ~500KB)** — bundled static modules, curated drug NCLEX summaries, flashcards, offline question bank, device preferences, `db:meta`, `sync:pending`. Keys: `content:drug_nclex:*`, `content:drug_suffixes`, `content:static:*`, `content:labs`, `content:formulas`, `content:strategies`, `content:diagnostics`, `content:communication`, `content:delegation`, `content:health_equity`, `content:development`, `content:infection_control`, `db:meta`, `sync:pending`.

**Railway PostgreSQL content_cache** — FDA drug labels, MedlinePlus summaries, RxNorm data. Indexed once by developer at deploy time. Served to clients via `/api/content/{key}`. Same content for all users — no reason to store per-device. Keys: `content:fda:*`, `content:medline:*`, `content:rxnorm:*`.

**Railway PostgreSQL user data** — all user-specific data (stats, flags, reading positions). Syncs across devices. Requires auth.

```javascript
// ContentDB — unified wrapper routing to correct storage by key prefix
//
// Routing rules:
//   content:openrn:*    → IndexedDB (large textbook text)
//   content:openstax:*  → IndexedDB (large textbook text)
//   content:fda:*       → /api/content/fda/{drug}  (PostgreSQL content_cache)
//   content:medline:*   → /api/content/medline/{topic}
//   content:rxnorm:*    → /api/content/rxnorm/{drug}
//   everything else     → localStorage (static modules, drug NCLEX summaries, etc.)

const IDB_PREFIXES = ['content:openrn:', 'content:openstax:'];
const API_PREFIXES = ['content:fda:', 'content:medline:', 'content:rxnorm:'];

function routeToIDB(key) { return IDB_PREFIXES.some(p => key.startsWith(p)); }
function routeToAPI(key) { return API_PREFIXES.some(p => key.startsWith(p)); }

const ContentDB = {
  async get(key) {
    if (routeToAPI(key)) {
      // Fetch from PostgreSQL content_cache via backend API
      try {
        const res = await fetch(`/api/content/${encodeURIComponent(key)}`,
          { credentials: 'include', cache: 'default' });
        return res.ok ? res.json() : null;
      } catch { return null; }
    }
    if (routeToIDB(key)) {
      return IDB.get(key);  // IndexedDB helper — see below
    }
    // localStorage for everything else
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  async set(key, value) {
    if (routeToAPI(key)) {
      console.warn('ContentDB.set: API-backed keys are read-only from client', key);
      return false;
    }
    if (routeToIDB(key)) {
      return IDB.set(key, value);
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('ContentDB.set failed:', key, e);
      return false;
    }
  },

  async list(prefix) {
    if (routeToAPI(prefix)) return [];  // API keys not enumerable client-side
    if (routeToIDB(prefix)) return IDB.list(prefix);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    return keys;
  },

  async delete(key) {
    if (routeToIDB(key)) return IDB.delete(key);
    localStorage.removeItem(key);
  }
};

// IndexedDB helper — thin wrapper for textbook storage
// SA Finding 1: Connection is cached after first open — never re-opened per operation.
// Opening a new connection on every write caused 30s+ delays on mobile during bulk indexing.
const IDB = {
  DB_NAME: 'nclex-content', STORE: 'content', VERSION: 1,
  _db: null,  // cached connection — reused across all operations

  async open() {
    if (this._db) return this._db;  // return cached connection
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE);
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = e => reject(e.target.error);
    });
  },

  // Batch write — opens one connection and writes all entries in a single transaction.
  // Use for bulk indexing (indexBundledContent) — dramatically faster than per-key open().
  async setBatch(entries) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      const store = tx.objectStore(this.STORE);
      for (const [key, value] of entries) store.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = e => reject(e.target.error);
    });
  },

  async get(key) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  },

  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async list(prefix) {
    const db = await this.open();
    return new Promise((resolve) => {
      const keys = [];
      const tx = db.transaction(this.STORE, 'readonly');
      tx.objectStore(this.STORE).openKeyCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.key.startsWith(prefix)) keys.push(cursor.key);
          cursor.continue();
        } else resolve(keys);
      };
    });
  },

  async delete(key) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(key);
      tx.oncomplete = () => resolve(true);
    });
  }
};

// UserDB — backend API wrapper for user-specific data
// Auth is handled via HttpOnly cookie — no JWT in JS, invisible to XSS.
// credentials: 'include' ensures cookies are sent on every request.
const UserDB = {
  async getStats() {
    const res = await fetch('/api/stats', authFetchOptions());
    return res.ok ? res.json() : null;
  },

  async saveStats(stats) {
    // Trim history to 200 entries client-side; server enforces this too
    const trimmed = { ...stats, history: (stats.history || []).slice(-200) };
    await fetch('/api/stats', authFetchOptions({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trimmed)
    }));
  },

  async getFlags() {
    const res = await fetch('/api/flags', authFetchOptions());
    return res.ok ? res.json() : [];
  },

  async addFlag(flag) {
    // Sanitize question object before sending — strip any HTML from text fields
    const safe = sanitizeFlagForStorage(flag);
    await fetch('/api/flags', authFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safe)
    }));
  },

  async deleteFlag(id) {
    // Server enforces ownership — only deletes if flag belongs to authenticated user
    await fetch(`/api/flags/${id}`, authFetchOptions({ method: 'DELETE' }));
  },

  async getReadingPosition(contentKey) {
    // Validate content key format before sending
    if (!isValidContentKey(contentKey)) return 0;
    const res = await fetch(`/api/reading/${encodeURIComponent(contentKey)}`, authFetchOptions());
    return res.ok ? (await res.json()).page : 0;
  },

  async saveReadingPosition(contentKey, page) {
    if (!isValidContentKey(contentKey)) return;
    await fetch('/api/reading', authFetchOptions({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentKey, page: Math.max(0, Math.floor(page)) })
    }));
  }
};

// Sanitize question object before storing — strip HTML from all string fields
function sanitizeFlagForStorage(flag) {
  const stripHtml = (s) => typeof s === 'string'
    ? s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim().substring(0, 2000)
    : s;
  return {
    topic: stripHtml(flag.topic),
    category: flag.category, // validated by DB CHECK constraint
    question: {
      question: stripHtml(flag.question?.question),
      rationale: stripHtml(flag.question?.rationale),
      type: flag.question?.type,
      topic: stripHtml(flag.question?.topic),
      correct: flag.question?.correct,
      // no arbitrary fields — only known safe properties
    }
  };
}

// Validate content key format — must start with content: prefix
function isValidContentKey(key) {
  return typeof key === 'string' && /^content:[a-z0-9:_-]{1,100}$/.test(key);
}

// JWT is stored in an HttpOnly cookie set by the server on login.
// The browser attaches it automatically on every same-origin request.
// We never read or write the JWT in JavaScript — it is invisible to XSS.
// credentials: 'include' tells fetch to send cookies cross-origin if needed.
function authHeaders() {
  return {}; // cookie is attached by browser automatically
}
function authFetchOptions(extra = {}) {
  return { ...extra, credentials: 'include' };
}

// SA Finding 3: Global 401 handler — catches session expiry from another device logging out.
// Wrap all authenticated fetch calls with this to handle multi-device token invalidation.
async function authedFetch(url, options = {}) {
  const res = await fetch(url, authFetchOptions(options));
  if (res.status === 401) {
    // Token invalidated (likely logged out on another device)
    localStorage.removeItem('db:meta');  // force fresh setup on next login
    window.location.href = '/login?reason=session_expired';
  }
  return res;
}
```

### 3.2 Key Schema

All keys follow a hierarchical naming convention. Storage backend is determined by prefix — see ContentDB routing rules in §3.1.

```
── IndexedDB (textbooks, student-downloaded) ──────────────────────────
content:openrn:pharmacology       OpenRN pharm chapter text + activities
content:openrn:fundamentals       OpenRN fundamentals (~1.9MB text, ~470K tokens)
content:openrn:mentalhealth       OpenRN mental health chapter text
content:openrn:management         OpenRN management chapter text
content:openrn:skills             OpenRN skills chapter text
content:openstax:ngn:medsurg      OpenStax med-surg NGN case studies
content:openstax:ngn:fundamentals OpenStax fundamentals NGN cases
content:openstax:ngn:maternal     OpenStax maternal-newborn NGN cases
content:openstax:ngn:peds         OpenStax pediatric NGN cases
content:openstax:ngn:psych        OpenStax psychiatric NGN cases

── localStorage (bundled static, ~500KB total) ─────────────────────────
db:meta                           ContentDB version + book download status
sync:pending                      Offline stat update queue
content:drug_nclex:{drugname}     Prof. Linda's NCLEX summary per drug (~400 bytes × 319 = ~130KB)
content:drug_suffixes             Drug naming pattern cheat sheet
content:static:herbals            8 herbal supplements (no openFDA)
content:static:ivfluids           7 IV fluids (no openFDA)
content:static:vaccines           7 vaccines/biologics (no openFDA)
content:labs                      Lab value reference + ABG interpretation
content:formulas                  Dosage calculation formula bank
content:strategies                2026 NCLEX test plan, CAT algorithm, exam day
content:diagnostics               Pre/post-procedure nursing care
content:communication             Therapeutic communication framework
content:delegation                RN/LPN/UAP scope, 5 rights
content:health_equity             SDOH 5 domains, 2026 test plan emphasis
content:development               Erikson/Piaget, milestones, red flags
content:infection_control         Isolation precautions, PPE, C. diff, HAI bundles

── PostgreSQL content_cache (server-side, served via /api/content/{key}) ──
content:fda:{drugname}            Full openFDA label (~15KB/drug × ~300 = ~4.5MB)
content:medline:{topic}           MedlinePlus topic summary
content:rxnorm:{drugname}         RxNorm drug class + interactions
```

**Storage budget — real numbers:**
- IndexedDB: no practical limit. One OpenRN book = ~1.9MB text. All 7 books + OpenStax = ~15-20MB estimated. Handled fine.
- localStorage: ~500KB total for all static content. Well within 5-10MB limit.
- PostgreSQL content_cache: ~4.5MB FDA + ~400KB MedlinePlus + ~1.5MB RxNorm = ~6.5MB server-side. No client impact.

### 3.3 Metadata Schema

```javascript
// db:meta value shape
{
  version: "5.0",
  indexedAt: "2026-03-30T10:00:00Z",
  sources: {
    "openrn": { indexedAt: "...", keyCount: 5, status: "ok" },
    "openstax": { indexedAt: "...", keyCount: 5, status: "ok" },
    "fda": { indexedAt: "...", keyCount: 20, status: "ok" },
    "medline": { indexedAt: "...", keyCount: 30, status: "partial" },
    "rxnorm": { indexedAt: "...", keyCount: 20, status: "ok" }
  }
}
```

### 3.4 Storage Budget

Storage is now split across three backends — no single one is under pressure:

| Backend | Contents | Estimated Size | Limit |
|---|---|---|---|
| **IndexedDB** | All OpenRN books (7) + OpenStax | ~15-20MB text | No practical limit |
| **localStorage** | Drug NCLEX summaries + 15 static modules + flashcards + offline bank | ~500KB | 5-10MB — comfortably under |
| **PostgreSQL content_cache** | FDA labels + MedlinePlus + RxNorm | ~6.5MB server-side | No client impact |

Real measurement: Nursing Fundamentals 2e EPUB = 35MB with images, **1.9MB text only, ~470K tokens**. This is why textbooks must use IndexedDB — localStorage would overflow on a single book.

---

## 4. Content Indexing Modules

Content enters ContentDB through two paths: pre-extracted static JSON (for OpenRN and OpenStax textbooks) and live API calls (for government sources). Both paths run during onboarding only.

### 4.1 OpenRN and OpenStax — Pre-Extracted Static JSON

OpenRN and OpenStax books are downloaded by the developer as PDF/EPUB files (both are CC-BY 4.0 — freely downloadable and reusable). Text is extracted offline using standard tools and stored as a structured JSON object bundled directly with the app.

**Why this approach:**
- No runtime CORS risk — content is already in the app bundle
- No network dependency for the most important content
- Instant availability on first open (no waiting for chapter fetches)
- Full control over text quality — developer extracts and validates once

**Bundled content schema** (this is the authoritative definition — PRD Q2 is resolved here):

SA Finding 9: `BUNDLED_CONTENT` must NOT be inlined in the main JS bundle. Seven OpenRN books
+ OpenStax = ~15-20MB of JSON. Inlining causes a 20MB initial bundle → 10-20 second load on mobile.

**Correct approach:** Serve `bundled-content.json` as a static asset from `/public/`. Load lazily
on first-device setup only with `fetch('/bundled-content.json')`. After indexing into IndexedDB,
the JSON file is never fetched again — the data lives in IndexedDB on device.

```javascript
// Phase 1 of first-device setup — lazy load, not inlined in bundle
// SEC-7: Integrity hash embedded at build time — verified before indexing.
// At build: `sha256sum public/bundled-content.json` → embed hex digest as CONTENT_HASH constant.
// Prevents poisoned textbook content from reaching IndexedDB if deployment is compromised.
const BUNDLED_CONTENT_SHA256 = '__BUNDLE_HASH__';  // replaced by build script

async function indexBundledContent(onProgress) {
  onProgress('Downloading textbook content...');
  const res = await fetch('/bundled-content.json');  // served as static asset
  const buffer = await res.arrayBuffer();

  // Verify integrity before indexing
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (hashHex !== BUNDLED_CONTENT_SHA256) {
    throw new Error('bundled-content.json integrity check failed — aborting setup');
  }

  const BUNDLED_CONTENT = JSON.parse(new TextDecoder().decode(buffer));
  // ... rest of indexing unchanged
}
```

Vite config — ensure the file is served from `/public/bundled-content.json`:
```javascript
// vite.config.js — no special config needed; files in /public are served as-is
// Developer places extracted bundled-content.json in /public/ before build
```

```javascript
// BUNDLED_CONTENT schema — shape of bundled-content.json
// Developer populates this by extracting text from downloaded PDFs/EPUBs offline
const BUNDLED_CONTENT = {
  openrn: {
    pharmacology: {
      title: "Nursing Pharmacology 2e",
      source: "OpenRN (CC-BY 4.0) — wtcs.pressbooks.pub/pharmacology2e",
      chapters: [
        {
          title: "Pharmacokinetics & Pharmacodynamics",
          text: "...", // extracted chapter text, ~5000-15000 chars
          learningActivities: ["..."], // extracted SATA/scenario items
        },
        // ... more chapters
      ]
    },
    fundamentals: { /* same shape */ },
    skills: { /* same shape */ },
    mentalhealth: { /* same shape */ },
    management: { /* same shape */ },
  },
  openstax: {
    ngn: {
      medsurg: {
        title: "Medical-Surgical Nursing (OpenStax)",
        source: "OpenStax (CC-BY 4.0)",
        cases: [
          {
            topic: "Heart Failure",
            content: "...", // full unfolding case study text
            ncjmmSteps: ["..."], // extracted per-step content if structured
          },
          // ... more cases
        ]
      },
      fundamentals: { /* same shape */ },
      maternal: { /* same shape */ },
      peds: { /* same shape */ },
      psych: { /* same shape */ },
    }
  }
};
```

**Onboarding — loading bundled content into ContentDB:**

```javascript
async function indexBundledContent(onProgress) {
  // SA Finding 1: Use IDB.setBatch() — one transaction for all entries, ~10x faster than
  // per-key ContentDB.set() which re-opens the connection each time.
  const ts = new Date().toISOString();
  const entries = [];

  for (const [topic, data] of Object.entries(BUNDLED_CONTENT.openrn)) {
    entries.push([`content:openrn:${topic}`, { ...data, indexedAt: ts }]);
  }
  for (const [book, data] of Object.entries(BUNDLED_CONTENT.openstax.ngn)) {
    entries.push([`content:openstax:ngn:${book}`, { ...data, indexedAt: ts }]);
  }

  onProgress(`Writing ${entries.length} textbook entries to IndexedDB...`);
  await IDB.setBatch(entries);  // single transaction — completes in < 2 seconds on mobile
  onProgress('Textbooks indexed.');
}
```

This runs in Phase 1 of onboarding — fast (no network calls) and always succeeds.

### 4.2 Static Drug Content Loader

**Curated drug NCLEX summaries** — `content:drug_nclex:{drugname}`:
Prof. Linda's curated summaries from `NCLEX_Drug_List_Prof_Linda.md`, one entry per drug. Contains only NCLEX-relevant clinical facts: drug class, primary indication, hold parameters, black box warnings, key nursing considerations. Approximately 300-500 bytes per drug × 319 drugs = ~130KB total. Stored in localStorage. These are used by question generators as context — not the full FDA label.

```javascript
// Example: content:drug_nclex:metoprolol
{
  name: "metoprolol",
  class: "Beta-blocker (cardioselective)",
  indication: "Hypertension, angina, heart failure, post-MI",
  hold: "Hold if HR < 60 or SBP < 90",
  blackBox: "Do not abruptly discontinue — risk of rebound hypertension/angina",
  nursing: "Monitor HR and BP; teach patient not to stop abruptly; mask hypoglycemia signs",
  suffix: "-olol"
}
```

**Herbal supplements, IV fluids, vaccines** — `content:static:{category}`:
Not FDA-regulated — no openFDA data. Pre-populated as static entries, bundled with the app, loaded instantly. No TTL — updated only on app version release via `NCLEX_Drug_List_Prof_Linda.md`.

See the full static entries (garlic, ginseng, echinacea, valerian, saw palmetto, kava, all IV fluids, all vaccines/biologics) in the drug list reference document. Each entry follows the same schema as FDA drug entries with `isStatic: true` and `source: 'Static'` fields.

```javascript
async function indexStaticDrugContent(onProgress) {
  onProgress('Loading herbal supplements, IV fluids, vaccines...');
  for (const [key, data] of Object.entries(STATIC_DRUG_CONTENT)) {
    await ContentDB.set(`content:static:${key}`, {
      ...data, indexedAt: new Date().toISOString(), isStatic: true
    });
  }
}
```

### 4.2 Static Content Pre-Population

Herbal supplements, IV fluids, lab values, dosage formulas, NCLEX strategies, therapeutic communication, delegation rules, health equity, drug suffix patterns, pediatric development, and infection control precautions have no API source. They are pre-populated as static entries during onboarding — loaded once from the bundled `STATIC_CONTENT` object, never re-fetched.

```javascript
// STATIC_CONTENT — bundled in the app, loaded into ContentDB on first run
const STATIC_CONTENT_KEYS = [
  // Drug NCLEX summaries — curated by Prof. Linda, one per drug (~130KB total)
  // Generated from NCLEX_Drug_List_Prof_Linda.md at build time
  ...PHARM_DRUGS.map(d => `content:drug_nclex:${d.name}`),

  "content:static:herbals",    // 8 herbal supplements — no openFDA data
  "content:static:ivfluids",   // 7 IV fluids — not prescription drugs
  "content:labs",              // CBC, BMP, ABGs, coagulation, therapeutic drug levels
  "content:formulas",          // Dosage calculation formula bank
  "content:strategies",        // 2026 NCLEX test plan, CAT stopping rules, NGN types, exam day procedures
  "content:diagnostics",       // Pre/post-procedure nursing care — all high-yield procedures
  "content:communication",     // Therapeutic vs non-therapeutic communication
  "content:delegation",        // RN/LPN/UAP scope, 5 rights of delegation, priority frameworks
  "content:health_equity",     // 2026 NCLEX #1 new emphasis: SDOH 5 domains, unbiased care, client dignity, updated terminology
  "content:drug_suffixes",     // Drug naming patterns: -olol → beta-blocker, -pril → ACE inhibitor, etc. 20+ high-yield patterns
  "content:development",       // Erikson stages, Piaget, motor/language milestones by age, NCLEX red flags
  "content:infection_control", // Isolation precautions (contact/droplet/airborne), PPE donning/doffing, C. diff, sterile technique
];

async function loadStaticContent(onProgress) {
  for (const key of STATIC_CONTENT_KEYS) {
    onProgress("Loading " + key.split(':').slice(1).join(':') + "...");
    // STATIC_CONTENT is a bundled JS object — same approach as BUNDLED_CONTENT for OpenRN
    await ContentDB.set(key, {
      ...STATIC_CONTENT[key],
      indexedAt: new Date().toISOString()
    });
  }
}
```

**Why static for these categories:**
- Herbal supplements: dietary supplements are not FDA-regulated — openFDA returns no results
- IV fluids: not prescription drugs — no drug label exists
- Lab values, formulas, strategies, communication, delegation: authoritative content that changes infrequently; curated offline by Prof. Linda T. and bundled with the app

These entries are indexed in ~1 second (no network calls). They are displayed with source attribution: "Curated by Prof. Linda T., MSN, RN, CNE — 2026."

### 4.3 Government API Indexer

~300 FDA-regulated drugs via openFDA, RxNorm, and MedlinePlus. Called during onboarding at rate-limited intervals (~90 seconds total first run). Herbal supplements and IV fluids are handled as static content (see §4.2) — no API calls needed for those 15 entries:

```javascript
async function indexFDADrugs(drugs, onProgress) {
  for (const drug of drugs) {
    onProgress(`Indexing FDA: ${drug}...`);
    try {
      const res = await fetch(
        `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${drug}"&limit=1`,
        { signal: AbortSignal.timeout(10000) }
      );
      const data = await res.json();
      const result = data.results?.[0];
      if (result) {
        await ContentDB.set(`content:fda:${drug}`, {
          name: drug,
          warnings: result.warnings?.[0]?.substring(0, 1000) || result.boxed_warning?.[0]?.substring(0, 1000) || "",
          adverseReactions: result.adverse_reactions?.[0]?.substring(0, 800) || "",
          indications: result.indications_and_usage?.[0]?.substring(0, 600) || "",
          contraindications: result.contraindications?.[0]?.substring(0, 600) || "",
          dosage: result.dosage_and_administration?.[0]?.substring(0, 600) || "",
          indexedAt: new Date().toISOString()
        });
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200)); // 5 req/sec to avoid throttling
  }
}

async function indexRxNorm(drugs, onProgress) {
  for (const drug of drugs) {
    onProgress(`Indexing RxNorm: ${drug}...`);
    try {
      // Get RxCUI
      const cuiRes = await fetch(
        `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drug)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const cuiData = await cuiRes.json();
      const rxcui = cuiData?.idGroup?.rxnormId?.[0];
      if (!rxcui) continue;

      // Get drug class
      const classRes = await fetch(
        `https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui=${rxcui}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const classData = await classRes.json();
      const drugClass = classData?.rxclassDrugInfoList?.rxclassDrugInfo?.[0]?.rxclassMinConceptItem?.className || "";

      await ContentDB.set(`content:rxnorm:${drug}`, { name: drug, rxcui, drugClass, indexedAt: new Date().toISOString() });
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
}

async function indexMedlinePlus(topics, onProgress) {
  for (const topic of topics) {
    onProgress(`Indexing MedlinePlus: ${topic}...`);
    try {
      const term = encodeURIComponent(topic.replace(/&/g, "and"));
      const res = await fetch(
        `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${term}&retmax=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      const xml = await res.text();
      const summaryMatch = xml.match(/<content name="FullSummary">([\s\S]*?)<\/content>/);
      const titleMatch = xml.match(/<content name="title">([\s\S]*?)<\/content>/);
      if (summaryMatch) {
        const summary = summaryMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
        await ContentDB.set(`content:medline:${topic.toLowerCase().replace(/\s+/g, '-')}`, {
          topic, title: titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || topic,
          summary: summary.substring(0, 2000), indexedAt: new Date().toISOString()
        });
      }
    } catch {}
    await new Promise(r => setTimeout(r, 150)); // stay under 85 req/min limit
  }
}
```

---

## 5. Onboarding Screen

The onboarding screen runs once on first launch (detected by absence of `db:meta`). It is a full-screen overlay that shows real-time progress.

```javascript
// Onboarding state machine
const ONBOARD_STEPS = [
  { id: "fda",      label: "Indexing FDA drug labels",          weight: 20 },
  { id: "rxnorm",   label: "Indexing drug interactions",        weight: 10 },
  { id: "medline",  label: "Indexing health topics",            weight: 15 },
  { id: "openrn",   label: "Indexing OpenRN textbooks",         weight: 35 },
  { id: "openstax", label: "Indexing OpenStax NGN case studies",weight: 20 },
];
// Total = 100. Progress bar advances proportionally.
```

**Error handling:** If any source fails (CORS blocked, network timeout), mark it as `status: "failed"` in `db:meta` and continue. The app must function without any single source. Show a warning badge in Content Admin but do not block the student.

**Re-indexing:** User can trigger a full or partial re-index from Content Admin at any time. Individual source refresh buttons allow updating a single source without re-indexing everything.

---

## 6. Question Generation — Updated

All generators are updated to pull from ContentDB. Live API calls are eliminated for question generation.

```javascript
async function getContextFromDB(topic, qtype) {
  // For pharmacology: rotate through indexed FDA labels
  if (topic === "Pharmacology") {
    pharmDrugIndex++;
    const drug = PHARM_DRUGS[pharmDrugIndex % PHARM_DRUGS.length];
    // Use curated NCLEX summary from localStorage (instant, always available)
    // Full FDA label available via /api/content/fda/{drug} for voice assistant deep queries
    const fdaData = await ContentDB.get(`content:drug_nclex:${drug}`);
    const rxData = await ContentDB.get(`content:rxnorm:${drug}`);
    if (!fdaData) return ""; // graceful fallback
    return `openFDA label for ${fdaData.name} (${rxData?.drugClass || "unknown class"}):
Indications: ${fdaData.indications}
Warnings: ${fdaData.warnings}
Adverse reactions: ${fdaData.adverseReactions}
Contraindications: ${fdaData.contraindications}`;
  }

  // For other topics: use OpenRN chapter text + MedlinePlus summary
  const topicKey = topic.toLowerCase().replace(/\s+/g, '-').replace(/&/g, 'and');
  const openrnKey = TOPIC_TO_OPENRN_KEY[topic]; // mapping from NCLEX topic to OpenRN key
  const [openrnData, medlineData] = await Promise.all([
    openrnKey ? ContentDB.get(`content:openrn:${openrnKey}`) : null,
    ContentDB.get(`content:medline:${topicKey}`)
  ]);

  let ctx = "";
  if (openrnData?.chapters?.length) {
    // Use most relevant chapter excerpt — pick first 1500 chars
    ctx += `OpenRN (CC-BY 4.0) on ${topic}:\n${openrnData.chapters[0].text.substring(0, 1500)}\n\n`;
  }
  if (medlineData?.summary) {
    ctx += `MedlinePlus on ${medlineData.title}:\n${medlineData.summary.substring(0, 800)}`;
  }
  return ctx;
}
```

### 6.1 Question Schema — v2.0

Full question schema including per-option rationale (UWorld parity) and NCJMM step tag:

```javascript
{
  type: "multiple_choice",            // multiple_choice | sata | dosage | ngn
  question: "...",
  options: { A: "...", B: "...", C: "...", D: "..." },
  correct: "A",

  // Per-option rationale — required on every question
  // Explains why correct is right AND why each wrong answer is wrong
  rationale: {
    correct: "A is correct: [clinical reasoning tied to NCJMM step and source]",
    incorrect: {
      B: "B is incorrect: [why plausible but wrong]",
      C: "C is incorrect: [why plausible but wrong]",
      D: "D is incorrect: [why plausible but wrong]"
    }
  },

  ncjmmStep: "Prioritize Hypotheses",  // required — one of:
                                        // "Recognize Cues" | "Analyze Cues" | "Prioritize Hypotheses"
                                        // "Generate Solutions" | "Take Action" | "Evaluate Outcomes"

  topic: "Pharmacology",               // NCLEX Client Needs category
  difficulty: "Medium",                // "Easy" | "Medium" | "Hard"
  sources: ["openFDA — metoprolol", "RxNorm — beta-blocker class"],
  drugName: "metoprolol"               // pharmacology questions only
}
```

**Claude prompt requirement — two-step generation with NCJMM validation:**

All question generators use a two-step approach in a single API call:

**Step 1 — Generate with NCJMM self-tagging:**
```
Generate an NCLEX-RN question on [topic].

NCJMM STEP DEFINITIONS — use these to assign the correct step:
- Recognize Cues: identifying relevant/abnormal data in the clinical scenario
- Analyze Cues: connecting cues to understand what is clinically happening
- Prioritize Hypotheses: ranking urgency / identifying the priority concern
- Generate Solutions: planning interventions to address the identified problem
- Take Action: what should the nurse DO first — implementing the intervention
- Evaluate Outcomes: assessing whether the intervention worked / expected vs unexpected

After the question, write:
ASSIGNED_NCJMM_STEP: [step name]
STEP_RATIONALE: [one sentence why this question tests that step]
```

**Step 2 — Self-validation (same call, second instruction):**
```
Review your NCJMM step assignment. Re-read the question stem — does it ask the student
to perform the action described in your assigned step definition?
Common errors to check: "Take Action" vs "Generate Solutions" confusion,
"Recognize Cues" vs "Analyze Cues" confusion.
If your assignment is wrong, correct it.
CONFIRMED_NCJMM_STEP: [final step name]
```

The `ncjmmStep` field is populated from `CONFIRMED_NCJMM_STEP`. This two-step self-check significantly reduces the most common tagging errors.

**Rationale format instruction (also required in every generator prompt):**
```
After the correct answer, explain why each wrong answer is incorrect:
CORRECT (X): [clinical reasoning, NCLEX framework applied, source cited]
INCORRECT (A): [why plausible but wrong — be specific, not generic]
INCORRECT (B): [why plausible but wrong]
INCORRECT (C): [why plausible but wrong]
Every option must be addressed. Explanations must be clinically specific.
```

Source attribution chips displayed under each question card. NCJMM step displayed as a small label ("🧠 Prioritize Hypotheses") for student awareness.

---

## 7. NGN Case Study — v2

### 7.1 OpenStax-Grounded Generation

When OpenStax content is indexed, NGN case generation uses it as a structural template. A clinical safety guardrail is applied after generation: Claude reviews each answer in the case and flags any nursing action that would cause patient harm.

**NGN generation prompt — safety review suffix (required on every NGN generation):**
```
After generating the full case study, review each step answer.
For any step where the correct nursing action could cause direct patient harm if performed:
- Flag it with SAFETY_REVIEW_REQUIRED: [step number] [concern]
If no steps have safety concerns, write: SAFETY_REVIEW_PASSED
The case study must not teach incorrect or harmful clinical reasoning.
```

If `SAFETY_REVIEW_REQUIRED` appears in the response, the case is discarded and regenerated with a stricter prompt. After two consecutive failures, fall back to an OpenStax template case on the same topic without patient variation.

```javascript
async function generateNGNCaseStudy(topic) {
  // 1. Look for matching OpenStax content
  const openstaxBooks = ["medsurg","fundamentals","maternal","peds","psych"];
  let template = null;
  for (const book of openstaxBooks) {
    const data = await ContentDB.get(`content:openstax:ngn:${book}`);
    if (data?.cases?.some(c => c.topic?.toLowerCase().includes(topic?.toLowerCase()))) {
      template = data.cases.find(c => c.topic?.toLowerCase().includes(topic?.toLowerCase()));
      break;
    }
  }

  // 2. Build generation prompt — grounded in template if found
  const templateContext = template
    ? `Use this OpenStax faculty-authored case study as a structural template (adapt patient details, preserve clinical judgment framework):\n${JSON.stringify(template).substring(0, 2000)}`
    : `Generate a realistic clinical case study for: ${topic}`;

  // 3. Generate chart + questions (existing two-call approach)
  // ... unchanged from v4, but now with source context
}
```

### 7.2 Case Completion Screen

New `MODES.NGN_COMPLETE` screen. Triggered when `ngnIndex >= 5` and the final question is revealed.

```javascript
// ngnAnswers shape
[
  { step: 1, stepName: "Recognize Cues",        correct: true,  score: 4, total: 5, pct: 80 },
  { step: 2, stepName: "Analyze Cues",          correct: true },
  { step: 3, stepName: "Prioritize Hypotheses", correct: false, score: 1, total: 3, pct: 33 },
  { step: 4, stepName: "Generate Solutions",    correct: true },
  { step: 5, stepName: "Take Action",           correct: true,  score: 5, total: 5, pct: 100 },
  { step: 6, stepName: "Evaluate Outcomes",     correct: false },
]

// Score calculation
const totalPoints = ngnAnswers.reduce((acc, a) => {
  if (a.pct !== undefined) return acc + a.pct; // SATA: use partial credit %
  return acc + (a.correct ? 100 : 0);          // MC: binary
}, 0);
const overallPct = Math.round(totalPoints / 6);
```

### 7.3 Expanded NGN Topics

Topics derived from OpenStax and OpenRN indexed content. Minimum 40:

**Cardiovascular:** Heart Failure, Myocardial Infarction, Hypertensive Crisis, Atrial Fibrillation, Pulmonary Embolism  
**Respiratory:** COPD Exacerbation, Pneumonia, Asthma, Pneumothorax, ARDS  
**Neurological:** Stroke (Ischemic), Seizure Disorder, Increased ICP, Meningitis  
**Renal/Endocrine:** Acute Kidney Injury, DKA, HHNS, Adrenal Crisis, Thyroid Storm  
**GI/Surgical:** GI Bleed, Bowel Obstruction, Post-op Complications, Peritonitis  
**Infectious:** Sepsis, C. diff, HIV/AIDS Complications, Wound Infection  
**Psychiatric:** Alcohol Withdrawal, Acute Psychosis, Suicidal Ideation, Opioid Overdose  
**Obstetric:** Preeclampsia, Postpartum Hemorrhage, Placental Abruption, Ectopic Pregnancy  
**Pediatric:** Pediatric Respiratory Distress, Febrile Seizure, Dehydration, Meningitis (Peds)  
**Hematology:** Sickle Cell Crisis, DVT, DIC, Anemia Management

---

## 8. Cross-Session Stats Persistence

Stats are stored in `db:stats` and loaded on every app open.

```javascript
// db:stats value shape — v2.0
{
  // Topic performance (by NCLEX Client Needs category)
  topicScores: {
    "Pharmacology": { correct: 45, answered: 60 },
    "Management of Care": { correct: 12, answered: 20 },
    // ...all 8 NCLEX categories
  },

  // NCJMM step performance — new in v2.0
  // Populated from ncjmmStep tag on every answered question
  ncjmmStepScores: {
    "Recognize Cues":       { correct: 28, answered: 35 },
    "Analyze Cues":         { correct: 22, answered: 30 },
    "Prioritize Hypotheses":{ correct: 14, answered: 34 },  // often the weakest
    "Generate Solutions":   { correct: 19, answered: 25 },
    "Take Action":          { correct: 31, answered: 38 },
    "Evaluate Outcomes":    { correct: 17, answered: 22 },
  },

  // Readiness score — computed server-side on each stats PUT, stored for display
  // Algorithm: weighted average of topicScores (by NCLEX category %)
  //            + ncjmmStepScores (Prioritize Hypotheses weighted 1.5x — most common failure)
  //            + recency factor (last 100 questions weighted 2x older history)
  readinessScore: 68,          // 0-100, displayed as percentage
  readinessBand: "On Track",   // "Needs Work" | "On Track" | "Strong" | "High Confidence"

  // Exam date for study plan generation
  examDate: "2026-04-15",      // ISO date, set by student on first run or settings

  totalAnswered: 340,
  totalCorrect: 251,
  streak: 7,
  bestStreak: 14,
  sataPracticed: 42,
  dosagePracticed: 18,
  ngnCasesCompleted: 5,
  lastStudied: "2026-03-30",
  sessionHistory: [
    { topic: "Pharmacology", qtype: "multiple_choice", ncjmmStep: "Take Action",
      correct: true, timestamp: "...", questionId: "..." },
    // last 200 entries — server enforces takeLast(200)
  ],

  // Spaced repetition queue — due dates for flagged questions + flashcards
  spacedRepQueue: [
    { id: "uuid-of-flagged-question", type: "question", dueDate: "2026-04-01",
      category: "Confused", consecutiveCorrect: 0 },
    { id: "uuid-of-flashcard", type: "flashcard", dueDate: "2026-04-02",
      front: "Heparin antidote?", back: "Protamine sulfate — 1mg per 100 units",
      consecutiveCorrect: 1 }
    // archived when consecutiveCorrect >= 3
  ]
}
```

Stats are persisted to PostgreSQL via `UserDB.saveStats()` on every `updateStats()` call.
The `readinessScore` is computed server-side in `StatsController` on each PUT to avoid client-side manipulation.
The `spacedRepQueue` drives the "Due for review" badge and focused review mode.

---

## 9. UX Component Changes

### 9.1 Skeleton Loading
Replace all spinners with skeleton screens. A skeleton screen renders the question card outline (grey placeholder blocks) before content arrives.

```jsx
function QuestionSkeleton() {
  return (
    <div style={{ ...S.qCard, opacity: 0.6 }}>
      <div style={{ height: 20, background: C.border, borderRadius: 4, width: "30%", marginBottom: 12 }} />
      <div style={{ height: 16, background: C.border, borderRadius: 4, width: "100%", marginBottom: 6 }} />
      <div style={{ height: 16, background: C.border, borderRadius: 4, width: "90%", marginBottom: 6 }} />
      <div style={{ height: 16, background: C.border, borderRadius: 4, width: "80%", marginBottom: 20 }} />
      {["A","B","C","D"].map(l => (
        <div key={l} style={{ height: 44, background: C.border, borderRadius: 8, marginBottom: 8 }} />
      ))}
    </div>
  );
}
```

### 9.2 Source Badges on Questions
Every question card shows a source attribution row:

```jsx
{question.sources?.length > 0 && (
  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
    {question.sources.map((s, i) => (
      <span key={i} style={{ fontSize: 10, color: C.textMuted, background: C.bg, 
        border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 6px" }}>
        📚 {s}
      </span>
    ))}
  </div>
)}
```

### 9.3 Home Screen — All-Time Stats
Stats panel updated to pull from `db:stats` with all-time figures. Toggle between "This Session" and "All Time".

### 9.4 Admin Dashboard — `/admin` Route

Role-gated route — only rendered for `role === 'admin'`. Non-admin users who navigate to `/admin` receive a 403 screen. The route is not linked in any UI element visible to `user` role accounts.

Admin is assigned once via PostgreSQL console on first deploy:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

The dashboard has five tabs:

**Tab 1 — Users**
Full CRUD table of all registered users.
```javascript
// Columns: email | role | created | last_active | total_answered | readiness_band | actions
// Actions per row:
//   Edit — modal: change email, role (user↔admin), exam_date
//   Reset password — admin sets temporary password; student forced to change on next login
//   View stats — read-only stats snapshot in side panel
//   Impersonate — loads student's home screen in read-only preview mode (no writes)
//   Delete — soft-delete: sets is_active=false, anonymizes email to deleted_{uuid}@deleted
//            Hard-delete button shown separately with confirmation dialog
```

**Tab 2 — KPIs**
Auto-refreshes every 60 seconds. All queries are aggregations over existing tables — no new data collection needed.

```javascript
const KPI_QUERIES = {
  // Growth & Engagement
  totalUsers:    "SELECT COUNT(*) FROM users WHERE is_active = true",
  dau:           "SELECT COUNT(DISTINCT user_id) FROM user_stats WHERE last_studied >= NOW() - INTERVAL '1 day'",
  wau:           "SELECT COUNT(DISTINCT user_id) FROM user_stats WHERE last_studied >= NOW() - INTERVAL '7 days'",
  mau:           "SELECT COUNT(DISTINCT user_id) FROM user_stats WHERE last_studied >= NOW() - INTERVAL '30 days'",
  newLast7:      "SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days'",
  retention7d:   `SELECT ROUND(100.0 * COUNT(CASE WHEN last_studied >= created_at + INTERVAL '7 days' THEN 1 END)
                   / NULLIF(COUNT(*), 0), 1) FROM users u JOIN user_stats s ON u.id = s.user_id
                   WHERE u.created_at <= NOW() - INTERVAL '7 days'`,

  // Content Quality
  totalQuestions: "SELECT SUM(total_answered) FROM user_stats",
  avgReadiness:   "SELECT ROUND(AVG(readiness_score), 1) FROM user_stats WHERE total_answered >= 50",
  bandDist:       "SELECT readiness_band, COUNT(*) FROM user_stats WHERE total_answered >= 50 GROUP BY readiness_band",
  weakestStep:    `SELECT key as step, ROUND(100.0 * SUM((value->>'correct')::int)
                   / NULLIF(SUM((value->>'answered')::int), 0), 1) as accuracy
                   FROM user_stats, jsonb_each(ncjmm_step_scores) ORDER BY accuracy ASC LIMIT 1`,
  unreviewedReports: "SELECT COUNT(*) FROM question_reports WHERE reviewed = false",

  // Cost
  claudeCallsToday:  "SELECT COUNT(*) FROM audit_log WHERE event_type = 'CLAUDE_CALL' AND created_at >= NOW()::date",
  claudeCallsMonth:  "SELECT COUNT(*) FROM audit_log WHERE event_type = 'CLAUDE_CALL' AND created_at >= date_trunc('month', NOW())",
  rateLimitHitsToday:"SELECT COUNT(*) FROM audit_log WHERE event_type = 'RATE_LIMIT' AND created_at >= NOW()::date",
  lastCacheRefresh:  "SELECT MAX(created_at), metadata FROM audit_log WHERE event_type = 'CACHE_REFRESH' GROUP BY metadata ORDER BY 1 DESC LIMIT 1",
};

// Cost estimate: Claude API calls × avg 2,000 tokens × $3/MTok = ~$0.006/call
// Displayed as: "Est. cost this month: $X.XX"
```

**Tab 3 — Question Reports**
Full report review queue replacing the badge count.
```javascript
// Table columns: submitted | user (anonymized) | category | topic | ncjmmStep | actions
// Row expansion: full question text, all options, rationale
// Actions: Mark reviewed ✓ | Flag for fix 🔧 | Dismiss ✗
// Highlighting: 2+ same-category reports → amber | 3+ → red, sorted to top
// Filters: unreviewed only | by category | by topic | by date range
```

**Tab 4 — Audit Log**
Searchable, paginated view of `audit_log` table.
```javascript
// Columns: timestamp | event_type | user | actor (for admin actions) | metadata
// Filters: by event_type | by user email | by date range
// Export: CSV download of filtered result set
// Pagination: 50 rows/page
```

**Tab 5 — Content**
Existing Content Admin screen merged here.
```javascript
// Content cache: key | source | indexed_at | TTL remaining | manual refresh button
// Textbook status: which books downloaded by how many users (COUNT from IndexedDB metadata)
// Batch job history: last 10 cache refresh runs with counts and failure details
// Manual triggers: "Refresh all cache" | per-source refresh buttons
```

---

## 9.5 Spaced Repetition Scheduling

The `spacedRepQueue` in `db:stats` drives all spaced repetition. Intervals follow a simplified SM-2 model:

```javascript
const SPACED_REP_INTERVALS = {
  "Confused":      [1, 3, 7, 14],   // days between reviews
  "Guessed":       [3, 7, 14],
  "Review later":  [7, 14],
  "flashcard":     [1, 3, 7, 14, 30]
};

function getNextDueDate(item, wasCorrect) {
  if (!wasCorrect) {
    // Reset to first interval
    item.consecutiveCorrect = 0;
    const intervals = SPACED_REP_INTERVALS[item.type] || SPACED_REP_INTERVALS["Confused"];
    return addDays(today(), intervals[0]);
  }
  item.consecutiveCorrect++;
  const intervals = SPACED_REP_INTERVALS[item.type] || SPACED_REP_INTERVALS["Confused"];
  if (item.consecutiveCorrect >= intervals.length) {
    return null; // archived — mastered
  }
  return addDays(today(), intervals[item.consecutiveCorrect]);
}

function getDueItems(queue) {
  return queue.filter(item =>
    item.dueDate && new Date(item.dueDate) <= new Date() && item.dueDate !== null
  );
}
```

**AI flashcard generation from rationale:**
```javascript
async function generateFlashcard(question, rationale) {
  const prompt = `From this NCLEX rationale, extract the single most important clinical fact and format it as a flashcard.
Rationale: ${rationale.correct}
Source: ${question.sources[0]}

Respond with JSON only:
{ "front": "one clinical question (max 15 words)", "back": "concise answer with key number or action (max 25 words)
Source: [source]" }`;

  const res = await fetch('/api/claude', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context: 'flashcard_gen' })
  });
  return JSON.parse((await res.json()).content[0].text);
}
```

## 9.6 NCLEX Readiness Score Calculation

Computed server-side in `StatsController.kt` on every PUT to `/api/stats`:

```kotlin
fun computeReadinessScore(stats: UserStats): Int {
  // NCLEX category weights (from 2026 test plan midpoints)
  val categoryWeights = mapOf(
    "Management of Care" to 0.17,
    "Safety and Infection Prevention and Control" to 0.12,
    "Health Promotion and Maintenance" to 0.09,
    "Psychosocial Integrity" to 0.09,
    "Basic Care and Comfort" to 0.09,
    "Pharmacological and Parenteral Therapies" to 0.16,
    "Reduction of Risk Potential" to 0.12,
    "Physiological Adaptation" to 0.14
  )

  // Base score: weighted topic accuracy
  val baseScore = categoryWeights.entries.sumOf { (category, weight) ->
    val score = stats.topicScores[category]
    if (score != null && score.answered > 0)
      (score.correct.toDouble() / score.answered) * weight * 100
    else 0.0
  }

  // NCJMM step modifier: Prioritize Hypotheses weighted 1.5x (most common failure)
  val ncjmmBonus = stats.ncjmmStepScores.entries.sumOf { (step, score) ->
    if (score.answered < 5) return@sumOf 0.0
    val accuracy = score.correct.toDouble() / score.answered
    val weight = if (step == "Prioritize Hypotheses") 1.5 else 1.0
    accuracy * weight
  } / (stats.ncjmmStepScores.size * 1.1) * 10  // normalize to ~10 point bonus

  // Recency factor: last 100 questions weighted 2x
  val recentHistory = stats.history.takeLast(100)
  val recentScore = if (recentHistory.isEmpty()) baseScore
  else recentHistory.count { it.correct }.toDouble() / recentHistory.size * 100
  val recencyAdjusted = (baseScore * 0.6) + (recentScore * 0.4)

  return minOf(100, maxOf(0, (recencyAdjusted + ncjmmBonus).toInt()))
}

// Minimum threshold — score only meaningful after 50+ questions across 3+ categories
fun hasMinimumData(stats: UserStats): Boolean {
  val categoriesWithData = stats.topicScores.count { (_, score) -> score.answered >= 5 }
  return stats.totalAnswered >= 50 && categoriesWithData >= 3
}

fun readinessBand(score: Int) = when {
  score < 55 -> "Needs Work"
  score < 70 -> "On Track"
  score < 80 -> "Strong"
  else       -> "High Confidence"
}

// Minimum threshold: 50 questions across 3+ different topics before score is shown
fun readinessEligible(stats: UserStats): Boolean {
  val topicsWithData = stats.topicScores.count { (_, s) -> s.answered >= 5 }
  return stats.totalAnswered >= 50 && topicsWithData >= 3
}
```

## 9.7 Timed Exam Mode — NCLEX Fidelity

The exam mode simulates actual NCLEX conditions:

```javascript
const EXAM_MODE_CONFIG = {
  timeLimit: 5 * 60 * 60 * 1000,  // 5 hours in ms
  minQuestions: 70,
  maxQuestions: 135,
  pilotQuestions: 15,              // mixed in, unscored — student cannot identify them
  noGoingBack: true,               // once submitted, cannot revisit
  rationalesLocked: true,          // shown only in end report
  canSkip: false,                  // every question must be answered
  breakReminders: [30, 70],        // remind at these question counts
};

// Exam mode state — no drawer, no voice assistant, no reader
const [examState, setExamState] = useState({
  questions: [],           // pre-generated queue
  currentIndex: 0,
  answers: {},             // { [index]: selectedAnswer }
  startTime: Date.now(),
  finished: false,
  timerExpired: false,
});

// No going back — submit is final
function handleExamAnswer(answer) {
  setExamState(prev => ({
    ...prev,
    answers: { ...prev.answers, [prev.currentIndex]: answer },
    currentIndex: prev.currentIndex + 1,  // advance immediately, no undo
    finished: prev.currentIndex + 1 >= prev.questions.length
  }));
}
```

**End-of-exam report** (shown when `finished === true`):
- Total score and readiness band
- Per-topic breakdown with color coding
- Per-NCJMM-step breakdown
- Readiness score updated
- Every question reviewable with full per-option rationale
- "Weakest area" call-out with direct link to drill that topic

---

## 9.8 Offline Mode — Technical Design

### 9.8.1 Architecture Overview

Offline mode requires no backend changes. Everything lives on the client:

```
localStorage keys added for offline mode:
  content:offline:bank          — 100 pre-generated questions (rotated each session)
  sync:pending                  — queued stat/flag updates awaiting network
  offline:meta                  — bank generation timestamp, question count, composition
```

Three principles:
1. **Degrade gracefully** — features that require internet show clear "unavailable offline" messages, never silent failures
2. **Never lose data** — all interactions while offline are queued and synced automatically
3. **Fill the bank proactively** — bank generation runs after every online session, not when the student goes offline

### 9.8.2 Connectivity Detection

Two-layer check because `navigator.onLine` returns `true` even on captive portal networks with no real connectivity:

```javascript
// connectivity.js
const HEALTH_ENDPOINT = '/api/health';
let onlineStatus = navigator.onLine;

async function checkConnectivity() {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)  // 3 second timeout
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Poll every 30 seconds when app is active
let connectivityInterval = null;

function startConnectivityMonitor(onStatusChange) {
  window.addEventListener('online', async () => {
    const reallyOnline = await checkConnectivity();
    if (reallyOnline) onStatusChange(true);
  });
  window.addEventListener('offline', () => onStatusChange(false));

  connectivityInterval = setInterval(async () => {
    const status = await checkConnectivity();
    if (status !== onlineStatus) {
      onlineStatus = status;
      onStatusChange(status);
    }
  }, 30000);
}
```

### 9.8.3 Offline Bank Generation

Runs silently after every successful online session. Triggered when the student closes or backgrounds the app, or after 60 seconds of inactivity. Does not block the UI.

```javascript
const BANK_SIZE = 100;

// Bank regeneration policy:
// - Regenerate only when bank drops below 30 questions (not every session)
// - This prevents excessive Claude API spend on students with short sessions
// - Cost model: ~100 questions × $0.003/question = ~$0.30 per regeneration
//   At 100 DAU regenerating every 3-4 sessions: ~$10-15/day API cost for offline banks
// - Regeneration runs as a background job — never blocks the UI
// - If student closes app before completion, partial bank is preserved and resumed

// Bank composition — weighted toward weak areas
async function buildOfflineBankComposition(stats) {
  const weakTopics = getWeakTopics(stats, 3);  // bottom 3 NCLEX categories
  return [
    { mode: 'mc',       count: 20, topicBias: weakTopics },
    { mode: 'sata',     count: 20, topicBias: null },
    { mode: 'pharm',    count: 15, topicBias: null },  // rotated drug list
    { mode: 'dosage',   count: 15, topicBias: null },
    { mode: 'ngn',      count: 15, topicBias: null },  // 2-3 full 6-step cases
    { mode: 'mc',       count: 15, topicBias: null },  // mixed topics
  ];
}

// Offline bank regeneration — once per day maximum, cross-device
// SA Finding 7: lastGenerated moved from localStorage (offline:meta) to PostgreSQL (user_stats.offlineBankGeneratedAt)
// Prevents multi-device scenario where phone + laptop each trigger a $0.30 generation on the same day.
async function shouldRegenerateBank() {
  // Check server-side timestamp first (cross-device source of truth)
  const stats = await UserDB.getStats();
  if (stats?.offlineBankGeneratedAt) {
    const hoursSince = (Date.now() - new Date(stats.offlineBankGeneratedAt).getTime()) / 36e5;
    if (hoursSince < 24) return false;  // already generated today on any device
  }
  // Fall back to local meta if stats unavailable (offline)
  const meta = await ContentDB.get('offline:meta');
  if (!meta) return true;
  const hoursSinceGen = (Date.now() - new Date(meta.generatedAt).getTime()) / 36e5;
  return hoursSinceGen >= 24;
}

async function generateOfflineBank(stats) {
  const composition = await buildOfflineBankComposition(stats);
  const bank = [];

  for (const batch of composition) {
    for (let i = 0; i < batch.count; i++) {
      try {
        const q = await generateQuestion(batch.mode, batch.topicBias?.[i % 3]);
        bank.push(q);
      } catch {
        // Skip failed generations — bank may be smaller than 100
        continue;
      }
    }
  }

  await ContentDB.set('content:offline:bank', {
    questions: bank,
    generatedAt: new Date().toISOString(),
    count: bank.length,
    composition: composition.map(b => ({ mode: b.mode, count: b.count }))
  });

  await ContentDB.set('offline:meta', {
    bankSize: bank.length,
    generatedAt: new Date().toISOString(),
    weakTopics: getWeakTopics(stats, 3)
  });
}
```

**Bank rotation:** Each new generation replaces the entire bank. Questions already answered in the current session are tracked in `sessionState` to avoid showing duplicates from the bank.

**Bank staleness:** If the bank was generated more than 7 days ago, show a soft warning: "Your offline question bank was last updated 9 days ago. Open the app with internet to refresh it."

### 9.8.4 Offline Question Serving

```javascript
class OfflineQuestionManager {
  constructor() {
    this.bank = null;
    this.usedIndices = new Set();
  }

  async load() {
    const data = await ContentDB.get('content:offline:bank');
    this.bank = data?.questions || [];
  }

  getNext(preferredMode = null) {
    if (!this.bank || this.bank.length === 0) return null;

    // Find unused question, prefer preferred mode
    const available = this.bank
      .map((q, i) => ({ q, i }))
      .filter(({ i }) => !this.usedIndices.has(i))
      .filter(({ q }) => !preferredMode || q.type === preferredMode);

    if (available.length === 0) return null;  // bank exhausted

    const picked = available[Math.floor(Math.random() * available.length)];
    this.usedIndices.add(picked.i);
    return picked.q;
  }

  get remaining() {
    return this.bank ? this.bank.length - this.usedIndices.size : 0;
  }
}
```

### 9.8.5 Pending Sync Queue

All writes that require the backend are queued locally when offline:

```javascript
// sync-queue.js
async function queueOperation(type, payload) {
  const pending = await ContentDB.get('sync:pending') || [];
  pending.push({ type, payload, timestamp: new Date().toISOString(), id: crypto.randomUUID() });
  await ContentDB.set('sync:pending', pending);
}

const SYNC_BATCH_SIZE = 50;    // max ops per flush batch
const SYNC_QUEUE_MAX = 500;    // hard cap — oldest ops dropped if exceeded

async function flushPendingSync() {
  const pending = await ContentDB.get('sync:pending') || [];
  if (pending.length === 0) return;

  // Process in batches to avoid overwhelming the server after long offline periods
  const failed = [];
  for (let i = 0; i < pending.length; i += SYNC_BATCH_SIZE) {
    const batch = pending.slice(i, i + SYNC_BATCH_SIZE);
    for (const op of batch) {
      try {
        await executeOperation(op);
      } catch {
        failed.push(op);
      }
    }
    // Brief pause between batches
    if (i + SYNC_BATCH_SIZE < pending.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  await ContentDB.set('sync:pending', failed);
}

async function queueOperation(type, payload) {
  const pending = await ContentDB.get('sync:pending') || [];

  // Hard cap: drop oldest operations if queue is full
  // Stats snapshots supersede older ones — only keep the latest stats_update
  let trimmed = pending;
  if (pending.length >= SYNC_QUEUE_MAX) {
    // Keep all non-stats ops; replace all stats_updates with just the latest snapshot
    const nonStats = pending.filter(op => op.type !== 'stats_update');
    trimmed = nonStats.slice(-(SYNC_QUEUE_MAX - 1));
    console.warn(`Sync queue at limit — trimmed ${pending.length - trimmed.length} ops`);
  }

  trimmed.push({ type, payload, timestamp: new Date().toISOString(), id: crypto.randomUUID() });
  await ContentDB.set('sync:pending', trimmed);
}

async function executeOperation(op) {
  switch (op.type) {
    case 'stats_update': return UserDB.saveStats(op.payload);
    case 'flag_add':     return UserDB.addFlag(op.payload);
    case 'flag_delete':  return UserDB.deleteFlag(op.payload.id);
    case 'reading_pos':  return UserDB.saveReadingPosition(op.payload.contentKey, op.payload.page);
  }
}

// Flush automatically when connection restores
window.addEventListener('online', async () => {
  const reallyOnline = await checkConnectivity();
  if (reallyOnline) flushPendingSync();
});
```

**Conflict resolution:** Last-write-wins for stats (the offline session's final stats snapshot replaces whatever was on the server). Flag additions are additive — add queued flags to existing server flags. Flag deletions are idempotent — deleting a non-existent flag is a no-op.

### 9.8.6 Offline UI

```javascript
// Offline banner — shown at top of all screens when offline
function OfflineBanner({ bankRemaining }) {
  return (
    <div style={{ background: '#92400e', color: '#fef3c7', padding: '8px 16px',
      fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
      <span>📴 Offline — {bankRemaining} practice questions available</span>
      <span style={{ opacity: 0.8 }}>Sync pending when connected</span>
    </div>
  );
}

// Voice assistant offline message
const VOICE_OFFLINE_MESSAGE =
  "Voice assistant requires an internet connection. " +
  "Your content library, flashcards, and offline question bank are fully available. " +
  "Connect to internet to use the voice assistant.";

// New question generation offline message
const GENERATE_OFFLINE_MESSAGE =
  "New question generation requires internet. " +
  `Using your offline bank (${remaining} questions remaining).`;
```

### 9.8.7 Service Worker (P1 Enhancement)

A lightweight Service Worker caches the app shell so the app loads instantly offline:

```javascript
// sw.js — cache app shell only (not ContentDB data — that's already in localStorage)
const APP_SHELL_CACHE = 'nclex-shell-v1';
const APP_SHELL_FILES = ['/', '/index.html', '/assets/index.js', '/assets/index.css'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => cache.addAll(APP_SHELL_FILES))
  );
});

self.addEventListener('fetch', event => {
  // Cache-first for app shell, network-first for API calls
  if (APP_SHELL_FILES.some(f => event.request.url.endsWith(f))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
  // API calls always go to network (handled by offline queue logic in app)
});
```

Registered in `main.jsx`:
```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
```

**Important:** Service Worker registration only in production build. Never in development (Vite dev server conflicts).

---

## 10. Voice Assistant — Technical Redesign

### 10.1 Architecture Shift

In v4, `buildSystemPrompt()` constructed a system prompt from React props (`currentQuestion`, `currentTopic`, `stats`) — a small slice of runtime state. In v5, the system prompt is built from the full ContentDB corpus loaded at conversation start. The assistant is a closed-domain expert with complete knowledge of every indexed source.

```
v4: Props → buildSystemPrompt() → Claude API
v5: ContentDB corpus + Props → buildSystemPrompt() → Claude API
```

### 10.2 Corpus Loading

When the voice assistant panel opens, it performs a one-time corpus load from ContentDB into memory. This load happens once per panel open session, not on every message.

```javascript
async function loadAssistantCorpus() {
  const corpus = {};

  // Load all indexed FDA labels
  const fdaKeys = await ContentDB.list('content:fda:');
  for (const key of fdaKeys) {
    const data = await ContentDB.get(key);
    if (data) corpus[key] = data;
  }

  // Load RxNorm drug classes
  const rxKeys = await ContentDB.list('content:rxnorm:');
  for (const key of rxKeys) {
    const data = await ContentDB.get(key);
    if (data) corpus[key] = data;
  }

  // Load MedlinePlus summaries (all topics)
  const mlKeys = await ContentDB.list('content:medline:');
  for (const key of mlKeys) {
    const data = await ContentDB.get(key);
    if (data) corpus[key] = data;
  }

  // Load OpenRN chapter excerpts (trimmed — first 800 chars per chapter)
  const openrnKeys = await ContentDB.list('content:openrn:');
  for (const key of openrnKeys) {
    const data = await ContentDB.get(key);
    if (data?.chapters) {
      corpus[key] = {
        topic: data.topic,
        excerpt: data.chapters.map(c => c.text?.substring(0, 800) || "").join("\n---\n")
      };
    }
  }

  return corpus;
}
```

**Memory note:** The corpus is stored in a React `useRef` inside `VoiceAssistant`. It is loaded once when the panel opens and held in memory for the session. Estimated size in memory: ~300-500KB — well within browser limits.

**Context window constraint:** Sonnet 4.6 on the standard API tier has a 200K input token context window. The full ContentDB is ~500K tokens — this exceeds the window entirely and cannot be injected. The excerpt-based approach (~8-10K tokens loaded via `loadAssistantCorpus()`) is the correct and only viable design.

**Latency note:** With a ~8,000-10,000 token system prompt (full corpus injected), each Claude API call via the backend proxy incurs ~1-2 seconds additional latency compared to a minimal system prompt. This is acceptable for a voice study assistant but must be measured in Phase 5 testing. Mitigation if latency is unacceptable: truncate corpus to top-3 most relevant ContentDB keys based on current question topic rather than injecting the full corpus every call.

### 10.3 System Prompt Construction

`buildSystemPrompt()` is rewritten to inject the full corpus. It is called once per conversation start (panel open), not per message.

```javascript
function buildSystemPrompt(corpus, currentQuestion, currentTopic, stats) {
  // ── IDENTITY & SCOPE ─────────────────────────────────────────────────────
  let prompt = `You are a specialized NCLEX-RN study assistant. Your ONLY purpose is to help nursing students prepare for the NCLEX-RN exam.

STRICT SCOPE RULES:
- You answer ONLY questions about NCLEX-RN exam content, preparation strategies, and clinical concepts tested on the NCLEX-RN.
- You draw answers EXCLUSIVELY from the indexed sources provided below. Do not use your general training knowledge.
- Every response MUST end with a source citation in this format: "— Source: [source name]"
- If a question cannot be answered from the indexed sources, say: "That topic isn't in my indexed sources. For this, I'd recommend checking [DailyMed / OpenRN / your nursing textbook] directly."
- You do NOT provide general medical advice, treatment recommendations, or clinical guidance beyond what NCLEX tests.
- You do NOT discuss NCLEX-PN, HESI, ATI, or other exams.
- You do NOT discuss topics unrelated to nursing licensure preparation.

NCLEX-RN FRAMEWORK:
- All responses relate to one of the 8 NCSBN Client Needs categories: Management of Care, Safety & Infection Control, Health Promotion & Maintenance, Psychosocial Integrity, Basic Care & Comfort, Pharmacology, Reduction of Risk Potential, Physiological Adaptation.
- For NGN questions, reference the 6 NCJMM steps: Recognize Cues, Analyze Cues, Prioritize Hypotheses, Generate Solutions, Take Action, Evaluate Outcomes.
- Always frame clinical concepts in terms of what a nurse would assess, prioritize, or do — not what a physician would order.

RESPONSE LENGTH:
${briefMode ? "Default to 2-3 sentences. Be direct. Only expand if explicitly asked." : "Give thorough explanations of 5-8 sentences with full rationale."}

`;

  // ── FDA DRUG CORPUS ───────────────────────────────────────────────────────
  const fdaEntries = Object.entries(corpus)
    .filter(([k]) => k.startsWith('content:fda:'))
    .map(([, v]) => v);

  if (fdaEntries.length > 0) {
    prompt += `\n## INDEXED FDA DRUG LABELS (${fdaEntries.length} drugs)\n`;
    prompt += `Use these for ALL pharmacology questions. Do not use general knowledge.\n\n`;
    for (const drug of fdaEntries) {
      prompt += `### ${drug.name.toUpperCase()}\n`;
      if (drug.indications) prompt += `Indications: ${drug.indications.substring(0, 200)}\n`;
      if (drug.warnings) prompt += `Warnings/Black Box: ${drug.warnings.substring(0, 300)}\n`;
      if (drug.adverseReactions) prompt += `Adverse Reactions: ${drug.adverseReactions.substring(0, 200)}\n`;
      if (drug.contraindications) prompt += `Contraindications: ${drug.contraindications.substring(0, 200)}\n`;
      prompt += "\n";
    }
  }

  // ── RXNORM DRUG CLASS CORPUS ─────────────────────────────────────────────
  const rxEntries = Object.entries(corpus)
    .filter(([k]) => k.startsWith('content:rxnorm:'))
    .map(([, v]) => v);

  if (rxEntries.length > 0) {
    prompt += `\n## DRUG CLASSES (RxNorm)\n`;
    for (const drug of rxEntries) {
      if (drug.drugClass) prompt += `${drug.name}: ${drug.drugClass}\n`;
    }
    prompt += "\n";
  }

  // ── MEDLINEPLUS HEALTH TOPICS ─────────────────────────────────────────────
  const mlEntries = Object.entries(corpus)
    .filter(([k]) => k.startsWith('content:medline:'))
    .map(([, v]) => v);

  if (mlEntries.length > 0) {
    prompt += `\n## MEDLINEPLUS HEALTH TOPICS (NLM — ${mlEntries.length} topics)\n`;
    prompt += `Use these summaries for disease/condition questions.\n\n`;
    for (const topic of mlEntries) {
      prompt += `### ${topic.title}\n${topic.summary?.substring(0, 400)}\n\n`;
    }
  }

  // ── OPENRN NURSING CONTENT ────────────────────────────────────────────────
  const openrnEntries = Object.entries(corpus)
    .filter(([k]) => k.startsWith('content:openrn:'))
    .map(([, v]) => v);

  if (openrnEntries.length > 0) {
    prompt += `\n## OPENRN NURSING TEXTBOOK CONTENT (CC-BY 4.0)\n`;
    prompt += `Faculty-authored, peer-reviewed, aligned with 2023 NCLEX-RN Test Plan.\n\n`;
    for (const chapter of openrnEntries) {
      prompt += `### OpenRN: ${chapter.topic}\n${chapter.excerpt?.substring(0, 600)}\n\n`;
    }
  }

  // ── CURRENT QUESTION CONTEXT ──────────────────────────────────────────────
  if (currentQuestion) {
    prompt += `\n## CURRENT QUESTION THE STUDENT IS ON\n`;
    prompt += `Topic: ${currentQuestion.topic}\n`;
    prompt += `Type: ${currentQuestion.type}\n`;
    prompt += `Question: ${currentQuestion.question}\n`;
    if (currentQuestion.options) {
      const opts = Object.entries(currentQuestion.options).map(([k, v]) => `${k}) ${v}`).join(" | ");
      prompt += `Options: ${opts}\n`;
    }
    prompt += `\nIf asked to explain this question, guide clinical reasoning WITHOUT revealing the answer. Use the Socratic method. Ask questions that lead the student to think through the NCJMM steps.\n`;
  }

  // ── STUDENT PERFORMANCE CONTEXT ───────────────────────────────────────────
  // NOTE: This is where topic accuracy, NCJMM step scores, readiness score,
  // recent wrong answers, and flagged questions are injected into the system prompt.
  // The 'stats' parameter comes from UserDB.getStats() loaded at session start.
  // This is what enables proactive coaching ("your Physio Adaptation is 48%...").
  if (stats) {
    prompt += `\n## STUDENT PERFORMANCE DATA\n`;
    prompt += `Total answered: ${stats.totalAnswered} | Overall accuracy: ${stats.totalAnswered > 0 ? Math.round(stats.totalCorrect / stats.totalAnswered * 100) : 0}%\n`;
    prompt += `Current streak: ${stats.streak} | Best streak: ${stats.bestStreak}\n`;
    prompt += `SATA practiced: ${stats.sataPracticed} | Dosage practiced: ${stats.dosagePracticed}\n`;
    if (stats.lastStudied) prompt += `Last studied: ${stats.lastStudied}\n`;

    if (stats.topicScores) {
      // Build ranked topic performance
      const scored = Object.entries(stats.topicScores)
        .filter(([, s]) => s.answered >= 2)
        .map(([topic, s]) => ({ topic, pct: Math.round(s.correct / s.answered * 100), answered: s.answered }))
        .sort((a, b) => a.pct - b.pct);

      if (scored.length > 0) {
        const weak = scored.filter(t => t.pct < 60);
        const strong = scored.filter(t => t.pct >= 80);

        prompt += `\nTOPIC ACCURACY (sorted worst to best):\n`;
        scored.forEach(t => {
          const label = t.pct < 60 ? " ⚠️ WEAK" : t.pct >= 80 ? " ✅ STRONG" : "";
          prompt += `  ${t.topic}: ${t.pct}% (${t.answered} questions)${label}\n`;
        });

        if (weak.length > 0) {
          prompt += `\nWEAK AREAS (< 60%): ${weak.map(t => t.topic).join(", ")}\n`;
          prompt += `PRIORITY: When student asks about these topics, proactively note their low score and recommend drilling.\n`;
        }
        if (strong.length > 0) {
          prompt += `STRONG AREAS (≥ 80%): ${strong.map(t => t.topic).join(", ")}\n`;
          prompt += `You can briefly acknowledge these strengths when relevant to build confidence.\n`;
        }
      }
    }

    // Recent wrong answers from session history
    if (stats.sessionHistory?.length > 0) {
      const recentWrong = stats.sessionHistory
        .filter(h => !h.correct)
        .slice(-10)
        .map(h => h.topic);
      const wrongCounts = recentWrong.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
      const repeatedWrong = Object.entries(wrongCounts).filter(([, c]) => c >= 2);
      if (repeatedWrong.length > 0) {
        prompt += `\nREPEATED MISTAKES THIS SESSION: ${repeatedWrong.map(([t, c]) => t + " (" + c + "x)").join(", ")}\n`;
        prompt += `These are active struggle areas — use more scaffolding, offer study resources.\n`;
      }
    }

    // Flagged questions
    if (stats.flaggedQuestions?.length > 0) {
      const flagTopics = [...new Set(stats.flaggedQuestions.map(f => f.topic))];
      prompt += `\nFLAGGED FOR REVIEW: ${flagTopics.join(", ")} (student marked these as unsure)\n`;
    }
  }

  // ── ANSWER WITHHOLDING RULES ───────────────────────────────────────────────
  prompt += `\n## TEACHING APPROACH — ANSWER WITHHOLDING\n`;
  prompt += `You are a Socratic tutor, not an answer key. Follow this progression strictly:\n`;
  prompt += `1. FIRST ASK: Respond with a guiding question that activates clinical reasoning. Never give the answer.\n`;
  prompt += `2. SECOND ASK (same topic): Narrow the hint. Point to the relevant framework (ABC, NCJMM step, drug class).\n`;
  prompt += `3. THIRD ASK (same topic): Provide the reasoning path but not the final answer.\n`;
  prompt += `4. STRUGGLING THRESHOLD — give full explanation with rationale when:\n`;
  prompt += `   - Student says: "I give up", "just tell me", "I don't know", "I don't understand"\n`;
  prompt += `   - Student has 3+ wrong answers on this topic this session\n`;
  prompt += `   - Student has flagged 2+ questions on this topic as Confused\n`;
  prompt += `   - Student has < 50% accuracy on this topic across all sessions\n`;
  prompt += `If a struggling threshold is met, acknowledge it: "You've missed a few on this topic — let me walk you through it fully."\n`;

  // ── RESOURCE SURFACING RULES ──────────────────────────────────────────────
  prompt += `\n## RESOURCE RECOMMENDATIONS\n`;
  prompt += `When detecting confusion or weakness, recommend resources in this priority order:\n`;
  prompt += `1. ContentDB first: "This is covered in your Study library under [topic] — the OpenRN chapter on [chapter]."\n`;
  prompt += `2. Free online NCLEX-focused: RegisteredNurseRN (YouTube), SimpleNursing (YouTube), Level Up RN (YouTube)\n`;
  prompt += `3. Official free sources: NurseAchieve NCSBN sample pack (nurseachieve.com — free, real NCLEX questions), DailyMed (dailymed.nlm.nih.gov)\n`;
  prompt += `4. For NGN format specifically: nclex.com exam preview, Maryland MNWC test bank (nursing.umaryland.edu/mnwc)\n`;
  prompt += `Never recommend paid tools (UWorld, Kaplan, ATI, Saunders) unless student explicitly asks.\n`;
  prompt += `When recommending YouTube, specify the channel and what to search: "Search 'RegisteredNurseRN heart failure NCLEX' for a video on this exact topic."\n`;

  return prompt;
}
```

**Token budget:** With ~300 drugs × ~300 chars + 30 MedlinePlus topics × ~400 chars + 8 OpenRN excerpts × ~600 chars, the corpus in the prompt is approximately 25,000–35,000 characters (~8,000–10,000 tokens). Within Claude Sonnet's context window with room for conversation history.

**If corpus exceeds token budget:** Trim in this priority order:
1. Reduce OpenRN excerpts to 300 chars each
2. Reduce MedlinePlus summaries to 200 chars each
3. Reduce FDA adverse reactions section
4. Keep FDA warnings/black box at full length — these are safety-critical

### 10.4 Topic Relevance Retrieval

When a student asks about a specific drug or topic, the assistant searches the corpus for the most relevant entry before responding. This is a simple string match — no embeddings needed at this scale.

```javascript
function findRelevantCorpusEntries(query, corpus) {
  const q = query.toLowerCase();
  const matches = [];

  for (const [key, value] of Object.entries(corpus)) {
    const name = (value.name || value.topic || value.title || "").toLowerCase();
    if (q.includes(name) || name.includes(q.split(" ")[0])) {
      matches.push({ key, value, relevance: "high" });
    }
  }

  return matches.slice(0, 5); // Top 5 matches
}
```

The `sendMessage` function calls `findRelevantCorpusEntries` before building the API request and includes the top matches in the message context as priority content.

### 10.5 Off-Topic Rejection

The system prompt enforces NCLEX focus. Additionally, a lightweight pre-filter checks the user's message before sending to Claude:

```javascript
const OFF_TOPIC_PATTERNS = [
  /treat(ment)?\s+(for|of)/i,      // "treatment for hypertension"
  /should\s+i\s+(take|eat|drink)/i, // "should I take ibuprofen"
  /my\s+(patient|doctor|nurse)/i,   // personal medical questions
  /(?:hesi|ati|nclex-pn|teas)\b/i, // other exams
  /recipe|workout|travel|relationship/i // clearly off-topic
];

function isOffTopic(message) {
  return OFF_TOPIC_PATTERNS.some(p => p.test(message));
}

// In sendMessage():
if (isOffTopic(msg)) {
  const redirect = "That's outside my scope — I'm focused exclusively on NCLEX-RN prep. " +
    "Ask me about a clinical concept, drug mechanism, NCJMM step, or say 'explain this question' to get help with what you're working on.";
  setMessages(prev => [...prev, { role: "assistant", text: redirect, ts: new Date().toLocaleTimeString() }]);
  return; // don't call Claude API
}
```

### 10.6 Struggle Detection

Before sending each message to Claude, evaluate whether the student has hit a struggling threshold. If yes, the message context includes a flag that instructs Claude to give the full answer rather than withhold it.

```javascript
function detectStruggle(msg, stats, currentTopic, conversationHistory) {
  // Explicit surrender phrases
  const surrenderPhrases = [
    /i give up/i, /just tell me/i, /i don't (know|understand)/i,
    /what('s| is) the answer/i, /can you just explain/i, /i'm lost/i,
    /i have no idea/i, /please just/i
  ];
  if (surrenderPhrases.some(p => p.test(msg))) return { struggling: true, reason: "explicit" };

  // 3+ wrong answers on this topic this session
  if (currentTopic && stats?.sessionHistory) {
    const topicWrong = stats.sessionHistory
      .filter(h => h.topic === currentTopic && !h.correct)
      .length;
    if (topicWrong >= 3) return { struggling: true, reason: "repeated_wrong", count: topicWrong };
  }

  // 2+ flagged as "Confused" on this topic
  if (currentTopic && stats?.flaggedQuestions) {
    const topicFlagged = stats.flaggedQuestions
      .filter(f => f.topic === currentTopic && f.category === "Confused")
      .length;
    if (topicFlagged >= 2) return { struggling: true, reason: "flagged_confused" };
  }

  // < 50% accuracy on this topic all-time
  if (currentTopic && stats?.topicScores?.[currentTopic]) {
    const s = stats.topicScores[currentTopic];
    if (s.answered >= 4 && s.correct / s.answered < 0.5) {
      return { struggling: true, reason: "low_accuracy", pct: Math.round(s.correct / s.answered * 100) };
    }
  }

  // Same question asked 3+ times in this conversation
  const repeatCount = conversationHistory
    .filter(m => m.role === "user")
    .filter(m => m.text.toLowerCase().includes(msg.toLowerCase().substring(0, 20)))
    .length;
  if (repeatCount >= 2) return { struggling: true, reason: "repeated_ask" };

  return { struggling: false };
}

// In sendMessage(), after off-topic check:
const struggleResult = detectStruggle(msg, stats, currentTopic, messages);
// Pass to buildSystemPrompt as a parameter — it adjusts instructions accordingly
```

When `struggling: true`, `buildSystemPrompt` appends:
```
OVERRIDE: Student is struggling (reason: ${struggleResult.reason}). 
Give the full explanation with complete rationale. 
Acknowledge their struggle: "You've been working on this — let me walk you through it fully."
Then provide the answer, explain why each option is right or wrong, and suggest a specific resource.
```

### 10.7 Resource Surfacing Logic

When the assistant recommends resources, it searches ContentDB first, then falls back to curated external resources. This logic runs in the system prompt (the LLM decides when to surface resources) but the curated list is injected as structured data.

```javascript
const CURATED_RESOURCES = {
  // READABLE — open in native reader (fetch + render)
  readable: [
    { name: "DailyMed", urlTemplate: "https://dailymed.nlm.nih.gov/dailymed/search.cfm?query={drug}",
      topics: ["pharmacology"],
      note: "Official FDA drug label database — for drugs not in the indexed set",
      readerType: "external-url" },
    { name: "OpenRN Textbooks", urlTemplate: null,
      topics: ["all"],
      note: "7 peer-reviewed nursing textbooks — pre-extracted and indexed in your library",
      readerType: "contentdb", contentKeyPrefix: "content:openrn:" },
    { name: "MedlinePlus", urlTemplate: "https://medlineplus.gov/ency/article/{topic}.htm",
      topics: ["all"],
      note: "NLM health topic summaries — already in your library",
      readerType: "contentdb", contentKeyPrefix: "content:medline:" },
    { name: "Maryland MNWC Test Bank", url: "https://nursing.umaryland.edu/mnwc/mnwc-initiatives/nextgen-nclex/nextgen-nclex-test-bank/",
      topics: ["ngn","clinical-judgment"],
      note: "54 free NGN case studies, 33 bow-tie items — faculty-reviewed",
      readerType: "external-url" },
    { name: "NCLEX.com NGN Overview", url: "https://www.nclex.com/next-generation-nclex.page",
      topics: ["ngn","ncjmm"],
      note: "Official NCSBN NGN overview with NCJMM model explanation",
      readerType: "external-url" },
  ],

  // VIDEO — link-out only, cannot be read
  video: [
    { channel: "RegisteredNurseRN", searchUrl: "https://www.youtube.com/results?search_query=RegisteredNurseRN+{topic}+NCLEX",
      topics: ["pharmacology","cardiac","respiratory","ncjmm","ngn","prioritization"],
      note: "Step-by-step NCLEX question walkthroughs and condition reviews",
      readerType: "link-out" },
    { channel: "SimpleNursing", searchUrl: "https://www.youtube.com/results?search_query=SimpleNursing+{topic}",
      topics: ["pharmacology","pathophysiology","fluids","electrolytes"],
      note: "Visual pharmacology and pathophysiology mnemonics",
      readerType: "link-out" },
    { channel: "Level Up RN", searchUrl: "https://www.youtube.com/results?search_query=LevelUpRN+{topic}+NCLEX",
      topics: ["pharmacology","labs","assessment","management","sata"],
      note: "Cathy Parkes — comprehensive NCLEX-RN review cards and videos",
      readerType: "link-out" },
    { channel: "Ninja Nerd Nursing", searchUrl: "https://www.youtube.com/results?search_query=NinjaNerdNursing+{topic}",
      topics: ["pathophysiology","cardiac","respiratory","neuro","renal"],
      note: "Deep pathophysiology dives with whiteboard visuals",
      readerType: "link-out" },
  ],

  // INTERACTIVE / AUTH-REQUIRED — link-out only
  interactive: [
    { name: "NurseAchieve NCSBN Sample Pack", url: "https://nurseachieve.com/en-int/products/ncsbn-ngn-rn-sample-pack-no-charge",
      note: "Real NCLEX questions from the exam maker — free, requires account",
      readerType: "link-out" },
  ]
};
```

**Resource rendering rules:**
- `readerType: "contentdb"` → tappable card opens native reader to ContentDB content
- `readerType: "external-url"` → tappable card opens native reader, fetches URL
- `readerType: "link-out"` → tappable card opens in new browser tab, never in reader
- YouTube URLs are always `link-out` regardless of how they appear in assistant responses

The assistant system prompt receives a condensed version of this list. When recommending a resource, it includes the `readerType` in its structured response so the UI can render the correct card type. For video resources it always provides a specific search query: `"Search 'RegisteredNurseRN [topic] NCLEX' on YouTube"`.

### 10.8 Progress-Aware Proactive Coaching

The assistant proactively mentions performance data when it detects teachable moments — not just when asked. Triggers:

```javascript
// In sendMessage() — before calling Claude, check for proactive coaching triggers
function getProactiveCoachingNote(msg, stats, currentTopic) {
  const notes = [];

  // Topic being asked about has low accuracy
  if (currentTopic && stats?.topicScores?.[currentTopic]) {
    const s = stats.topicScores[currentTopic];
    if (s.answered >= 3) {
      const pct = Math.round(s.correct / s.answered * 100);
      if (pct < 60) notes.push(`FYI: Student is at ${pct}% on ${currentTopic} (${s.answered} questions). Mention this and suggest focused drilling.`);
      else if (pct >= 80) notes.push(`Student is strong on ${currentTopic} (${pct}%). Brief positive reinforcement is appropriate.`);
    }
  }

  // Hasn't studied a topic mentioned in the message in a while
  if (stats?.lastStudiedByTopic && currentTopic) {
    const lastDate = stats.lastStudiedByTopic[currentTopic];
    if (lastDate) {
      const daysSince = Math.floor((Date.now() - new Date(lastDate)) / 86400000);
      if (daysSince >= 5) notes.push(`Student hasn't practiced ${currentTopic} in ${daysSince} days. Gently note this.`);
    }
  }

  return notes.join(" ");
}
```

This note is appended to the user message context (not the system prompt) so it varies per turn without inflating the system prompt.

### 10.6 Hands-Free Mode

New toggle in the voice assistant header. When enabled:

1. When a new question loads → `speak(question.question)` automatically fires
2. After the question is read → `startListening()` activates for 5 seconds
3. If voice input is detected → submit as assistant message
4. After an answer is submitted and rationale is shown → `speak(question.rationale)` fires
5. After rationale is read → return to idle

```javascript
useEffect(() => {
  if (!handsFreeMode || !question || revealed) return;
  // Auto-read new question
  const timer = setTimeout(() => {
    speak(question.question);
    // After speaking, activate listening
    const listenTimer = setTimeout(() => {
      if (!revealed) startListening();
    }, question.question.length * 60); // rough estimate of speak time
    return () => clearTimeout(listenTimer);
  }, 500);
  return () => clearTimeout(timer);
}, [question, handsFreeMode]);
```

### 10.7 Corpus Refresh on Panel Reopen

The corpus is loaded once when the panel opens. If the student closes and reopens the panel after a ContentDB re-index, the corpus is stale. A version check handles this:

```javascript
// On panel open
const meta = await ContentDB.get('db:meta');
if (meta?.indexedAt !== corpusLoadedAt.current) {
  // ContentDB was updated since last load — reload corpus
  const newCorpus = await loadAssistantCorpus();
  corpusRef.current = newCorpus;
  corpusLoadedAt.current = meta?.indexedAt;
}
```

---

Every layer has a defined fallback:

| Layer | Primary | Fallback |
|---|---|---|
| OpenRN context | ContentDB lookup | MedlinePlus summary from DB |
| MedlinePlus | ContentDB lookup | Claude training knowledge only |
| FDA label | ContentDB lookup | Generic pharmacology prompt |
| OpenStax NGN | ContentDB lookup | AI-generated case (v4 behavior) |
| localStorage write | Normal write | Log error, continue without caching |
| localStorage read | Normal read | Return null, regenerate from bundled content |
| PostgreSQL write | Normal PUT to /api | Log error, queue retry on next interaction |
| PostgreSQL read | Normal GET from /api | Fall back to last known localStorage snapshot |
| Live fetch (re-index) | Fetch + parse | Mark source failed, continue |

The app must never fail to load or generate a question due to a ContentDB miss. Every miss falls through to the existing v4 behavior.

---

## 11. Native Content Reader

### 11.1 Overview

The reader is a React component `<ContentReader />` that renders any readable content — ContentDB text or a fetched external URL — in a paginated, themed interface. It is context-sensitive: drawer mode during drilling, full-screen during Study Topic mode.

### 11.2 Component Interface

```javascript
<ContentReader
  mode="drawer" | "fullscreen"          // placement context
  contentKey="content:openrn:pharmacology" // ContentDB key, OR
  externalUrl="https://dailymed.nlm.nih.gov/..." // external URL to fetch
  initialPage={0}                        // resume from saved position
  onClose={() => {}}                     // dismiss callback
  onAskAssistant={(context) => {}}       // opens voice assistant with context
/>
```

### 11.3 Content Resolution

```javascript
async function resolveReaderContent(contentKey, externalUrl) {
  // 1. ContentDB content (already indexed — instant)
  if (contentKey) {
    const data = await ContentDB.get(contentKey);
    if (data) return formatForReader(data, contentKey);
  }

  // 2. External URL — allowlist check, then fetch, parse, clean
  if (externalUrl) {
    if (!isSafeReaderUrl(externalUrl)) {
      return { error: `Domain not in approved list: ${new URL(externalUrl).hostname}` };
    }
    try {
      const res = await fetch(externalUrl, { signal: AbortSignal.timeout(12000) });
      const html = await res.text();
      const text = extractTextFromHTML(html); // DOMParser — strips nav/ads, returns main content
      return {
        title: extractTitle(html),
        pages: paginate(text, 400),
        source: new URL(externalUrl).hostname,
        url: externalUrl,
      };
    } catch (e) {
      return { error: `Could not load content: ${e.message}` };
    }
  }

  return { error: "No content source provided" };
}

function formatForReader(dbData, contentKey) {
  // OpenRN chapter
  if (contentKey.startsWith('content:openrn:')) {
    const fullText = dbData.chapters?.map(c => c.text).join('

---

') || '';
    return {
      title: `OpenRN — ${dbData.topic}`,
      pages: paginate(fullText, 400),
      source: 'OpenRN (CC-BY 4.0)',
      chapters: dbData.chapters?.map(c => ({ label: c.url?.split('/').slice(-2, -1)[0], url: c.url })),
    };
  }
  // FDA drug label — structured card, not paginated prose
  if (contentKey.startsWith('content:fda:')) {
    return {
      title: `FDA Label — ${dbData.name}`,
      type: 'structured-card',
      sections: [
        { heading: 'Indications', text: dbData.indications },
        { heading: 'Warnings / Black Box', text: dbData.warnings },
        { heading: 'Adverse Reactions', text: dbData.adverseReactions },
        { heading: 'Contraindications', text: dbData.contraindications },
        { heading: 'Dosage & Administration', text: dbData.dosage },
      ].filter(s => s.text),
      source: 'openFDA',
    };
  }
  // MedlinePlus summary — structured card
  if (contentKey.startsWith('content:medline:')) {
    return {
      title: dbData.title,
      type: 'structured-card',
      sections: [{ heading: 'Summary', text: dbData.summary }],
      source: 'MedlinePlus (NLM)',
    };
  }
  // OpenStax NGN
  if (contentKey.startsWith('content:openstax:')) {
    const fullText = dbData.cases?.map(c =>
      `## ${c.topic || 'Case Study'}

${c.content || ''}`
    ).join('

---

') || '';
    return {
      title: `OpenStax NGN — ${dbData.book || 'Nursing'}`,
      pages: paginate(fullText, 400),
      source: 'OpenStax (CC-BY 4.0)',
    };
  }
  return { error: 'Unknown content type' };
}

function paginate(text, wordsPerPage) {
  const words = text.split(/\s+/);
  const pages = [];
  for (let i = 0; i < words.length; i += wordsPerPage) {
    pages.push(words.slice(i, i + wordsPerPage).join(' '));
  }
  return pages.length > 0 ? pages : [''];
}

// URL allowlist for external reader fetches — prevents SSRF and open redirect abuse.
// Only domains on this list can be fetched and rendered in the native reader.
const ALLOWED_READER_DOMAINS = [
  'dailymed.nlm.nih.gov',
  'medlineplus.gov',
  'nursing.umaryland.edu',
  'nclex.com',
  'ncsbn.org',
  'wtcs.pressbooks.pub',          // OpenRN Pressbooks (confirmed accessible)
];

function isSafeReaderUrl(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false; // HTTPS only
    return ALLOWED_READER_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}
```

### 11.4 Reading Position Persistence

Reading position is saved to `db:stats` keyed by content source:

```javascript
// Save position
async function saveReadingPosition(contentKey, page) {
  const stats = await ContentDB.get('db:stats') || {};
  stats.readingPositions = stats.readingPositions || {};
  stats.readingPositions[contentKey] = { page, savedAt: new Date().toISOString() };
  await ContentDB.set('db:stats', stats);
}

// Restore position
async function getReadingPosition(contentKey) {
  const stats = await ContentDB.get('db:stats');
  return stats?.readingPositions?.[contentKey]?.page || 0;
}
```

### 11.5 Themes and Font Control

```javascript
const READER_THEMES = {
  light:  { bg: '#ffffff', text: '#1a1a1a', border: '#e5e7eb', surface: '#f9fafb' },
  sepia:  { bg: '#f8f1e4', text: '#2c1e0f', border: '#d4b896', surface: '#f0e6d3' },
  dark:   { bg: '#1a1a2e', text: '#e2e8f0', border: '#2d3748', surface: '#16213e' },
};

const FONT_SIZES = { small: '14px', medium: '16px', large: '19px' };
```

Theme preference and font size saved to `db:stats.readerPrefs`.

### 11.6 Auto-Matching to Current Question

When the reader is opened from a question card's "📖 Read" button, the topic-to-ContentDB key mapping resolves automatically:

```javascript
const TOPIC_TO_CONTENT_KEYS = {
  "Pharmacology":              ["content:openrn:pharmacology"],
  "Management of Care":        ["content:openrn:management"],
  "Safety & Infection Control":["content:openrn:fundamentals"],
  "Psychosocial Integrity":    ["content:openrn:mentalhealth"],
  "Basic Care & Comfort":      ["content:openrn:fundamentals"],
  "Health Promotion":          ["content:openrn:fundamentals"],
  "Reduction of Risk Potential":["content:openrn:skills"],
  "Physiological Adaptation":  ["content:openrn:fundamentals"],
};

// For pharmacology questions, also show the drug-specific FDA card
function getContentKeysForQuestion(question) {
  const keys = TOPIC_TO_CONTENT_KEYS[question.topic] || [];
  if (question.topic === "Pharmacology" && question.drugName) {
    keys.push(`content:fda:${question.drugName}`);
  }
  return keys;
}
```

### 11.7 Voice Assistant → Reader Integration

When the voice assistant recommends a readable resource, it returns structured metadata alongside the text response:

```javascript
// Assistant response shape when recommending a readable resource
{
  text: "The OpenRN cardiovascular drugs chapter covers beta-blocker mechanisms in detail.",
  readableResource: {
    label: "OpenRN — Cardiovascular Drugs",
    contentKey: "content:openrn:pharmacology",   // for ContentDB content
    externalUrl: null,                            // for external URLs
  }
}
```

The message bubble renders a tappable "📖 Open in Reader →" card below the text. Tapping fires `openReader(resource)`. YouTube recommendations render a "▶ Watch on YouTube →" link-out card instead.

### 11.8 YouTube — Link-Out Only

YouTube is explicitly excluded from the reader. No fetch, no embed, no proxy.

```javascript
function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/i.test(url);
}

function handleResourceTap(resource) {
  if (resource.externalUrl && isYouTubeUrl(resource.externalUrl)) {
    window.open(resource.externalUrl, '_blank'); // link-out
    return;
  }
  if (resource.contentKey || resource.externalUrl) {
    openReader(resource); // native reader
  }
}
```

The assistant system prompt explicitly categorizes YouTube as video-only: "YouTube recommendations must include a search query and open in a new browser tab. Never include a YouTube URL as a reader resource."

### 11.9 Drawer vs Full-Screen Mode

```javascript
// Drawer (during drilling modes)
const drawerStyle = {
  position: 'fixed', top: 0, right: 0,
  width: isMobile ? '100%' : '65%',
  height: isMobile ? '62vh' : '100vh',
  bottom: isMobile ? 0 : 'auto',
  top: isMobile ? 'auto' : 0,
  zIndex: 998, // below voice assistant FAB (1000)
  boxShadow: '-4px 0 30px rgba(0,0,0,0.2)',
  transition: 'transform 0.25s ease',
  transform: open ? 'translateX(0)' : 'translateX(100%)',
};

// Full-screen (Study Topic mode)
const fullscreenStyle = {
  position: 'fixed', inset: 0,
  zIndex: 997,
};
```

### 11.10 Library Tab

A top-level navigation tab showing all 6 OpenRN textbooks. Entry point for reading
independent of any active question or voice assistant session.

```javascript
// src/library/LibraryTab.tsx

const OPENRN_BOOKS = [
  {
    key: 'pharmacology',
    title: 'Nursing Pharmacology 2e',
    description: 'Drug classes, mechanisms, nursing considerations, NCLEX pharmacology prep',
    pressbooks: 'https://wtcs.pressbooks.pub/pharmacology/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/NBK595000/',
    epubUrl: 'https://wtcs.pressbooks.pub/pharmacology/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/pharmacology/?download=pdf',
  },
  {
    key: 'fundamentals',
    title: 'Nursing Fundamentals 2e',
    description: 'Core nursing concepts, patient care, clinical judgment foundation',
    pressbooks: 'https://wtcs.pressbooks.pub/nursingfundamentals/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/NBK610836/',
    epubUrl: 'https://wtcs.pressbooks.pub/nursingfundamentals/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/nursingfundamentals/?download=pdf',
  },
  {
    key: 'skills',
    title: 'Nursing Skills 2e',
    description: 'Clinical skills, procedures, patient safety, infection control',
    pressbooks: 'https://wtcs.pressbooks.pub/nursingskills/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/NBK596735/',
    epubUrl: 'https://wtcs.pressbooks.pub/nursingskills/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/nursingskills/?download=pdf',
  },
  {
    key: 'mentalhealth',
    title: 'Nursing: Mental Health & Community Concepts 2e',
    description: 'Mental health disorders, therapeutic communication, community nursing',
    pressbooks: 'https://wtcs.pressbooks.pub/nursingmhcc/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/NBK617002/',
    epubUrl: 'https://wtcs.pressbooks.pub/nursingmhcc/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/nursingmhcc/?download=pdf',
  },
  {
    key: 'management',
    title: 'Nursing Management & Professional Concepts 2e',
    description: 'Leadership, delegation, prioritization, legal/ethical nursing practice',
    pressbooks: 'https://wtcs.pressbooks.pub/nursingmpc/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/NBK598384/',
    epubUrl: 'https://wtcs.pressbooks.pub/nursingmpc/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/nursingmpc/?download=pdf',
  },
  {
    key: 'advancedskills',
    title: 'Nursing Advanced Skills',
    description: 'Advanced procedures, specialized care, complex patient management',
    pressbooks: 'https://wtcs.pressbooks.pub/nursingadvancedskills/',
    ncbi: 'https://www.ncbi.nlm.nih.gov/books/n/openrnas/',
    epubUrl: 'https://wtcs.pressbooks.pub/nursingadvancedskills/?download=epub',
    pdfUrl: 'https://wtcs.pressbooks.pub/nursingadvancedskills/?download=pdf',
  },
];

export function LibraryTab() {
  return (
    <div className="library-tab">
      <h2>OpenRN Textbook Library</h2>
      <p className="library-subtitle">
        Free CC-BY 4.0 nursing textbooks. Read online or download for offline use.
      </p>
      <div className="book-list">
        {OPENRN_BOOKS.map(book => (
          <BookCard key={book.key} book={book} />
        ))}
      </div>
    </div>
  );
}

function BookCard({ book }: { book: typeof OPENRN_BOOKS[0] }) {
  return (
    <div className="book-card">
      <div className="book-info">
        <h3>{book.title}</h3>
        <p>{book.description}</p>
        <span className="license-badge">CC-BY 4.0 · OpenRN</span>
      </div>
      <div className="book-actions">
        {/* Read online — ContentReader fetches from Pressbooks */}
        <ReadOnlineButton book={book} />

        {/* Download to device Downloads folder */}
        <DownloadButton
          label="Download EPUB"
          url={book.epubUrl}
          filename={`OpenRN-${book.key}.epub`}
        />
        <DownloadButton
          label="Download PDF"
          url={book.pdfUrl}
          filename={`OpenRN-${book.key}.pdf`}
        />
      </div>
    </div>
  );
}
```

### 11.11 EPUB and PDF Download

Downloads use a standard browser `<a download>` — no IndexedDB, no internal storage,
no file management. The file lands in the student's Downloads folder exactly like any
other browser download. The student opens it in their own PDF/EPUB viewer.

```javascript
// src/library/DownloadButton.tsx

interface DownloadButtonProps {
  label: string;
  url: string;       // Pressbooks download URL
  filename: string;  // suggested filename for the Downloads folder
}

export function DownloadButton({ label, url, filename }: DownloadButtonProps) {
  const [state, setState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');

  async function handleDownload() {
    setState('downloading');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      // Trigger browser download to Downloads folder
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;  // suggested filename — browser uses this
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up object URL after short delay
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      setState('done');
      setTimeout(() => setState('idle'), 3000);
    } catch (e) {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  const labels = {
    idle: label,
    downloading: 'Downloading...',
    done: '✓ Saved to Downloads',
    error: 'Download failed — try again',
  };

  return (
    <button
      className={`download-btn download-btn--${state}`}
      onClick={handleDownload}
      disabled={state === 'downloading'}
    >
      {labels[state]}
    </button>
  );
}
```

**Behaviour notes:**
- No file stored in app — downloaded file lives entirely in the student's Downloads folder
- No download manager, no progress tracking beyond the button state — the browser handles it
- If Pressbooks is unavailable, show error and suggest the NCBI URL as an alternative
  (`ncbi.nlm.nih.gov/books/{NBK}` — student can download manually from there)
- Download URLs are the standard Pressbooks `?download=epub` and `?download=pdf` query params
- Filename suggestion follows `OpenRN-{key}.epub` / `OpenRN-{key}.pdf` pattern

**ReadOnlineButton** opens `<ContentReader mode="fullscreen" externalUrl={book.pressbooks} />`
as specified in §11.3 — fetches and renders the live Pressbooks page in the native reader.

---

## 12. Backend — Kotlin + Spring Boot

### 12.1 Project Structure

```
nclex-backend/
├── src/main/kotlin/com/nclex/
│   ├── NclexApplication.kt
│   ├── config/
│   │   ├── SecurityConfig.kt        # JWT cookie filter, CORS, security headers, route protection
│   │   ├── RateLimitConfig.kt       # Bucket4j rate limiter beans
│   │   └── DatabaseConfig.kt
│   │   └── CacheConfig.kt           # Caffeine in-process cache for content_cache endpoint
│   ├── auth/
│   │   ├── AuthController.kt        # /api/auth/register, /api/auth/login, /api/auth/logout
│   │   ├── AuthService.kt           # bcrypt, JWT generation, password validation
│   │   └── UserRepository.kt
│   ├── claude/
│   │   └── LlmController.kt         # /api/claude — provider-agnostic, auth required, rate limited
│   │   └── LlmService.kt             # Spring AI ChatModel invocation, audit logging
│   │   └── LlmProviderConfig.kt      # activeChatModel bean — wires correct provider from LLM_PROVIDER env
│   │   └── PromptRegistry.kt          # per-provider prompt variants (claude/openai/generic)
│   ├── stats/
│   │   ├── StatsController.kt       # GET/PUT /api/stats — server trims history to 200
│   │   └── StatsRepository.kt
│   ├── flags/
│   │   ├── FlagsController.kt       # GET/POST/DELETE /api/flags — ownership enforced
│   ├── reports/
│   │   └── ReportsController.kt     # POST /api/reports — question accuracy reports
│   ├── account/
│   │   └── AccountController.kt     # /api/account/* — student self-service: profile, password, passkeys, deletion
│   ├── progress/
│   │   └── ProgressController.kt    # /api/progress/* — readiness history, dashboard summary
│   │       # SA Finding 6: /api/progress/summary uses a single CTE query returning all
│   │       # dashboard sections in one DB round trip. Never make 6 separate queries.
│   ├── admin/
│   │   └── AdminController.kt       # /api/admin/* — all endpoints require ADMIN role
│   │       # GET  /api/admin/users                — list all users (paginated)
│   │       # GET  /api/admin/users/{id}            — single user + stats snapshot
│   │       # PUT  /api/admin/users/{id}            — edit email, role, exam_date
│   │       # POST /api/admin/users/{id}/reset-pw   — admin sets temp password
│   │       # DELETE /api/admin/users/{id}          — soft-delete (is_active=false)
│   │       # DELETE /api/admin/users/{id}/hard     — hard-delete (irreversible)
│   │       #   Requires confirmation token from POST /api/admin/users/{id}/confirm-hard-delete
│   │       #   Token expires in 5 min — prevents accidental or CSRF-triggered permanent deletion
│   │       # GET  /api/admin/users/{id}/impersonate — read-only stats/home view
│   │       #   SEC-6: impersonation sessions expire after 15 minutes
│   │       #   SEC-6: rate-limited to 3 impersonations per target user per day per admin
│   │       #   SEC-6: ADMIN_IMPERSONATE audit event includes expiry timestamp
│   │       # Role change guard: reject if actor demotes self; reject if change leaves 0 admins
│   │       # GET  /api/admin/kpis                  — aggregated KPI data
│   │       # GET  /api/admin/reports               — question report queue
│   │       # PUT  /api/admin/reports/{id}          — mark reviewed/dismissed
│   │       # GET  /api/admin/audit-log             — paginated audit log
│   │       # GET  /api/admin/content-cache         — cache table status
│   │       # POST /api/admin/content-cache/refresh — trigger manual refresh
│   │   └── FlagsRepository.kt
│   ├── reports/
│   │   ├── ReportsController.kt     # POST /api/reports — question accuracy reports
│   │   └── ReportsRepository.kt
│   ├── reading/
│   │   ├── ReadingController.kt     # GET/PUT /api/reading — content_key validated
│   │   └── ReadingRepository.kt
│   ├── audit/
│   │   └── AuditLogger.kt           # auth events, Claude calls, unusual activity
│   └── model/
│       ├── User.kt
│       ├── UserStats.kt
│       ├── FlaggedQuestion.kt
│       ├── ReadingPosition.kt
│       └── dto/                     # typed request/response DTOs (no Map<String,Any>)
│           ├── ClaudeRequest.kt
│           ├── FlagRequest.kt
│           └── StatsRequest.kt
├── src/main/resources/
│   ├── application.yml
│   └── schema.sql
└── Dockerfile
```

### 12.2 Database Schema

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL CHECK (length(email) <= 254),
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  token_version   INT NOT NULL DEFAULT 0,  -- incremented on logout to invalidate tokens
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,   -- false during 30-day deletion grace period
  last_active            TIMESTAMPTZ,                       -- updated on each /api/stats PUT
  deletion_scheduled_at  TIMESTAMPTZ,                       -- set when deletion requested; NULL = active
  display_name           TEXT CHECK (length(display_name) <= 50), -- optional; shown on home screen
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_last_active ON users(last_active);

CREATE TABLE user_stats (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  topic_scores        JSONB NOT NULL DEFAULT '{}',        -- per NCLEX Client Needs category
  ncjmm_step_scores   JSONB NOT NULL DEFAULT '{}',        -- per NCJMM cognitive step
  readiness_score     INT NOT NULL DEFAULT 0,             -- 0-100, computed server-side on each PUT
  readiness_band      TEXT NOT NULL DEFAULT 'Needs Work', -- "Needs Work"|"On Track"|"Strong"|"High Confidence"
  exam_date           DATE,                               -- student's scheduled NCLEX date
  spaced_rep_queue    JSONB NOT NULL DEFAULT '[]',        -- due items for spaced repetition
  total_answered      INT NOT NULL DEFAULT 0,
  total_correct       INT NOT NULL DEFAULT 0,
  streak              INT NOT NULL DEFAULT 0,
  best_streak         INT NOT NULL DEFAULT 0,
  history             JSONB NOT NULL DEFAULT '[]',        -- server enforces max 200 entries on write
  last_studied        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE flagged_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- UUID not SERIAL — non-enumerable
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question    JSONB NOT NULL,   -- sanitized server-side before insert (no HTML)
  topic       TEXT NOT NULL CHECK (length(topic) <= 100),
  category    TEXT NOT NULL CHECK (category IN ('Guessed','Confused','Review later')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reading_positions (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_key TEXT NOT NULL CHECK (content_key ~ '^content:[a-z0-9:_-]{1,100}$'),
  page        INT NOT NULL DEFAULT 0 CHECK (page >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, content_key)
);

-- Question accuracy reports — added per playtester review (Prof. Linda requirement)
CREATE TABLE question_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question    JSONB NOT NULL,              -- sanitized question snapshot (Jsoup cleaned)
  category    TEXT NOT NULL CHECK (category IN (
                'Clinically incorrect answer',
                'Wrong rationale',
                'Outdated information',
                'Confusing / poorly worded',
                'Other'
              )),
  freetext    TEXT CHECK (length(freetext) <= 500),
  reviewed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_reviewed ON question_reports(reviewed);
CREATE INDEX idx_reports_user ON question_reports(user_id);

CREATE INDEX idx_flags_user ON flagged_questions(user_id);
CREATE INDEX idx_reading_user ON reading_positions(user_id);

-- Passkey credentials — WebAuthn public keys per user
-- One user can have multiple passkeys (phone, laptop, security key)
CREATE TABLE user_credentials (
  id            TEXT PRIMARY KEY,              -- credential ID (base64url, from WebAuthn)
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    BYTEA NOT NULL,                -- COSE-encoded public key
  label         TEXT NOT NULL DEFAULT 'Passkey', -- user-visible name: "iPhone 15", "MacBook"
  sign_count    BIGINT NOT NULL DEFAULT 0,     -- monotonic counter for replay attack prevention
  transports    TEXT[] DEFAULT '{}',           -- ["internal","hybrid","usb"] hints
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX idx_credentials_user ON user_credentials(user_id);

-- Daily readiness score snapshots — drives progress dashboard trend chart
-- Written by a @Scheduled job at midnight each day for all active users with total_answered >= 50
CREATE TABLE readiness_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  band        TEXT NOT NULL,
  -- SA Finding 4: TIMESTAMPTZ not DATE — midnight UTC misattributes sessions for non-UTC students.
  -- Frontend converts to student's local date for calendar display.
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, DATE(recorded_at AT TIME ZONE 'UTC'))  -- one snapshot per UTC day per user
);

CREATE INDEX idx_readiness_history_user ON readiness_history(user_id, recorded_at DESC);

-- Server-side content cache — indexed once at deploy time by developer
-- FDA labels, MedlinePlus summaries, RxNorm data — same for all users
-- Served to clients via GET /api/content/{content_key}
CREATE TABLE content_cache (
  content_key   TEXT PRIMARY KEY CHECK (content_key ~ '^content:(fda|medline|rxnorm):[a-z0-9:_-]{1,100}$'),
  data          JSONB NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('openFDA', 'MedlinePlus', 'RxNorm')),
  indexed_at    TIMESTAMPTZ DEFAULT NOW(),
  ttl_days      INT NOT NULL DEFAULT 90
);

CREATE INDEX idx_content_cache_source ON content_cache(source);
-- SA Finding 2: index on indexed_at for daily batch refresh query (findByIndexedAtBefore)
CREATE INDEX idx_content_cache_indexed_at ON content_cache(indexed_at);

-- Persistent audit log — replaces log-only AuditLogger for admin dashboard
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_FAILED',
                'AUTH_PASSWORD_RESET', 'CLAUDE_CALL', 'RATE_LIMIT',
                'CACHE_REFRESH', 'ADMIN_USER_EDIT', 'ADMIN_USER_DELETE',
                'ADMIN_PASSWORD_RESET', 'ADMIN_IMPERSONATE'
              )),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL, -- admin who performed the action
  metadata    JSONB,           -- event-specific data (context, ip, counts, etc.)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_event_type ON audit_log(event_type, created_at DESC);
CREATE INDEX idx_audit_user_id ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
-- SA Finding 8: Partial index on recent rows — admin dashboard queries last 90 days only.
-- Keeps index small as table grows; full table scan avoided for all dashboard queries.
CREATE INDEX idx_audit_recent ON audit_log(created_at DESC, event_type)
  WHERE created_at > NOW() - INTERVAL '90 days';

```

Key schema changes from original:
- `flagged_questions.id` is UUID (non-enumerable) — prevents IDOR guessing attacks
- `token_version` on users — incremented on logout to invalidate outstanding JWTs
- `user_stats.offlineBankGeneratedAt TIMESTAMPTZ` — SA Finding 7: cross-device gate for offline bank regeneration; prevents duplicate $0.30 generations when student uses multiple devices
- `content_key` has a regex CHECK constraint — server validates format at DB level too
- `topic` has a length CHECK — prevents oversized payloads reaching the DB

**Content cache key prefixes:**
- `content:fda:{drugname}` — openFDA drug labels (~282 drugs, TTL 90 days)
- `content:rxnorm:{drugname}` — RxNorm drug classes (~282 drugs, TTL 90 days)
- `content:medline:{topic}` — MedlinePlus summaries (~30 topics, TTL 90 days)
- `content:static:{key}` — herbal supplements, IV fluids, vaccines (22 entries, no TTL — static)
- `content:openrn:{topic}` — pre-extracted textbook chapters (bundled, no TTL)
- `content:openstax:ngn:{book}` — pre-extracted NGN case studies (bundled, no TTL)

### 12.3 LLM Service — Spring AI 1.1, Provider-Agnostic

**Design:** The frontend always calls `/api/claude`. The backend routes to whichever
`ChatModel` Spring AI activates based on `LLM_PROVIDER` env var. Swapping providers
requires no code changes — only env var and API key changes in Railway.

#### 12.3.1 Gradle Dependencies

```kotlin
// build.gradle.kts
implementation(platform("org.springframework.ai:spring-ai-bom:1.1.0"))

// Default provider — always included
implementation("org.springframework.ai:spring-ai-anthropic-spring-boot-starter")

// Optional providers — uncomment to enable (include starter, set env var + API key)
// implementation("org.springframework.ai:spring-ai-openai-spring-boot-starter")
// implementation("org.springframework.ai:spring-ai-vertex-ai-gemini-spring-boot-starter")
// implementation("org.springframework.ai:spring-ai-ollama-spring-boot-starter")
```

#### 12.3.2 application.yml — Provider Configuration

```yaml
spring:
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY:}
      chat:
        options:
          model: claude-sonnet-4-6-20260218   # pinned snapshot — update deliberately
          max-tokens: 1000

    # Uncomment when enabling OpenAI support
    # openai:
    #   api-key: ${OPENAI_API_KEY:}
    #   chat:
    #     options:
    #       model: gpt-4o
    #       max-tokens: 1000

    # Uncomment for local Ollama support (zero API cost)
    # ollama:
    #   base-url: ${OLLAMA_BASE_URL:http://localhost:11434}
    #   chat:
    #     options:
    #       model: ${OLLAMA_MODEL:llama3.1}

nclex:
  llm:
    provider: ${LLM_PROVIDER:anthropic}           # anthropic | openai | gemini | ollama
    prompt-variant: ${LLM_PROMPT_VARIANT:claude}  # claude | openai | generic
    max-tokens: ${LLM_MAX_TOKENS:1000}
```

#### 12.3.3 LlmProviderConfig — Active Bean Selection

```kotlin
// LlmProviderConfig.kt
// Activates the correct ChatModel based on LLM_PROVIDER env var.
// Startup fails fast with a clear message if the required API key is missing.
@Configuration
class LlmProviderConfig(@Value("\${nclex.llm.provider}") private val provider: String) {

    @Bean("activeChatModel")
    fun activeChatModel(
        anthropic: Optional<AnthropicChatModel>,
        openAi:    Optional<OpenAiChatModel>,
        ollama:    Optional<OllamaChatModel>
    ): ChatModel = when (provider.lowercase()) {
        "anthropic" -> anthropic.orElseThrow {
            IllegalStateException("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY")
        }
        "openai" -> openAi.orElseThrow {
            IllegalStateException("LLM_PROVIDER=openai requires OPENAI_API_KEY + openai starter")
        }
        "ollama" -> ollama.orElseThrow {
            IllegalStateException("LLM_PROVIDER=ollama requires ollama starter + OLLAMA_BASE_URL")
        }
        else -> throw IllegalStateException(
            "Unknown LLM_PROVIDER=$provider. Valid: anthropic, openai, ollama"
        )
    }
}
```

#### 12.3.4 PromptRegistry — Per-Provider Prompt Variants

Prompts are not portable across providers. Claude, GPT-4o, and Ollama models have different
instruction-following styles — especially for structured JSON output and two-step validation.
Prompt files live in `src/main/resources/prompts/{variant}/` and are loaded at startup.

```
resources/prompts/
├── claude/                  # default — optimised for Claude instruction style
│   ├── question_gen.txt
│   ├── voice_assistant.txt
│   ├── ngn_safety_review.txt
│   ├── flashcard_gen.txt
│   └── offline_gen.txt
├── openai/                  # submitted by contributor — validated against golden set
│   ├── question_gen.txt
│   └── voice_assistant.txt
└── generic/                 # baseline for new providers — lower quality, broadly compatible
    └── question_gen.txt
```

```kotlin
// PromptRegistry.kt
@Component
class PromptRegistry(
    @Value("\${nclex.llm.prompt-variant}") private val variant: String,
    private val resourceLoader: ResourceLoader
) {
    // Cache loaded at startup — no file I/O per request
    private val cache: Map<String, String> by lazy { loadAllPrompts() }

    fun get(context: LlmContext): String =
        cache["$variant/${context.fileName}"]
            ?: cache["generic/${context.fileName}"]
            ?: throw IllegalStateException("No prompt found for $context variant=$variant")

    private fun loadAllPrompts(): Map<String, String> {
        val prompts = mutableMapOf<String, String>()
        for (v in listOf(variant, "generic")) {
            for (ctx in LlmContext.entries) {
                val path = "classpath:prompts/$v/${ctx.fileName}"
                runCatching {
                    prompts["$v/${ctx.fileName}"] =
                        resourceLoader.getResource(path).inputStream.bufferedReader().readText()
                }
            }
        }
        return prompts
    }
}

enum class LlmContext(val fileName: String) {
    QUESTION_GEN    ("question_gen.txt"),
    VOICE_ASSISTANT ("voice_assistant.txt"),
    NGN_SAFETY_REVIEW("ngn_safety_review.txt"),
    FLASHCARD_GEN   ("flashcard_gen.txt"),
    OFFLINE_GEN     ("offline_gen.txt")
}
```

#### 12.3.5 LlmService — Spring AI ChatModel Invocation

```kotlin
// LlmService.kt
// All LLM calls go through here. Provider-agnostic. Rate limiting and audit
// logging applied here — LlmController stays thin.
@Service
class LlmService(
    @Qualifier("activeChatModel") private val chatModel: ChatModel,
    private val promptRegistry: PromptRegistry,
    private val auditLogger: AuditLogger,
    @Value("\${nclex.llm.max-tokens:1000}") private val maxTokens: Int
) {
    suspend fun complete(
        context: LlmContext,
        messages: List<MessageDto>,
        userId: UUID
    ): String {
        val systemPrompt = promptRegistry.get(context)
        val chatMessages: List<Message> = listOf(SystemMessage(systemPrompt)) +
            messages.map {
                if (it.role == "user") UserMessage(it.content)
                else AssistantMessage(it.content)
            }

        val options = ChatOptionsBuilder.builder().withMaxTokens(maxTokens).build()
        val prompt = Prompt(chatMessages, options)

        val start = System.currentTimeMillis()
        return try {
            val response = chatModel.call(prompt)
            val duration = System.currentTimeMillis() - start
            auditLogger.logClaudeCall(userId, context.name, duration)
            response.result.output.content
                ?: throw ExternalServiceException("LLM", RuntimeException("Empty response"))
        } catch (ex: Exception) {
            val duration = System.currentTimeMillis() - start
            auditLogger.logClaudeCall(userId, context.name, duration)
            when (ex) {
                is ExternalServiceException -> throw ex
                else -> throw ExternalServiceException("LLM (${provider()})", ex)
            }
        }
    }

    private fun provider() = chatModel::class.simpleName ?: "unknown"
}
```

#### 12.3.6 LlmController — Thin REST Endpoint

```kotlin
// LlmController.kt
// Path kept as /api/claude for frontend backward compatibility.
// Client request/response contract unchanged — provider swap is invisible to frontend.
@RestController
@RequestMapping("/api/claude")
class LlmController(
    private val llmService: LlmService,
    private val rateLimiterCache: Cache<String, Bucket>
) {
    @PostMapping
    suspend fun complete(
        @Valid @RequestBody request: ClaudeRequest,
        @AuthenticationPrincipal userId: UUID
    ): ResponseEntity<String> {
        // Rate limit check — Bucket4j via Caffeine cache (SEC-2)
        val bucket = rateLimiterCache.get(userId.toString()) {
            Bucket.builder()
                .addLimit(Bandwidth.classic(200, Refill.intervally(200, Duration.ofHours(1))))
                .build()
        }!!
        if (!bucket.tryConsume(1)) {
            throw RateLimitException(retryAfterSeconds = 3600)
        }

        val context = LlmContext.entries.firstOrNull {
            it.name.lowercase() == request.context?.lowercase()
        } ?: LlmContext.QUESTION_GEN

        val response = llmService.complete(context, request.messages, userId)
        return ResponseEntity.ok(response)
    }
}

// DTO — unchanged from original; frontend contract preserved
data class ClaudeRequest(
    @field:NotEmpty @field:Size(max = 20) val messages: List<MessageDto>,
    @field:Size(max = 20) val context: String? = null
)

data class MessageDto(
    @field:Pattern(regexp = "user|assistant") val role: String,
    @field:Pattern(regexp = "question_gen|voice_assistant|flashcard_gen|offline_gen|ngn_safety_review")
    val context: String?,
    @field:NotBlank @field:Size(max = 8000) val content: String
)
```

#### 12.3.7 Adding a New Provider (Open Source Contributors)

To add a new LLM provider (e.g. Gemini, Mistral, Cohere):

1. Add the Spring AI starter to `build.gradle.kts`
2. Add a config block in `application.yml` under `spring.ai.{provider}`
3. Add an `else if` branch in `LlmProviderConfig` for the new provider name
4. Create `src/main/resources/prompts/{provider}/` with at minimum `question_gen.txt`
5. Run the golden-set evaluation (Test Strategy §14.2) against your prompts — submit
   results in your PR. PRs without golden-set results will not be merged.
6. Add your provider to `CONTRIBUTING_LLM_PROVIDER.md` with minimum hardware/cost notes

**LiteLLM sidecar (for local model support without code changes):**
Any OpenAI-compatible server works as an Ollama drop-in. Students who want free local
inference can run LiteLLM as a Docker sidecar pointing at Ollama, then set:
```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://litellm:4000
```
No app code changes required.

### 12.4 Auth — JWT in HttpOnly Cookie, Password Policy, Token Revocation

Email/password auth remains the primary method and required fallback. Passkey auth is additive — see §12.5. Both methods set the same HttpOnly session cookie on success.

```kotlin
@Component
class JwtUtil(@Value("\${jwt.secret}") private val secret: String) {

    // Generate token — includes token_version for revocation support
    // JWT_SECRET must be base64-encoded 256-bit key: openssl rand -base64 32
    // BASE64.decode enforces minimum 32-byte key — rejects short human-readable strings
    private val signingKey = Keys.hmacShaKeyFor(Decoders.BASE64.decode(secret))

    fun generate(userId: UUID, tokenVersion: Int): String = Jwts.builder()
        .subject(userId.toString())
        .claim("tv", tokenVersion)  // token version — must match DB on validation
        .expiration(Date(System.currentTimeMillis() + 30 * 24 * 60 * 60 * 1000L))
        .signWith(signingKey)
        .compact()

    fun validate(token: String): Pair<UUID, Int>? = runCatching {
        val claims = Jwts.parser()
            .verifyWith(signingKey)
            .build().parseSignedClaims(token).payload
        Pair(UUID.fromString(claims.subject), claims["tv"] as Int)
    }.getOrNull()
    // JwtCookieFilter must verify: token_version matches AND user.is_active == true
    // is_active=false means pending_deletion — reject all endpoints except cancel-deletion
}

@Service
class AuthService(
    private val userRepository: UserRepository,
    private val jwtUtil: JwtUtil,
    private val passwordEncoder: BCryptPasswordEncoder
) {
    companion object {
        private val COMMON_PASSWORDS = setOf("password", "12345678", "nclex1234", "nursing1")
    }

    fun register(email: String, password: String): User {
        validatePassword(password)
        if (userRepository.existsByEmail(email.lowercase().trim())) {
            // Generic error — don't reveal whether email is registered (LOW-1)
            throw IllegalArgumentException("Registration failed. Please try again.")
        }
        return userRepository.save(User(
            email = email.lowercase().trim(),
            passwordHash = passwordEncoder.encode(password)
        ))
    }

    fun login(email: String, password: String): String {
        val user = userRepository.findByEmail(email.lowercase().trim())
            ?: throw UnauthorizedException("Invalid credentials")
        if (!passwordEncoder.matches(password, user.passwordHash)) {
            throw UnauthorizedException("Invalid credentials")
        }
        return jwtUtil.generate(user.id, user.tokenVersion)
    }

    fun logout(userId: UUID) {
        // Increment token_version — all existing tokens for this user become invalid
        // SA Finding 3: Other devices holding old tokens will receive 401 on next request.
        // Frontend must handle 401 globally: clear session + redirect to login with
        // message "Your session expired on another device. Please sign in again."
        userRepository.incrementTokenVersion(userId)
    }

    private fun validatePassword(password: String) {
        require(password.length >= 8)   { "Password must be at least 8 characters" }
        require(password.length <= 72)  { "Password must be at most 72 characters" }  // bcrypt truncation limit
        require(password !in COMMON_PASSWORDS) { "Password is too common" }
    }
}
```

**JWT is set as an HttpOnly cookie on login — never returned in the response body:**
```kotlin
@PostMapping("/login")
fun login(@Valid @RequestBody req: LoginRequest, response: HttpServletResponse): ResponseEntity<Unit> {
    val token = authService.login(req.email, req.password)
    val cookie = Cookie("nclex_session", token).apply {
        isHttpOnly = true    // invisible to JavaScript — XSS cannot steal it
        secure = true        // HTTPS only
        path = "/"
        maxAge = 30 * 24 * 60 * 60
        setAttribute("SameSite", "Strict")
    }
    response.addCookie(cookie)
    return ResponseEntity.ok().build()
}

@PostMapping("/logout")
fun logout(@AuthenticationPrincipal userId: UUID, response: HttpServletResponse): ResponseEntity<Unit> {
    authService.logout(userId)
    val cookie = Cookie("nclex_session", "").apply {
        isHttpOnly = true; secure = true; path = "/"; maxAge = 0
    }
    response.addCookie(cookie)
    return ResponseEntity.ok().build()
}
```

### 12.4.1 Passkey Authentication — WebAuthn / FIDO2

Spring Security 6.4+ has native passkey support via `spring-security-webauthn`. No third-party library needed.

**Gradle dependency:**
```kotlin
implementation("org.springframework.security:spring-security-webauthn")
```

**SecurityConfig — add WebAuthn alongside existing form login:**
```kotlin
@Bean
fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
    http
        .webAuthn { webAuthn ->
            webAuthn
                .rpName("NCLEX Trainer")
                .rpId("your-app.railway.app")
                .allowedOrigins("https://your-app.railway.app")
        }
        .formLogin { form -> form.loginPage("/login").permitAll() }
        // SEC-4: CORS locked to CORS_ORIGIN env var — startup assertion rejects * or http://
        // CorsConfig.kt validates on application startup:
        //   require(corsOrigin.startsWith("https://") && corsOrigin != "https://*") {
        //     "CORS_ORIGIN must be a specific https:// URL, not wildcard. Got: $corsOrigin"
        //   }
        // CSRF: SameSite=Strict is primary defence. CookieCsrfTokenRepository as defence-in-depth.
        .csrf { csrf ->
            csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            csrf.ignoringRequestMatchers("/api/auth/**", "/login/webauthn", "/webauthn/**")
        }
        // ... existing JWT filter, security headers config
    return http.build()
}
```

**JDBC persistence — Spring Security built-in repositories:**
```kotlin
@Bean
fun userCredentialRepository(jdbcTemplate: JdbcTemplate): UserCredentialRepository =
    JdbcUserCredentialRepository(jdbcTemplate)

@Bean
fun publicKeyCredentialUserEntityRepository(jdbcTemplate: JdbcTemplate): PublicKeyCredentialUserEntityRepository =
    JdbcPublicKeyCredentialUserEntityRepository(jdbcTemplate)
```

Spring Security auto-creates its own passkey tables on startup. The `user_credentials` table in §12.2 is our custom view for the admin dashboard (labels, last_used_at, revoking per-device).

**WebAuthn endpoints (provided automatically by Spring Security):**
```
GET  /webauthn/register/options     → registration challenge (requires active session)
POST /webauthn/register             → store public key
GET  /webauthn/authenticate/options → authentication challenge (no auth required)
POST /login/webauthn                → verify assertion → set HttpOnly cookie
```

**Frontend — passkey registration (Settings screen, post-login):**
```javascript
async function registerPasskey() {
  const opts = await fetch('/webauthn/register/options',
    { credentials: 'include' }).then(r => r.json());

  const credential = await navigator.credentials.create({ publicKey: opts });

  return fetch('/webauthn/register', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: encodeCredential(credential),
                           label: inferDeviceLabel() })
  }).then(r => r.ok);
}

function inferDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Passkey';
}

// Feature detection — hide passkey UI if browser doesn't support it
const PASSKEY_SUPPORTED =
  typeof window.PublicKeyCredential !== 'undefined' &&
  typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
```

**Frontend — passkey login (Login screen, conditional mediation):**
```javascript
// Runs on login screen mount — non-blocking
// conditional mediation shows passkeys in browser autofill alongside saved passwords
async function initPasskeyLogin() {
  if (!PASSKEY_SUPPORTED) return;

  const opts = await fetch('/webauthn/authenticate/options',
    { credentials: 'include' }).then(r => r.json());

  const assertion = await navigator.credentials.get({
    publicKey: opts,
    mediation: 'conditional'   // browser autofill integration
  });

  const res = await fetch('/login/webauthn', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encodeAssertion(assertion))
  });

  if (res.ok) navigate('/');
}
```

**Login screen priority:**
- If `PASSKEY_SUPPORTED`: trigger conditional mediation silently; show "Sign in with passkey" button prominently; email/password form below
- If not supported: show email/password form only

**HTTPS requirement:** WebAuthn is blocked on plain HTTP by all browsers. Railway provides HTTPS automatically — no configuration needed. For local development, test passkeys on the Railway preview URL, not `http://localhost`.

**Admin: revoke passkeys (lost device recovery):**
```kotlin
@DeleteMapping("/users/{userId}/passkeys")
@PreAuthorize("hasRole('ADMIN')")
fun revokeAllPasskeys(@PathVariable userId: UUID,
                      @AuthenticationPrincipal adminId: UUID): ResponseEntity<Unit> {
    userCredentialRepository.deleteByUserId(userId)
    auditLogger.logAdminAction("PASSKEY_REVOKE", adminId, userId, "all passkeys revoked")
    return ResponseEntity.noContent().build()
}
```

### 12.5 Rate Limiting — Bucket4j

```kotlin
// RateLimitConfig.kt
@Configuration
class RateLimitConfig {
    // Login: 5 attempts per IP per 15 minutes (brute-force protection)
    @Bean fun loginRateLimiter() = Bucket.builder()
        .addLimit(Bandwidth.classic(5, Refill.intervally(5, Duration.ofMinutes(15))))
        .build()

    // SEC-3: Passkey login endpoints need same brute-force protection as password login.
    // /webauthn/authenticate/options and /login/webauthn share this limiter, keyed by IP.
    @Bean fun passkeyRateLimiter() = Bucket.builder()
        .addLimit(Bandwidth.classic(5, Refill.intervally(5, Duration.ofMinutes(15))))
        .build()

    // Register: 3 accounts per IP per hour (account farming protection)
    @Bean fun registerRateLimiter() = Bucket.builder()
        .addLimit(Bandwidth.classic(3, Refill.intervally(3, Duration.ofHours(1))))
        .build()

    // Claude proxy: 200 requests per user per hour (cost protection)
    // SEC-2: ConcurrentHashMap grows unbounded — use Caffeine cache with eviction.
    // Inactive users' buckets evicted after 2 hours; caps memory at ~5MB for 5000 users.
    @Bean fun claudeRateLimiterCache(): Cache<String, Bucket> = Caffeine.newBuilder()
        .maximumSize(5000)
        .expireAfterAccess(2, TimeUnit.HOURS)
        .build()

    @Bean fun claudeRateLimiterFactory(cache: Cache<String, Bucket>) =
        RateLimiterFactory { userId ->
            cache.get(userId) {
                Bucket.builder()
                    .addLimit(Bandwidth.classic(200, Refill.intervally(200, Duration.ofHours(1))))
                    .build()
            }!!
        }
}
```

Rate limit headers returned on 429:
```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <epoch seconds when limit resets>
Retry-After: 3600
```

### 12.6 Input Validation — Typed DTOs

All endpoints use typed DTOs with Bean Validation — no `Map<String, Any>` on any endpoint.

```kotlin
// Flag request — typed, length-constrained, category allowlisted
data class FlagRequest(
    @field:NotBlank @field:Size(max = 100) val topic: String,
    @field:NotNull val question: QuestionSnapshot,
    @field:Pattern(regexp = "Guessed|Confused|Review later") val category: String
)

data class QuestionSnapshot(
    @field:NotBlank @field:Size(max = 2000) val question: String,
    @field:Size(max = 5000) val rationale: String?,
    @field:Pattern(regexp = "multiple_choice|sata|dosage|ngn") val type: String,
    @field:Size(max = 100) val topic: String?
    // no arbitrary Map fields — only declared properties are deserialized
)

// Stats request — server enforces size caps regardless of client value
// SEC-1: Uncapped map fields allow storage-exhaustion attacks — cap all collections.
data class StatsRequest(
    @field:Size(max = 50)   // 8 NCLEX categories + sub-topics with headroom
    val topicScores: Map<String, TopicScore>,
    @field:Size(max = 10)   // only 6 NCJMM steps exist — 10 gives headroom
    val ncjmmStepScores: Map<String, StepScore>?,
    @field:Min(0) @field:Max(100000) val totalAnswered: Int,
    @field:Min(0) @field:Max(100000) val totalCorrect: Int,
    @field:Min(0) @field:Max(3650)   val streak: Int,
    @field:Min(0) @field:Max(3650)   val bestStreak: Int,
    @field:Size(max = 200)           // server also takes .takeLast(200) before persisting
    val history: List<HistoryEntry>
)

// Reading position — content_key validated by regex
data class ReadingRequest(
    @field:Pattern(regexp = "^content:[a-z0-9:_-]{1,100}$") val contentKey: String,
    @field:Min(0) val page: Int
)
```

Server-side sanitization before any JSONB insert — strips all HTML from string fields:
```kotlin
fun sanitizeQuestionSnapshot(q: QuestionSnapshot): QuestionSnapshot = q.copy(
    question = Jsoup.clean(q.question, Safelist.none()),
    rationale = q.rationale?.let { Jsoup.clean(it, Safelist.none()) }
)
// Uses Jsoup (already in Spring ecosystem) — Safelist.none() strips all HTML tags
```

### 12.6.4 In-Process Content Cache — Caffeine

FDA labels and MedlinePlus summaries are the same for every user and change only on 90-day refresh. A Caffeine in-process cache on `ContentCacheService` eliminates repeated PostgreSQL hits for the same key within a session.

```kotlin
// build.gradle.kts
implementation("com.github.ben-manes.caffeine:caffeine")
implementation("org.springframework.boot:spring-boot-starter-cache")

// CacheConfig.kt
@Configuration
@EnableCaching
class CacheConfig {
    @Bean
    fun cacheManager(): CacheManager = CaffeineCacheManager("content-cache").apply {
        setCaffeine(Caffeine.newBuilder()
            .maximumSize(500)           // max 500 keys in memory (~300 drugs + ~50 topics + headroom)
            .expireAfterWrite(1, TimeUnit.HOURS)
            .recordStats())             // exposes hit rate via /actuator/metrics
    }
}

// ContentCacheService.kt
@Service
class ContentCacheService(private val contentCacheRepository: ContentCacheRepository) {
    @Cacheable("content-cache", key = "#contentKey")
    fun getByKey(contentKey: String): ContentCacheEntry? =
        contentCacheRepository.findByContentKey(contentKey)
}
```

Cache is populated on first request per key, invalidated hourly. On 90-day refresh the batch job updates the DB — the in-process cache self-expires within 1 hour and picks up fresh data automatically.

### 12.7 Security Headers

Spring Security is configured to add these response headers to every request:

```kotlin
// SecurityConfig.kt
http.headers { headers ->
    headers.contentTypeOptions { }  // X-Content-Type-Options: nosniff — SEC-10: Spring Security
                                    // applies this to ALL responses including JSON API endpoints,
                                    // not just HTML. Confirmed: ContentTypeOptionsHeaderWriter
                                    // is added to the filter chain unconditionally.
    headers.frameOptions { it.deny() }                     // X-Frame-Options: DENY
    headers.httpStrictTransportSecurity { hsts ->          // HSTS — HTTPS only
        hsts.maxAgeInSeconds = 31536000
        hsts.includeSubdomains = true
    }
    headers.contentSecurityPolicy { csp ->
        csp.policyDirectives(
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +  // inline styles needed for React
            "img-src 'self' data:; " +
            "connect-src 'self' https://api.anthropic.com https://*.nlm.nih.gov https://api.fda.gov; " +
            "object-src 'none'; " +
            "frame-ancestors 'none'"
        )
    }
    headers.referrerPolicy { it.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN) }
    // SEC-8: Permissions-Policy — allow microphone for voice assistant, deny everything else
    headers.permissionsPolicy { policy ->
        policy.policy("microphone=(self), camera=(), geolocation=(), payment=(), usb=()")
    }
}
```

### 12.8 Audit Logging

```kotlin
@Component
class AuditLogger(private val auditLogRepository: AuditLogRepository) {
    private val log = LoggerFactory.getLogger(AuditLogger::class.java)

    // All events persisted to audit_log table for admin dashboard queries
    // Also written to application log for Railway log drain

    fun logAuth(event: String, userId: UUID?, email: String, ip: String, success: Boolean) {
        log.info("AUTH {} email={} ip={} success={}", event, email.take(50), ip, success)
        auditLogRepository.save(AuditLog(
            eventType = "AUTH_${event.uppercase()}",
            userId = userId,
            metadata = mapOf("email" to email.take(50), "ip" to ip, "success" to success)
        ))
    }

    fun logClaudeCall(userId: UUID, context: String?) {
        log.info("CLAUDE userId={} context={}", userId, context)
        auditLogRepository.save(AuditLog(
            eventType = "CLAUDE_CALL",
            userId = userId,
            metadata = mapOf("context" to (context ?: "unknown"))
        ))
    }

    fun logRateLimit(endpoint: String, userId: UUID?) {
        log.warn("RATE_LIMIT endpoint={} userId={}", endpoint, userId)
        auditLogRepository.save(AuditLog(
            eventType = "RATE_LIMIT",
            userId = userId,
            metadata = mapOf("endpoint" to endpoint)
        ))
    }

    fun logCacheRefresh(refreshed: Int, failed: Int) {
        log.info("CACHE_REFRESH refreshed={} failed={}", refreshed, failed)
        auditLogRepository.save(AuditLog(
            eventType = "CACHE_REFRESH",
            metadata = mapOf("refreshed" to refreshed, "failed" to failed)
        ))
    }

    fun logAdminAction(event: String, actorId: UUID, targetUserId: UUID, detail: String) {
        log.info("ADMIN {} actor={} target={} detail={}", event, actorId, targetUserId, detail)
        auditLogRepository.save(AuditLog(
            eventType = "ADMIN_${event.uppercase()}",
            userId = targetUserId,
            actorId = actorId,
            metadata = mapOf("detail" to detail)
        ))
    }
}
```

### 12.9 Environment Variables (Railway)

```
ANTHROPIC_API_KEY=sk-ant-...          # default provider — never sent to client
LLM_PROVIDER=anthropic                 # anthropic | openai | ollama (default: anthropic)
LLM_PROMPT_VARIANT=claude              # claude | openai | generic (default: claude)
# OPENAI_API_KEY=sk-...               # set if LLM_PROVIDER=openai
# OLLAMA_BASE_URL=http://...           # set if LLM_PROVIDER=ollama
DATABASE_URL=postgresql://...          # Railway managed PostgreSQL
JWT_SECRET=<cryptographically random 256-bit string>  # openssl rand -base64 32
CORS_ORIGIN=https://your-app.railway.app   # SEC-4: must start with https:// — never set to *
RAILWAY_ENVIRONMENT=production         # disables dev-only endpoints
ADMIN_EMAIL=you@example.com            # receives batch job alerts + textbook reminders
# Restrict Spring Actuator — health only public; metrics gated by ADMIN role in SecurityConfig
SMTP_HOST=smtp.gmail.com               # or any SMTP provider
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASSWORD=<app-specific password>  # use app password, not account password
```

**JWT_SECRET generation:** `openssl rand -base64 32` — never use a human-readable string.
**Rotation:** If JWT_SECRET changes, all existing sessions are invalidated. Plan accordingly.

### 12.10 Deployment

Single Railway service:
- Dockerfile builds Spring Boot fat JAR
- Spring Boot serves React build from `src/main/resources/static/`
- Vite build output copied to `static/` during CI/CD
- One Railway service, one Railway PostgreSQL addon
- HTTPS termination handled by Railway (automatic for railway.app domains)
- HTTP → HTTPS redirect enforced by Spring Security `requiresSecure()`

**DB migration strategy:**
- v5 launch: `schema.sql` runs on startup via `spring.sql.init.mode=always`. All schema changes before launch go here in order.
- Post-launch / v6: Add Flyway (`org.flywaydb:flyway-core`). Convert `schema.sql` to `V1__initial_schema.sql`. All subsequent changes via numbered migration files. Do not add Flyway mid-v5 — coordinate migration at the v6 boundary to avoid double-initialization.

---

## 12.6 Content Cache Batch Refresh — 90-Day Schedule

### Batch Job: API Content Refresh

All three content_cache sources (openFDA, MedlinePlus, RxNorm) use a uniform 90-day TTL. A Spring Boot `@Scheduled` job runs daily at 2am, checks for stale entries, and re-fetches only those that have expired. On most days it does nothing.

```kotlin
@Service
class ContentCacheRefreshService(
    private val contentCacheRepository: ContentCacheRepository,
    private val openFdaClient: OpenFdaClient,
    private val medlinePlusClient: MedlinePlusClient,
    private val rxNormClient: RxNormClient,
    private val emailService: EmailService
) {

    @Scheduled(cron = "0 0 2 * * *")  // 2am daily
    fun refreshStaleEntries() {
        val cutoff = Instant.now().minus(90, ChronoUnit.DAYS)
        val stale = contentCacheRepository.findByIndexedAtBefore(cutoff)

        if (stale.isEmpty()) return  // most days: nothing to do

        val results = stale.groupBy { it.source }
        var refreshed = 0
        var failed = 0

        results["openFDA"]?.forEach { entry ->
            val drugName = entry.contentKey.removePrefix("content:fda:")
            runCatching { openFdaClient.fetchLabel(drugName) }
                .onSuccess { data ->
                    contentCacheRepository.save(entry.copy(data = data, indexedAt = Instant.now()))
                    refreshed++
                }
                .onFailure { failed++ }
        }

        results["MedlinePlus"]?.forEach { entry ->
            val topic = entry.contentKey.removePrefix("content:medline:")
            runCatching { medlinePlusClient.fetchSummary(topic) }
                .onSuccess { data ->
                    contentCacheRepository.save(entry.copy(data = data, indexedAt = Instant.now()))
                    refreshed++
                }
                .onFailure { failed++ }
        }

        results["RxNorm"]?.forEach { entry ->
            val drug = entry.contentKey.removePrefix("content:rxnorm:")
            runCatching { rxNormClient.fetchClass(drug) }
                .onSuccess { data ->
                    contentCacheRepository.save(entry.copy(data = data, indexedAt = Instant.now()))
                    refreshed++
                }
                .onFailure { failed++ }
        }

        auditLogger.logCacheRefresh(refreshed, failed)

        if (failed > 0) {
            emailService.sendAdminAlert(
                subject = "NCLEX Trainer: Content cache refresh — $failed failures",
                body = """
                    Content cache refresh completed.
                    Refreshed: $refreshed entries
                    Failed: $failed entries
                    
                    Check Railway logs for details. Failed entries will retry on the next daily run.
                """.trimIndent()
            )
        }
    }
}
```

**Rate limiting during refresh:**
The refresh job reuses the same rate-limited clients used during initial indexing:
- openFDA: 200ms spacing between calls (~57 seconds for ~300 drugs)
- RxNorm: 100ms spacing (~30 seconds for ~300 drugs)
- MedlinePlus: 150ms spacing (~5 seconds for ~30 topics)

Total worst-case refresh time (all entries stale at once): ~90 seconds. Runs overnight — zero user impact.

### Textbook Content Email Reminder

OpenRN and OpenStax EPUBs are bundled with the app at build time and stored in IndexedDB on student devices. They do not auto-refresh — the student's downloaded copy only updates when they re-download. A 90-day email reminder prompts the developer to check for new editions and re-bundle if needed.

```kotlin
@Scheduled(cron = "0 0 9 1 */3 *")  // 9am on the 1st of every 3rd month
fun sendTextbookUpdateReminder() {
    emailService.sendAdminAlert(
        subject = "NCLEX Trainer: 90-day textbook review reminder",
        body = """
            This is your quarterly reminder to check for updated OpenRN and OpenStax editions.
            
            Check for new editions at:
            - OpenRN (all 7 books): https://www.wistechopen.org/open-rn-details
            - OpenStax Nursing: https://openstax.org/subjects/nursing
            
            If a new edition is available:
            1. Download the EPUB from wtcs.pressbooks.pub (or NCBI mirror: ncbi.nlm.nih.gov/books/NBK590025)
            2. Run the pre-extraction script to generate updated BUNDLED_CONTENT JSON
            3. Deploy — students will be prompted to re-download on next app open
            
            Also review NCLEX_Drug_List_Prof_Linda.md for any drugs that need updating
            (new approvals, label changes, removed drugs).
            
            Last app version: ${AppConfig.VERSION}
            Last textbook bundle date: ${AppConfig.TEXTBOOK_BUNDLE_DATE}
        """.trimIndent()
    )
}
```

**Email configuration** (Railway environment variables):
```
ADMIN_EMAIL=your-email@example.com
SMTP_HOST=smtp.gmail.com  (or any SMTP provider)
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
```

Add to `application.yml`:
```yaml
app:
  admin-email: ${ADMIN_EMAIL}
  smtp:
    host: ${SMTP_HOST}
    port: ${SMTP_PORT}
    user: ${SMTP_USER}
    password: ${SMTP_PASSWORD}

spring:
  mvc:
    # SEC-1: Reject oversized request bodies before they reach controllers
    max-request-size: 512KB
  servlet:
    multipart:
      max-request-size: 512KB
  datasource:
    hikari:
      maximum-pool-size: 20       # SA Finding 5: 50 concurrent users + batch jobs need headroom. Railway hobby max=25.
      minimum-idle: 2
      connection-timeout: 20000   # 20s before throwing SQLException
      idle-timeout: 300000        # 5min idle before releasing connection
      max-lifetime: 1200000       # 20min max connection lifetime
```

---



#### 12.6.2 Daily Readiness Snapshot

```kotlin
@Scheduled(cron = "0 0 0 * * *")  // midnight daily
fun snapshotReadinessScores() {
    // Only snapshot users who have enough data and studied recently
    val activeUsers = userStatsRepository.findEligibleForSnapshot(
        minAnswered = 50,
        activeWithinDays = 30
    )
    activeUsers.forEach { stats ->
        val score = computeReadinessScore(stats)
        readinessHistoryRepository.upsert(
            userId = stats.userId,
            score = score,
            band = readinessBand(score),
            date = LocalDate.now()
        )
    }
}
```

#### 12.6.3 Account Deletion Job — GDPR/CCPA Hard Delete

```kotlin
@Scheduled(cron = "0 0 3 * * *")  // 3am daily
fun processScheduledDeletions() {
    val due = userRepository.findDeletionsDue(before = Instant.now())
    val failedIds = mutableListOf<UUID>()

    due.forEach { user ->
        runCatching {
            // Hard delete all personal data in order of FK dependencies
            readinessHistoryRepository.deleteByUserId(user.id)
            flaggedQuestionsRepository.deleteByUserId(user.id)
            readingPositionsRepository.deleteByUserId(user.id)
            spacedRepQueueRepository.deleteByUserId(user.id)
            userStatsRepository.deleteByUserId(user.id)
            userCredentialsRepository.deleteByUserId(user.id)
            // Anonymize only — SET user_id = NULL, do NOT delete the row
            // question JSONB retained for clinical safety review (Prof. Linda requirement)
            questionReportsRepository.anonymizeByUserId(user.id)
            // audit_log: GDPR requires deletion of personal data in logs
            auditLogRepository.deleteByUserId(user.id)
            // Finally delete the user row itself
            userRepository.delete(user)
            auditLogger.logSystemEvent("ACCOUNT_DELETED", user.id, "GDPR hard delete executed")
        }.onFailure {
            failedIds.add(user.id)
        }
    }

    // Alert admin on any failures — GDPR violation risk if deletions don't complete
    if (failedIds.isNotEmpty()) {
        emailService.sendAdminAlert(
            subject = "NCLEX Trainer: Account deletion failures — GDPR risk",
            body = "Deletion job failed for ${failedIds.size} user(s).\n" +
                   "Failed IDs: ${failedIds.joinToString()}\n" +
                   "GDPR risk: investigate and resolve immediately. Check Railway logs."
        )
    }
}
```

**What is retained after deletion (not personal data under GDPR):**
- Aggregate KPI snapshots already written to `audit_log` as counts/averages — no personal identifiers
- `question_reports.question` JSONB — clinical safety data, user_id anonymized to NULL

**Grace period cancellation:**
```kotlin
// POST /api/account/cancel-deletion?token=<signed-jwt>
// Uses a short-lived signed JWT (24h) emailed to user at deletion-request time.
// Does NOT require cookie auth — account is suspended, cookie may be cleared.
// A bare userId would allow any attacker knowing the UUID to cancel deletion.
fun cancelDeletion(cancellationToken: String) {
    val userId = jwtUtil.validateCancellationToken(cancellationToken)
        ?: throw UnauthorizedException("Invalid or expired cancellation token")
    val user = userRepository.findById(userId)
        ?: throw NotFoundException("Account not found")
    // SEC-5: Verify grace period has not already passed — deletion_scheduled_at must be future
    val scheduled = user.deletionScheduledAt
        ?: throw ConflictException("No pending deletion found for this account")
    if (scheduled.isBefore(Instant.now())) {
        throw GoneException("Deletion period has expired. Your account has been permanently deleted.")
    }
    userRepository.updateDeletion(userId, scheduledAt = null, isActive = true)
    auditLogger.logAuth("DELETION_CANCELLED", userId, "", "", true)
}
```

#### 12.6.4 Audit Log Archival — 90-Day Cleanup

```kotlin
// SA Finding 8: audit_log grows unbounded without archival.
// At 50 students × 200 Claude calls/day = 10K rows/day → 3.65M rows/year.
// Monthly job deletes rows older than 90 days. Admin dashboard only queries last 90 days.
@Scheduled(cron = "0 0 4 1 * *")  // 4am on the 1st of every month
fun archiveAuditLog() {
    val cutoff = Instant.now().minus(90, ChronoUnit.DAYS)
    val deleted = auditLogRepository.deleteByCreatedAtBefore(cutoff)
    auditLogger.logSystemEvent("AUDIT_ARCHIVED", null, "Deleted $deleted rows older than 90 days")
}
```

---

## 13. App Startup Flow

**Critical distinction — two completely separate code paths:**

```javascript
async function appStartup() {
  // Step 1: Auth check
  const authed = await checkAuth();  // HEAD /api/health + validate cookie
  if (!authed) {
    renderLoginScreen();
    return;
  }

  // Step 2: Is this device already set up?
  const meta = await ContentDB.get('db:meta');
  if (!meta || meta.version !== APP_VERSION) {
    // FIRST-DEVICE SETUP — runs once per device, never again
    await runFirstDeviceSetup();
  } else {
    // RETURNING SESSION — zero indexing, < 1 second to home screen
    await runReturningSession();
  }
}

async function runReturningSession() {
  // Everything is already in localStorage (ContentDB) and PostgreSQL (user data)
  // Just load user data and render home screen
  const [stats, flags] = await Promise.all([
    UserDB.getStats(),
    UserDB.getFlags()
  ]);
  renderHomeScreen(stats, flags);
  // Done — student is studying. No indexing, no API calls beyond stats load.
}

async function runFirstDeviceSetup() {
  showSetupScreen();  // "Building your content library"

  // Phase 1: Load pre-bundled content from JS bundle — instant, no network
  await loadBundledContent(onProgress);   // OpenRN, OpenStax chapters
  await loadStaticContent(onProgress);    // all 15 static module keys
  // Student can start studying now
  unlockStudyModes(['mc', 'sata', 'dosage', 'ngn']);
  hideSetupScreen();
  renderHomeScreen();  // show home screen — setup continues in background

  // Phase 2: Background API indexing — runs while student practices
  indexGovernmentAPIs(onBackgroundProgress);  // FDA, MedlinePlus, RxNorm
  // Pharmacology questions unlock per drug as indexing completes
  // Progress pill shows at screen bottom — non-blocking
}
```

**What is NEVER re-run on returning sessions:**
- `loadBundledContent()` — OpenRN/OpenStax are already in localStorage
- `loadStaticContent()` — all 15 static keys already in localStorage
- Government API indexing — FDA labels, MedlinePlus, RxNorm already cached
- `db:meta` check is the skip gate: if it exists, skip everything above

**TTL-based refresh (only on manual trigger from Content Admin):**
- openFDA labels: stale after 90 days
- RxNorm: stale after 180 days
- Static content: never stale — only updates on app version change (new `APP_VERSION` forces re-setup)
- OpenRN/OpenStax: never stale — bundled at build time

**Migration from v4:** No breaking changes to existing data. v4 users have no `db:meta` — first open of v5 triggers first-device setup automatically.

---

## 13. Open Technical Questions

1. **Pre-extraction tooling**: Developer extracts text from downloaded OpenRN and OpenStax PDFs/EPUBs offline before the build. Recommended tools: `pdfplumber` (Python) or `pypdf2` for PDFs; `ebooklib` for EPUBs. Output must match the `BUNDLED_CONTENT` schema defined in §4.1. This is a one-time developer task, not a runtime concern.

2. **DOMParser availability**: We use `new DOMParser()` for HTML parsing in the reader's external URL fetcher. Available in all modern browsers. Confirmed safe to use.

3. **localStorage atomic writes**: If the user closes the tab mid-indexing, partial ContentDB data may be stored. The `db:meta.sources[source].status` field should only be set to `"ok"` after a source is fully written. On next open, sources with `"partial"` status are re-indexed.

4. **localStorage size**: Estimated ContentDB content is ~2MB total. Browser localStorage limit is 5-10MB per origin — well within range. Measure actual extracted JSON size before bundling. If any single key approaches 4MB, split into `content:openrn:pharmacology:1` and `content:openrn:pharmacology:2`.

5. **CORS on Claude proxy**: The frontend calls `/api/claude` on the same Railway domain — no CORS issue. Government APIs (openFDA, MedlinePlus, RxNorm) are called directly from the browser and have permissive CORS policies. No CORS concerns.

6. **JWT expiry and rotation**: JWTs expire after 30 days. `token_version` in the users table allows immediate revocation on logout.
   **SEC-9: Safe rotation procedure:**
   (1) Announce maintenance window 24 hours in advance via in-app banner.
   (2) Timed exam state is persisted to PostgreSQL on every answer — no exam progress is lost on logout.
   (3) Update `JWT_SECRET` in Railway env vars and redeploy — all sessions invalidated on next request.
   (4) Students are redirected to login with message "Your session expired. Please sign in again."
   Refresh token flow (zero-downtime rotation) deferred to v6.

7. **bcrypt 72-byte truncation**: bcrypt silently truncates passwords at 72 bytes. Passwords longer than 72 bytes hash identically to their first 72 bytes. Server enforces a 72-character maximum on registration to prevent this. Document this constraint in the user-facing password requirements.

8. **Drug corpus scope**: ~319 drugs across 21 categories as curated in `NCLEX_Drug_List_Prof_Linda.md`. ~282 are FDA-regulated (openFDA lookup). 22 are non-regulated (herbal supplements 8, IV fluids 7, vaccines/biologics 7) and use static bundled content in `STATIC_DRUG_CONTENT`. The static entries must be kept current with the drug list document — update on each app version release, not on TTL refresh.

9. **First-device setup duration**: ~282 openFDA calls at 200ms spacing = ~57 seconds. ~282 RxNorm calls at 100ms spacing = ~29 seconds. ~30 MedlinePlus calls at 150ms = ~5 seconds. Static content loads instantly. Total first-device setup (Phase 2 background): ~90 seconds. This runs once per device only — returning sessions skip entirely.

10. **Email verification**: No email verification in v5 — users can register with any email including typos. Add email verification + password reset in v6. For v5, provide a manual admin reset path via Railway PostgreSQL console if needed.

11. **Mammoth.js for MNWC**: CLOSED — this app is a deployed React/Vite application; Mammoth.js is available as a standard npm package. Bow-tie/trend items remain out of scope for v5 as a deliberate scope decision, not a technical limitation.

---

## 13.1 Companion Documents

This TDD is part of a suite of technical documents. All should be read together before beginning implementation.

| Document | Purpose | Location |
|---|---|---|
| **NCLEX_Trainer_v5_PRD.md** | Product requirements, sign-off criteria, user stories | `/docs/` |
| **NCLEX_Trainer_v5_TDD.md** | This document — architecture, schema, implementation spec | `/docs/` |
| **NCLEX_Trainer_v5_Test_Strategy.md** | Full test strategy: unit, integration, E2E, security, performance, accessibility. Coverage targets ≥90% line/branch/instruction. QA Lead reviewed. | `/docs/` |
| **NCLEX_Trainer_v5_Logging_Strategy.md** | Structured logging specification: log levels, event taxonomy, Railway log drain config, Admin Dashboard log surface. SA authored. | `/docs/` |
| **NCLEX_Trainer_v5_Error_Handling_Strategy.md** | Error handling specification: backend error hierarchy, frontend error boundaries, user-facing messages, retry logic. SA authored. | `/docs/` |

**SA notes on the Test Strategy (NCLEX_Trainer_v5_Test_Strategy.md v1.1):**

The test strategy is thorough and covers all critical paths. The following SA observations are specific to architectural concerns:

1. **IDB setBatch() test must validate transaction atomicity.** The `setBatch()` implementation writes all entries in a single IndexedDB transaction. The test "setBatch() writes all entries in single transaction" must verify that a failure mid-batch leaves *no* entries written (all-or-nothing), not a partial write. Add: `it('setBatch() is atomic — no partial writes on error')`.

2. **Testcontainers PostgreSQL version must match Railway.** The CI config specifies `postgres:16`. Confirm Railway is provisioned with PostgreSQL 16 — a version mismatch between test and production has caused silent behavior differences in constraint evaluation and JSONB indexing. Pin both to `postgres:16-alpine`.

3. **The concurrency test (Gap 7) needs `@Transactional(isolation = SERIALIZABLE)`** on `claimOfflineBankGeneration()`. Without serializable isolation, the optimistic lock pattern can allow both devices to read NULL simultaneously and both succeed. The test will pass but production will still have the race condition. The implementation note must specify `SERIALIZABLE` or a `SELECT ... FOR UPDATE` pattern.

4. **Golden-set evaluation (§14.2) should be gated in CI on release branches only**, not run manually. Add a `workflow_dispatch` trigger to the GitHub Actions pipeline so it can be triggered manually *or* automatically on tags. This ensures it runs before every release without blocking PRs.

5. **The performance test `p95 < 200ms` for returning session load** assumes Railway Hobby tier. If the app is ever moved to a dedicated tier, this threshold should be tightened to `p95 < 100ms`. Document the tier assumption explicitly in the performance test config.

---

## 14. Implementation Phases

**Phase 1: Backend + Auth + Security (Kotlin + Spring Boot)**
- Spring Boot project setup on Railway; Railway PostgreSQL provisioned
- Full schema (all 9 tables in §12.2): `users` (with role, is_active, deletion_scheduled_at), `user_stats`, `flagged_questions`, `reading_positions`, `question_reports`, `user_credentials`, `audit_log`, `content_cache`, `readiness_history`
- Auth: register (password policy + bcrypt), login (HttpOnly cookie), logout (token_version increment)
- Passkey: WebAuthn registration + authentication via Spring Security webAuthn() config (§12.4.1); user_credentials table for admin passkey management
- JWT in HttpOnly cookie — never in response body, never readable by JS
- Bucket4j rate limiting: login (5/15min), register (3/hr), Claude proxy (200/hr per user)
- LLM service: Spring AI 1.1 ChatModel via LlmService + LlmProviderConfig + PromptRegistry (§12.3). Anthropic provider active by default. LLM_PROVIDER env var selects provider at startup. Frontend calls /api/claude unchanged.
- User data endpoints: /api/stats (readiness score computed on PUT), /api/flags, /api/reading, /api/reports
- /api/health HEAD endpoint — no auth required, used for offline connectivity probe
- /api/admin/* endpoints — all require role='admin': /api/admin/users (CRUD), /api/admin/kpis, /api/admin/reports, /api/admin/audit-log, /api/admin/content-cache
- /api/content/{key} GET endpoint — serves content_cache entries (FDA labels, MedlinePlus, RxNorm) by content key; auth required; returns 404 if key not indexed
  - In-process Caffeine cache (`@Cacheable`) with 1-hour TTL on `ContentCacheService.getByKey()` — eliminates repeat DB hits for same drug/topic within a session. One Caffeine dependency + four config lines.
- /api/account/* endpoints — student self-service: GET/PUT profile, PUT password, GET/DELETE passkeys, POST delete-request, POST cancel-deletion
- /api/progress/* endpoints — GET readiness history (?days=7|30|90|all), GET dashboard summary (SA Finding 6: single CTE query — all 6 dashboard sections in one DB round trip, not 6 sequential queries)
- Jsoup sanitization on all JSONB fields; Bean Validation on all DTOs; UUID IDs on flags
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy; audit logging
- Readiness score algorithm (§9.6) implemented server-side in StatsController

**Phase 2: Frontend foundation (React + Vite)**
- Vite project setup; Railway static file serving
- Login / Register screens; `appStartup()` with returning-session vs first-device-setup paths (§13)
- `ContentDB` three-store routing wrapper (localStorage / IndexedDB / API); `UserDB` backend API wrapper (credentials: 'include')
- `AccountDB` — API wrapper for `/api/account/*` (profile, password, passkeys, deletion)
- `ProgressDB` — API wrapper for `/api/progress/*` (readiness history, dashboard summary)
- `/settings` and `/progress` route shells (empty screens wired to AccountDB/ProgressDB — UI built in Phase 5)
- `sanitizeFlagForStorage()`, `isSafeReaderUrl()`, `isOnline()` connectivity helpers
- `sync:pending` queue with `queueOperation()`, `flushPendingSync()`, auto-flush on reconnect
- `OfflineBanner` component; offline question manager skeleton
- Connectivity monitor started on app init

**Phase 3: Content indexing + First-device setup**
- Developer pre-extracts OpenRN + OpenStax PDFs/EPUBs offline using ebooklib/pdfplumber → `BUNDLED_CONTENT` JSON (schema: TDD §4.1)
- Developer runs one-time content_cache indexing script at deploy time: openFDA (~300 drugs), MedlinePlus (~30 topics), RxNorm (~300 drugs) — stored in PostgreSQL, served via /api/content/{key}. Not a student-side concern.
- `loadBundledContent()` — Phase 1 of first-device setup: loads OpenRN/OpenStax from BUNDLED_CONTENT into IndexedDB (~2 seconds, no network)
- `loadStaticContent()` — all 15 static localStorage keys: drug summaries, drug suffixes, labs, formulas, strategies, delegation, communication, diagnostics, health equity, development, infection control, herbals, IV fluids, vaccines
- First-device setup screen with per-step progress; study mode unlocks immediately after Phase 1
- Content Admin screen (Admin Dashboard Tab 5): cache status, last indexed, refresh controls, batch job history

**Phase 4: Question generators + Core UX + Admin Dashboard**
- Question generator with two-step NCJMM validation (§6.1) — generates question, then self-validates step tag
- Per-option rationale format enforced in all generator prompts
- Source attribution badges; skeleton loading screens
- NCJMM step tracking: `ncjmmStep` field persisted on every answered question
- Stats panel: All-time vs session toggle; NCJMM step accuracy tab; readiness score with 50q/3-topic gate
- Study Plan Generator (§5.7.2) using exam_date + topic/NCJMM weak areas
- Spaced repetition queue: due-item surfacing, interval scheduling (§9.5)
- AI flashcard generation from rationale via /api/claude
- Study Guides hub: browseable ContentDB content by NCLEX category
- Report Question button: submits to /api/reports, count badge in Content Admin
- Admin Dashboard: /admin route, role guard, all 5 tabs (Users, KPIs, Reports, Audit Log, Content)
- AuditLogger writing to audit_log table — all events queryable by admin dashboard
- Admin user management: CRUD, password reset, soft/hard delete, impersonation mode
- Offline bank generation: `shouldRegenerateBank()` daily check, `generateOfflineBank()` background run
- Timed exam simulation (§9.7): no-going-back, locked rationales, 5-hour timer, end-of-exam report

**Phase 5: Voice assistant + Native reader + Account & Progress**
- `/settings` route: profile edit, password change, passkey management, account deletion flow
- `/progress` route: readiness trend chart (7/30/90/full toggle), monthly study calendar, topic/NCJMM bars, question volume stats, flagged queue summary
- `AccountController` + `ProgressController` endpoints
- Daily readiness snapshot @Scheduled job (§12.6.2)
- Account deletion @Scheduled job (§12.6.3) + grace period cancellation endpoint

**Phase 5 (continued): Voice assistant + Native reader**
- Voice assistant: full ContentDB corpus + student stats injected into system prompt (§10.3)
- NCJMM step awareness, struggle detection, Socratic withholding, proactive coaching
- Resource surfacing with reader vs link-out routing; curated resource list (§10.7)
- Native content reader: drawer + full-screen modes, FDA card renderer, paginated text
- Voice assistant → reader tap integration; reading position persistence
- Hands-free commute mode (auto-read + auto-listen)

**Phase 6: Offline mode + Service Worker (P1)**
- Offline question manager (`OfflineQuestionManager` class with bank consumption tracking)
- Service Worker app shell caching (§9.8.7) — production builds only
- End-to-end offline flow testing: bank → practice → sync on reconnect

---

## 15. Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | March 2026 | Initial draft |
| 1.1 | March 2026 | Voice assistant redesigned: full ContentDB grounding, closed-domain NCLEX-only scope, hands-free mode, source-cited responses, off-topic rejection |
| 1.2 | March 2026 | Voice assistant: student progress awareness, Socratic answer-withholding model, struggle detection, resource surfacing (YouTube/official), proactive coaching |
| 1.3 | March 2026 | Native content reader: context-sensitive placement (drawer/full-screen), ContentDB + external URL rendering, YouTube link-out only, voice assistant → reader integration, reading position persistence |
| 1.4 | March 2026 | Textbook sourcing: OpenRN and OpenStax downloaded by developer and pre-extracted as static JSON bundled with app — no runtime scraping, no CORS risk, no LibreTexts dependency. Reader app integration deferred to v6. |
| 1.5 | March 2026 | Standalone deployment: Kotlin + Spring Boot backend, Railway PostgreSQL, JWT auth, UserDB API wrapper, full backend section (§12), updated phases. localStorage for ContentDB corpus, PostgreSQL for all user data. |
| 1.6 | March 2026 | Drug list expanded to ~319 drugs across 21 categories. Static content layer added (§4.2). Security hardening: HttpOnly JWT cookie, typed proxy DTO, Bucket4j rate limiting, Jsoup sanitization, UUID flag IDs, token_version revocation, CSP/HSTS headers, URL allowlist, ownership checks, audit logging, bcrypt 72-byte fix. All 17 security findings addressed. |
| 1.7 | March 2026 | Strategies module fully researched against 2026 NCLEX-RN Test Plan: accurate CAT stopping rules (70-135 scored + 15 pilot), 2026 terminology changes, all 14 NGN question types, exam day Pearson VUE procedures, retake policy. Diagnostics module added: pre/post-procedure care for all high-yield procedures. Both added to STATIC_CONTENT_KEYS and §4.2 schema. |
| 1.8 | March 2026 | Health equity module added to STATIC_CONTENT (§4.2): SDOH 5 domains, 2026 NCLEX terminology updates, clinical application scenarios, OpenStax Jan 2026 alignment. content:health_equity key added to STATIC_CONTENT_KEYS. |
| 2.0 | March 2026 | AI-generated flashcards from rationales, Study Guides hub, drug suffix/prefix cheat sheet (content:drug_suffixes) added to STATIC_CONTENT_KEYS. TDD now has 11 static content keys. |
| 2.1 | March 2026 | PRD sync: per-option rationale spec in question schema (§6.1), ncjmmStep field added, spaced repetition scheduling (§9.5), readiness score algorithm (§9.6), timed exam mode fidelity spec (§9.7), PostgreSQL user_stats schema updated with ncjmm_step_scores/readiness_score/exam_date/spaced_rep_queue. |
| 2.2 | March 2026 | Offline mode full technical spec (§9.8): connectivity detection, 100-question pre-generated bank with weak-area weighting, offline question manager, pending sync queue with automatic flush, offline UI components, optional Service Worker app shell caching. |
| 2.3 | March 2026 | Playtester fixes: question_reports DB table + ReportsController + /api/reports + /api/health endpoints, readiness score minimum threshold (hasMinimumData), sync queue 500-cap + batch flush consolidation, offline bank once-per-day trigger, content:development and content:infection_control added to STATIC_CONTENT_KEYS. |
| 2.4 | March 2026 | Architecture fix: §13 rewritten as App Startup Flow with explicit returning session vs first-device setup code paths. Returning users take zero-indexing path (< 1 second). First-device setup Phase 1 (bundled content) and Phase 2 (background API) clearly separated. APP_VERSION as skip gate for forced re-setup on major content updates. |
| 2.5 | March 2026 | All playtester round-2 fixes: JWT bearer→HttpOnly cookie in §1 overview, duplicate question_reports table removed, open questions renumbered (1-11) and Mammoth closed, stale sign-off gap note removed, NCJMM two-step tag validation added to question generator (§6.1), student stats injection annotated in §10.3, implementation phases fully rewritten for v2.4 feature set (6 phases). |
| 2.6 | March 2026 | PRD+TDD cleanup: duplicate v2.3 and stale v1.6 entries removed from TDD version history, NGN clinical safety guardrail added to §7.1 generator prompt spec. PRD: ContentDB table deduplicated, duplicate module descriptions removed, exec summary fixed, §2.6/§2.7 ordering confirmed, v2.2 duplicate removed, email verification added to §7, study plan sign-off acceptance bar added. |
| 2.7 | March 2026 | Model string updated: claude-sonnet-4-20250514 → claude-sonnet-4-5-20250929 (Claude Sonnet 4.5 pinned snapshot, confirmed from Anthropic docs). |
| 2.8 | March 2026 | Model string updated to Claude Sonnet 4.6: claude-sonnet-4-5-20250929 → claude-sonnet-4-6-20260218 (released Feb 17 2026, confirmed from Anthropic docs). |
| 2.9 | March 2026 | Context window constraint added to §10.2 corpus loading: standard Sonnet 4.6 API tier = 200K token limit; full ContentDB (~500K tokens) exceeds this; excerpt approach is architectural necessity not optimization. |
| 3.0 | March 2026 | Storage architecture overhaul: three-layer model — IndexedDB for textbooks, localStorage for static/drug-summaries/flashcards (~500KB), PostgreSQL content_cache for FDA/MedlinePlus/RxNorm. ContentDB wrapper updated with three-store routing. content:drug_nclex:{drug} key added for NCLEX summaries (~130KB, localStorage). content_cache PostgreSQL table added (§12.2). /api/content/{key} endpoint added. Storage budget updated with real measurement (Nursing Fundamentals 2e = 1.9MB text / 470K tokens). |
| 3.1 | March 2026 | §12.6 added: 90-day content_cache batch refresh (@Scheduled Spring Boot job, daily 2am, re-fetches stale FDA/MedlinePlus/RxNorm entries) + quarterly textbook update email reminder (@Scheduled every 3 months). All cache TTLs unified to 90 days. SMTP env vars added to Railway config. |
| 3.2 | March 2026 | Roles and Admin Dashboard: role column on users table, is_active + last_active columns, audit_log table (persistent, queryable). AuditLogger updated to persist all events to DB. §9.4 Admin Dashboard spec: 5 tabs (Users CRUD/impersonate, KPIs, Report Queue, Audit Log, Content). AdminController added to project structure with full endpoint list. /api/admin/* endpoints in Phase 4. |
| 3.3 | March 2026 | Passkey / WebAuthn added: user_credentials table (§12.2), §12.5 full passkey spec (Spring Security native webAuthn(), JDBC persistence, frontend registration + conditional mediation login, HTTPS constraint, admin revoke endpoint). §12.4 updated to note coexistence. Phase 1 updated. |
| 3.4 | March 2026 | Account management + progress dashboard: deletion_scheduled_at on users, readiness_history table (daily snapshots), §12.6.2 daily snapshot job, §12.6.3 GDPR hard-delete job (30-day grace, cascades all personal data, anonymizes question_reports), AccountController + ProgressController added to project structure, /api/account/* + /api/progress/* endpoints, multi-device passkey clarification. |
| 3.5 | March 2026 | Playtester round-5 fixes: Phase 1 schema list now lists all 9 tables, deletion job wrapped in runCatching with per-user error handling + failure email alert (GDPR risk), anonymizeByUserId comment clarified (SET user_id = NULL, retain JSONB), version history deduplicated. |
| 3.6 | March 2026 | Round-6 playtester fixes: Phase 2 now includes AccountDB + ProgressDB wrappers and /settings + /progress route shells so Phase 5 only builds UI not API integration; variable name fix confirmed (failedIds consistent throughout). |
| 3.7 | March 2026 | Phase 3 corrected: government API indexing is developer deploy-time task not student-side background indexing. §4.1 BUNDLED_CONTENT schema labeled as authoritative definition for PRD Q2. |
| 3.7 | March 2026 | SA optimizations: architecture diagram updated to three-layer ContentDB model, HikariCP pool sizing added (max 5, Railway hobby tier safe), Caffeine in-process cache added for content_cache endpoint (§12.6.4, 1-hour TTL, 500-key max), DB migration strategy documented (schema.sql for v5, Flyway at v6 boundary), CacheConfig.kt added to project structure. |
| 3.8 | March 2026 | SA review — 9 findings fixed: IDB connection caching + setBatch() (F1), content_cache indexed_at index (F2), 401 multi-device authedFetch() handler (F3), readiness_history TIMESTAMPTZ (F4), HikariCP pool 5→20 (F5), /api/progress/summary single-query spec (F6), offline bank lastGenerated→PostgreSQL (F7), audit_log partial index + 90-day archival job §12.6.4 (F8), BUNDLED_CONTENT lazy-loaded static asset (F9). |
| 3.8 | March 2026 | Security review: CRITICAL-1 JWT uses BASE64 decode (256-bit enforced), CRITICAL-2 admin self-demotion guard, CRITICAL-3 cancel-deletion uses signed JWT. HIGH-1 CSRF config, HIGH-2 context allowlisted, HIGH-3 password-change rate limited, HIGH-4 hard-delete confirmation token. MEDIUM-1 is_active in JWT filter, MEDIUM-2 IP-keyed rate limiter, MEDIUM-3 GDPR email purge from audit log. LOW-1 display_name column, LOW-2 Actuator restricted. |
| 3.9 | March 2026 | Security review — 10 findings fixed: StatsRequest size caps + 512KB request limit (SEC-1), Caffeine-backed rate limiter replacing ConcurrentHashMap (SEC-2), passkey endpoint rate limiting (SEC-3), CORS startup assertion (SEC-4), cancelDeletion() expiry check (SEC-5), impersonation 15-min timeout + 3/day rate limit (SEC-6), bundled-content.json SHA-256 integrity check (SEC-7), Permissions-Policy header microphone=(self) (SEC-8), JWT rotation procedure (SEC-9), X-Content-Type-Options confirmation (SEC-10). |
| 4.0 | March 2026 | §13.1 Companion Documents section added: links to Test Strategy v1.1, Logging Strategy v1.0, Error Handling Strategy v1.0. SA annotations on test strategy: IDB setBatch atomicity test, Testcontainers version pin, SERIALIZABLE isolation for concurrency test, golden-set CI gate, performance tier assumption. |
| 4.1 | March 2026 | Spring AI 1.1 LLM abstraction: §12.3 replaced ClaudeProxyController with LlmController + LlmService + LlmProviderConfig + PromptRegistry. Provider selected by LLM_PROVIDER env var (anthropic/openai/ollama). Per-provider prompt variants in resources/prompts/{variant}/. Frontend /api/claude path unchanged. LiteLLM sidecar pattern documented for local model support. CONTRIBUTING_LLM_PROVIDER.md process defined. LLM_PROVIDER + LLM_PROMPT_VARIANT env vars added to §12.9. |
| 4.2 | March 2026 | §11.10 Library tab: dedicated OpenRN textbook browser with Read online + Download EPUB + Download PDF per book. §11.11 EPUB/PDF download via browser <a download> to device Downloads folder — no internal storage. OPENRN_BOOKS config with Pressbooks + NCBI URLs for all 6 books. |
---

*This document was written in response to the PRD authored by the Product Manager. Technical decisions reflect constraints of the standalone web app runtime environment and the `localStorage` persistent API.*