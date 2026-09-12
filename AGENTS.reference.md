# Snoopy Guidance Reference

## Provenance And Decisions

- Agentskill version: `2.1.0`. Evidence schema version: `4`.
- Workflow: `init`; selected scope: `.` (root, no parent); budget: `deep`.
- Repository revision: `afd6e196519c99c807a23367a463fbfa463819ad`.
  Dirty working tree: TypeScript source, tests, manifests, and CI are untracked;
  Python/uv/Docker files are deleted. History describes the predecessor.
- Configuration: source `default`; no `agentskill.toml` found. Signature mode:
  `auto`, resolved enabled (`configuration.signature`).
- Maintainer-Confirmed Decisions: root-only initialization from repository evidence,
  not prior AGENTS content; deep budget. Discovery found no existing guidance or
  Free Region. No child scopes or legacy documents were adopted.
- Unresolved uncertainty: live-platform behavior, release approval, and absent
  policy documents. Details below; no extra maintainer conventions were supplied.

## Evidence Map

`source.*` IDs denote verified direct inspection, not CLI-emitted facts.

- `source.runtime`: `package.json`, `.nvmrc`, `.github/workflows/ci.yaml`,
  `vite.config.ts`, `devvit.json`, `src/index.ts`, `src/routes/triggers.ts`.
  Commands, runtime, routing, build, and scheduling. CLI fact: `language.typescript`.
- `source.authorization`: `src/core/authorization.ts`, `src/core/validation.ts`,
  `src/routes/menu.ts`, `src/routes/forms.ts`, `src/core/forms.ts`.
  Moderator gates, canonical webhook URLs, and submission handling.
- `source.state`: `src/core/storage.ts`, `src/core/configuration.ts`,
  `src/core/cursor.ts`, `src/core/poller.ts`, `src/core/reddit-history.ts`,
  `src/core/types.ts`. Locks, revisions, separate cursors, baseline transitions,
  polling limits, and Redis data shape.
- `source.delivery`: `src/core/discord.ts`, `src/core/discord.test.ts`,
  `src/core/logger.ts`, `README.md`. Payload safeguards, HTTP outcomes, secret
  handling, and caller-owned log redaction.
- `source.style`: `tsconfig.json`, `eslint.config.js`, `.prettierrc`,
  `src/core/cursor.test.ts`. Imports, strictness, promises, formatting. CLI IDs:
  `tool.typescript.type_checker`, `tool.typescript.linter`,
  `tool.typescript.formatter`.
- `source.tests`: `package.json`, `src/core/configuration.test.ts`,
  `src/core/cursor.test.ts`, `src/core/discord.test.ts`,
  `src/core/validation.test.ts`. Scripts/imports prove Node's test runner;
  `test.representative.typescript` incorrectly says Jest. That inference and
  bundled `.agents/` skill content were excluded from application conventions.

## Validation And Limits

`npm run check` passed during initialization on Node 26.8.2/npm 12.0.2: TypeScript,
ESLint, 27 unit tests, and Vite build. No login, live playtest, upload, or publish
was performed.

No dedicated poller, Redis, Reddit-history, authorization, or route tests exist.
Live lock/transaction behavior and listing order remain unverified. Leases expire
without renewal; separate delivery/checkpoint operations permit duplicates.

`README.md:9-11` records surveillance/deletion-policy concerns, Fetch approval
requirements, and links to absent Terms of Service/Privacy Policy drafts. Review
approval and policy compliance were not independently verified. CI tests Node 26,
not the full declared Node 24+ range.

No commit-prefix or merge-strategy rule was established. Agentskill version
controls freshness; revision changes alone do not make guidance stale.

## Free Region

---

> Generated and maintained by [Agentskill](https://github.com/airscripts/agentskill).
> Do not touch this file. It is automatically managed by Agentskill.
