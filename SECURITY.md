# Security

MediWatch is a demonstration application. Public demo mode permits fictional patient data to be viewed and edited without authentication. Do not store real patient information in demo mode or expose an unprotected database.

For a suspected vulnerability, use GitHub's private vulnerability reporting if it is enabled for this repository. If it is unavailable, contact the repository owner through their GitHub profile before publishing exploit details. Do not put credentials, sensitive records, or a working exploit against a live service in a public issue.

For deployments:

- Keep `.env`, API tokens, and databases outside source control.
- Use HTTPS at the reverse proxy and protect access to persistent storage and backups.
- Set `DEMO_MODE=false` and configure a strong `MEDIWATCH_API_TOKEN` for authenticated API exploration. A shared token is not a replacement for per-user authentication or authorization.
- Configure optional AI access only after understanding that submitted vitals will be processed by an external provider. The application excludes direct identifiers, but that alone is not a compliance guarantee.
- Follow the [deployment guide](docs/DEPLOYMENT.md) and review current dependencies before exposing the application.

The project makes no claim of medical-device validation, regulatory compliance, or suitability for real patient monitoring.
