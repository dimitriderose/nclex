# Deploying NCLEX Trainer v5

This guide covers deploying to [Railway](https://railway.app), but the Docker setup works anywhere that runs containers.

## Quick Start (Railway)

### 1. Create a Railway project

Sign up at [railway.app](https://railway.app) and create a new project.

### 2. Add a PostgreSQL database

Click **"New" > "Database" > "PostgreSQL"**. Railway will auto-provision the database and inject connection environment variables.

### 3. Deploy the backend

Click **"New" > "GitHub Repo"** and select your fork of this repo.

Configure the service:

- **Root Directory:** `backend`
- **Build Command:** (leave empty; Dockerfile handles it)
- **Dockerfile Path:** `backend/Dockerfile`

Add these environment variables in the Railway dashboard:

| Variable | Value | Notes |
|----------|-------|-------|
| `JWT_SECRET` | (random 48+ char string) | Generate with `openssl rand -base64 48` |
| `CLAUDE_API_KEY` | `sk-ant-...` | From [console.anthropic.com](https://console.anthropic.com) |
| `SPRING_DATASOURCE_URL` | (auto from Railway PostgreSQL) | Railway injects this as `DATABASE_URL` |
| `SPRING_PROFILES_ACTIVE` | `prod` | |
| `PORT` | `8080` | Railway uses this |

Railway auto-injects `DATABASE_URL` from the PostgreSQL plugin. If you need to map it to Spring's format, add a start command or use the Railway variable reference: `jdbc:postgresql://${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`.

### 4. Deploy the frontend

Add another service from the same GitHub repo:

- **Root Directory:** `frontend`
- **Dockerfile Path:** `frontend/Dockerfile`

The frontend's nginx config proxies `/api/` requests to the backend. In Railway, set the backend's internal hostname:

| Variable | Value |
|----------|-------|
| `BACKEND_URL` | `http://backend.railway.internal:8080` |

Update `nginx.conf`'s `proxy_pass` to use `$BACKEND_URL` if needed, or use Railway's service networking.

### 5. Set up a custom domain (optional)

In Railway, go to your frontend service > **Settings > Networking > Custom Domain** and add your domain.

## Local Development (Docker Compose)

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env with your CLAUDE_API_KEY

# 2. Start everything
docker compose up --build

# 3. Access the app
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080
# Database: localhost:5432
```

To stop: `docker compose down`

To reset the database: `docker compose down -v` (removes the volume)

## Health Check

The backend exposes a health endpoint:

```bash
curl http://localhost:8080/api/health
```

Returns `200` when healthy, `503` when degraded (e.g., database down).

## Environment Variables Reference

See `.env.example` for all available variables with descriptions.

## Troubleshooting

**Backend won't start:** Check that `SPRING_DATASOURCE_URL` points to a running PostgreSQL instance and the credentials are correct.

**Frontend shows blank page:** Make sure the backend is running and the nginx `proxy_pass` can reach it.

**Claude API errors:** Verify your `CLAUDE_API_KEY` is valid and has sufficient credits.

**Database migrations fail:** Flyway runs automatically on startup. Check the backend logs for migration errors. You can manually run migrations by connecting to the database and checking the `flyway_schema_history` table.
