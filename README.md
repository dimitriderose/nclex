# NCLEX Trainer v5

An AI-powered study tool for the NCLEX-RN nursing licensure exam. Built with Kotlin/Spring Boot, React/TypeScript, and Claude AI.

## What It Does

NCLEX Trainer generates practice questions tailored to the 2026 NCLEX-RN test plan, tracks your readiness, and adapts to your weak areas.

- **Adaptive question generation** — Claude AI creates clinically accurate questions across all 8 NCLEX client needs categories
- **Next Generation NCLEX (NGN) case studies** — Practice the clinical judgment scenarios that make up a growing portion of the exam
- **CAT exam simulation** — 75–145 question timed exam that mirrors the real computerized adaptive testing algorithm
- **Readiness score** — Weighted by the official NCLEX-RN test plan percentages so you know where you stand
- **Spaced repetition** — Missed questions come back at optimal intervals
- **Drug reference** — Integrated FDA labels, MedlinePlus, and RxNorm data for pharmacology review
- **Offline mode** — Study without internet; syncs when you reconnect
- **Voice assistant** — Hands-free question practice

## Who It's For

- Nursing students preparing for the NCLEX-RN
- Nursing educators looking for an adaptive practice tool
- International nurses preparing for US licensure

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Kotlin, Spring Boot 3.3, PostgreSQL, Flyway |
| Frontend | React 18, TypeScript, Vite |
| AI | Claude API (Anthropic) |
| Auth | JWT + HTTP-only cookies |
| Deployment | Docker, Railway |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A Claude API key from [console.anthropic.com](https://console.anthropic.com)

### Run locally

```bash
git clone https://github.com/dimitriderose/nclex.git
cd nclex
cp .env.example .env
# Edit .env and add your CLAUDE_API_KEY
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) to start studying.

### Deploy Your Own

See [DEPLOY.md](DEPLOY.md) for step-by-step Railway deployment instructions.

## Project Structure

```
nclex/
├── backend/           # Kotlin/Spring Boot API
│   ├── src/main/kotlin/com/nclex/
│   │   ├── admin/     # Admin dashboard
│   │   ├── audit/     # Audit logging
│   │   ├── exam/      # CAT exam simulation
│   │   ├── health/    # Health checks
│   │   ├── model/     # JPA entities
│   │   ├── ngn/       # NGN case studies
│   │   ├── question/  # Question generation
│   │   ├── scheduled/ # Cron jobs
│   │   ├── stats/     # Readiness scoring
│   │   └── repository/
│   ├── Dockerfile
│   └── build.gradle.kts
├── frontend/          # React/TypeScript SPA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── types/
│   ├── Dockerfile
│   └── nginx.conf
├── docs/              # PRD, security assessment, test strategy
├── docker-compose.yml
├── DEPLOY.md
└── .env.example
```

## Contributing

We welcome contributions from developers, nursing students, and educators. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Want to add a new AI provider (OpenAI, Gemini, etc.)? See [CONTRIBUTING_LLM_PROVIDER.md](CONTRIBUTING_LLM_PROVIDER.md).

## Content Licensing

Educational content (OpenRN, OpenStax references, drug lists) is licensed under CC-BY 4.0. See [CONTENT_LICENSE.md](CONTENT_LICENSE.md).

The application code is licensed under MIT. See [LICENSE](LICENSE).

## Security

Found a vulnerability? Please report it responsibly. See [SECURITY.md](SECURITY.md).
