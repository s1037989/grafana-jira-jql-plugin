# Delivery validation

Validated on 2026-10-05 using Node.js and the pinned Grafana 12.4.0 npm libraries.

- `npm test`: 25 tests passed across two suites, with actual Grafana data-frame utilities and mocked HTTP transport.
- `npm run typecheck`: strict TypeScript compilation passed.
- `npm run build`: production AMD bundle built successfully.
- `scripts/verify-build.cjs`: the compiled AMD module loads with its expected external dependencies and registers the data source, configuration editor, and query editor.
- Install package structure checked for module.js, plugin.json, logo, README, and license.

Covered behavior: JQL POST JSON encoding; both Jira pagination protocols; reduced final page sizes; issue/page limits and warnings; zero results; malformed responses; pagination loop protection; nested and custom fields; numeric/boolean/time mapping; raw JSON response preservation; per-target errors; hidden targets; scoped-variable formatter handling; cancellation of in-flight fetches; health checks; and absence of Jira credentials in frontend HTTP request headers.

Not performed: launching a Grafana server, testing against a live Jira instance, validating private CA certificates, plugin signing, or production deployment. The supplied Docker Compose setup and README provide the local integration workflow. The plugin is unsigned and has no server-side alerting implementation.
