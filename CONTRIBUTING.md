# Contributing to NCLEX Trainer v5

Thank you for your interest in contributing! This project benefits from both technical and non-technical contributions.

## For Everyone (No Coding Required)

### Report a Clinical Inaccuracy

If you find a question with incorrect medical information, please open an issue using the **Clinical Inaccuracy** template. Include the question text, what's wrong, and a citation if possible.

### Suggest Drug List Edits

The drug reference list lives in the content cache and is refreshed from FDA/MedlinePlus/RxNorm. If you notice a missing or incorrect drug:

1. Open an issue with the title "Drug list: [drug name]"
2. Describe what's missing or incorrect
3. Include the drug's generic name, brand name, and drug class

### Report a Bug

Use the **Bug Report** issue template. Include steps to reproduce, what you expected, and what actually happened.

### Suggest a Feature

Use the **Feature Request** issue template. Describe the problem you're trying to solve and your ideal solution.

## For Developers

### Getting Started

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/nclex.git
cd nclex

# Start the dev environment
cp .env.example .env
# Add your CLAUDE_API_KEY to .env
docker compose up --build
```

The frontend runs at `http://localhost:3000` and the backend at `http://localhost:8080`.

### Project Conventions

**Backend (Kotlin/Spring Boot):**

- Package structure: `com.nclex.<feature>/` (e.g., `com.nclex.exam/`)
- Each feature has its own Controller, Service, and DTOs
- Use `runCatching` for error handling
- Log via SLF4J (`LoggerFactory.getLogger(javaClass)`)
- Write audit events through `AuditLogger`

**Frontend (React/TypeScript):**

- Components in `frontend/src/components/`
- Pages in `frontend/src/pages/`
- API services in `frontend/src/services/`
- Types in `frontend/src/types/`
- CSS alongside components (e.g., `ExamSimulation.css` next to `ExamSimulation.tsx`)

### Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Test locally with `docker compose up --build`
4. Push and open a PR against `main`
5. Describe what you changed and why

### Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.
