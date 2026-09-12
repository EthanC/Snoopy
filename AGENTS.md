# Snoopy Agent Guidance

## Mission And Map

Snoopy is a headless TypeScript Devvit moderator app forwarding watched Reddit
activity to Discord. `src/index.ts` mounts the internal Hono routes.
`src/routes/` handles native menus/forms, scheduling, and lifecycle events;
`src/core/` owns domain logic, integrations, and Redis persistence. There is no
WebView, Discord bot, or separately hosted backend.

## Non-Negotiables

- Keep server-side `requireModerator` checks on menu/form handlers before watch
  access. Reuse `parseWatchInput` and webhook verification at submission boundaries.
- Keep watch configuration, cursors, and processed IDs in installation-scoped
  Devvit Redis. Reddit titles and bodies are not persisted there.

## Don'ts

- Never put real webhook URLs in source, tests, logs, or reports.
  `src/core/logger.ts` serializes supplied fields without automatic redaction.
- Do not reset baselines for ordinary filter, interval, or webhook edits.
  Re-enabled notifications and newly enabled activity types need fresh baselines.
- Do not assume Discord delivery and Redis checkpointing are atomic; duplicate
  delivery remains possible.
- Do not infer current setup from Git HEAD's Python/uv/Docker implementation.
  The working tree contains the uncommitted TypeScript migration.

## Quick Start

Use Node from `.nvmrc` (26.8.2); `package.json` permits Node 24+. CI pins npm 12.0.2.

```sh
npm ci
npm run check
```

Authenticated playtest: `npm run login`, then `npm run dev`. `npm run deploy`
uploads; `npm run launch` publishes. README release warnings remain unresolved.

## Change Routing

- Menus/forms: `devvit.json`, `src/routes/menu.ts`, `src/routes/forms.ts`,
  `src/core/forms.ts`, `src/core/validation.ts`, `src/core/configuration.ts`.
- Polling/state: `src/core/poller.ts`, `src/core/reddit-history.ts`,
  `src/core/cursor.ts`, `src/core/storage.ts`, `src/core/types.ts`.
- Discord payloads and HTTP results: `src/core/discord.ts` and its colocated tests.

## Architecture Rules

- Keep manifest endpoints aligned with route registration. Scheduled tasks are
  declared in `devvit.json`; install/upgrade handlers currently only acknowledge/log.
- Preserve configuration-then-user mutation lock ordering, revision checks,
  and independent post/comment timestamp-plus-ID cursors.
- Respect the bounds in `src/core/types.ts` and `src/core/poller.ts`: ten watches,
  twenty unseen activities per user, and a 20-second polling budget. A deadline
  does not mean every underlying RPC has been cancelled.
- Preserve Discord Components V2, disabled mentions, the shared 4,000-character
  text budget, confirmed sends with `wait=true`, and retry/blocked/discard outcomes,
  including Discord's rate-limit delay.

## Implementation Conventions

Use ESM and type-only imports. Keep explicit `.ts` runtime imports where tests
load modules directly. Follow strict `tsconfig.json`, ESLint's floating-promise
checks, and `.prettierrc`: single quotes, ES5 trailing commas, preserved property
quoting. Reuse the existing core helpers.

## Testing And Validation

Add colocated `*.test.ts` checks using `node:test` and strict Node assertions;
Discord tests inject fetch. `npm run check` runs types, lint, unit tests, and build.
Existing automated coverage is helper-level, not a Devvit integration test.

## Common Changes

A watch-setting change spans domain types, native forms, parsing, baseline/revision
handling, and tests. Extend existing payload/HTTP-result tests for delivery changes.

## Free Region

## Further Context

[AGENTS.reference.md](AGENTS.reference.md) records evidence, provenance, and uncertainty.

---

> Generated and maintained by [Agentskill](https://github.com/airscripts/agentskill).
> Do not touch this file. It is automatically managed by Agentskill.
