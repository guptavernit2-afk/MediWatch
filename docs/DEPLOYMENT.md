# Running and deploying MediWatch

## Local development

Use Python 3.11 or newer and install `requirements.txt` inside a virtual environment. From the repository root:

```bash
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open [http://localhost:8000](http://localhost:8000). The default SQLite database is `data/mediwatch.db`; its directory is created automatically. Keep that directory if you want records to survive application restarts.

Copy `.env.example` to `.env` to customize configuration. `.env` is ignored by Git. Settings are read at application creation; restart the server after changing them.

| Variable              | Default                                  | Purpose                                                                  |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `DEMO_MODE`           | `true`                                   | Seed fictional patients and run background simulated readings            |
| `MEDIWATCH_DB_PATH`   | `data/mediwatch.db` under the repository | SQLite storage path                                                      |
| `MEDIWATCH_API_TOKEN` | Empty                                    | Required Bearer token when demo mode is disabled                         |
| `GROQ_API_KEY`        | Empty                                    | Optional provider access for explicitly requested summaries              |
| `GROQ_MODEL`          | `llama-3.1-8b-instant`                   | Provider model identifier; availability depends on your provider account |

No model access is required for the main application. Without a key, summaries use local rules.

## Docker

Build and run from the repository root:

```bash
docker build -t mediwatch-ai .
docker run --name mediwatch --rm -p 8000:8000 -v mediwatch-data:/data mediwatch-ai
```

The image runs as an unprivileged user and stores its database in `/data`. A named volume preserves that data when the container is replaced. The health check reads `/api/health`. The container accepts `PORT`, defaulting to `8000`, and starts one worker.

The container serves the application directly and does not need Node.js. Playwright and Node.js are development-only tools used outside the runtime image for automated UI verification.

Optional provider access can be passed through your deployment's secret environment configuration. Do not bake keys or `.env` files into the image. The `.dockerignore` excludes local databases, environment files, caches, and test artifacts.

## Hosted Python service, including an existing Render service

Configure the service to use the repository's `main` branch and the repository root:

```text
Build command: python -m pip install -r requirements.txt
Start command: python -m uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1
Health check: /api/health
```

Set `DEMO_MODE=true` for a public portfolio demo. If the host does not supply `PORT`, use your configured port value instead.

For durable records, attach a persistent volume, make sure the application user can write to it, and set `MEDIWATCH_DB_PATH` to an absolute path on that volume, such as `/var/data/mediwatch.db`. Host plans differ in persistent-disk support; review your selected service before relying on persistence. Without a volume, redeployments or host restarts may discard the workspace.

For an existing service that auto-deploys from GitHub, a push can trigger its configured deployment. Verify the service's deployment logs and health check afterward. This repository's CI verifies source; it does not provision hosting, attach disks, or guarantee that an existing live URL has updated.

## Authenticated API exploration

To run without fictional seeds or simulation:

1. Use a new database path so existing demo records do not become confused with imported data.
2. Set `DEMO_MODE=false`.
3. Configure a long, random `MEDIWATCH_API_TOKEN` in your local environment or host secret manager.
4. Send `Authorization: Bearer <token>` with protected API requests.

Generate a token locally with Python:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep it private. A shared token is a basic access boundary for development, not a substitute for per-user authentication, role authorization, or a compliance assessment.

## Operational notes

- Use HTTPS through the hosting provider or reverse proxy.
- Run one worker for a demo deployment so only one background simulation loop writes readings.
- Preserve and back up the persistent database through a consistent SQLite backup process. Copying an active `.db` without its journal is not a reliable backup method.
- Never commit databases, raw exports, credentials, or real patient information.
- Confirm any external-provider data processing arrangement before enabling summaries for sensitive data.
- The application is an educational prototype; it is not approved for real patient monitoring.
