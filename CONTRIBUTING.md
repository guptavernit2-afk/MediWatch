# Contributing

MediWatch is an educational monitoring application. Contributions should improve a real workflow while keeping the demo easy to run without accounts or external services.

1. Create a focused branch from `main`.
2. Follow the setup instructions in [README.md](README.md).
3. Keep backend code in `mediwatch/`, browser assets in `web/`, and regression tests in `tests/`.
4. Run `python -m pytest -q`, Python compilation, `npm test`, and `npm run check` before opening a pull request. Run `npm ci` once to install development-only test tooling. For workflow changes, run `npm run test:e2e` after installing Chromium with `npx playwright install chromium`.
5. Describe the user-visible change, the reason for it, and the checks you ran. Include screenshots for material visual changes when available.

Use fictional data in examples, screenshots, issues, and test fixtures. Never commit keys, `.env` files, database files, exports, or real patient information.

GET endpoints must remain free of data changes. Monitoring rules must be transparent and labeled as illustrative. AI features must continue to work without credentials through a deterministic fallback, and external calls must not be made as part of routine dashboard polling.

Avoid adding a frontend build system or large dependencies unless the feature needs them. Match the existing responsive design, visible focus states, semantic labels, and reduced-motion support.

The repository does not currently declare an open-source license. Obtain the repository owner's permission before redistributing the code under a new license.
