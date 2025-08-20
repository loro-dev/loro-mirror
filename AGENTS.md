# Repository Guidelines

## Project Structure & Module Organization

- packages/core: TypeScript core logic (state, diff, schema). Entry at `src/index.ts`; implementation in `src/core/*` and `src/schema/*`. Tests under `packages/core/tests/**` with snapshots in `__snapshots__/`.
- packages/react: React bindings and hooks (`src/index.ts`, `src/hooks.tsx`). Tests (when present) live under `packages/react/tests/**`.
- Root: Workspace config (`pnpm-workspace.yaml`), TypeScript config (`tsconfig.json`), linting (`.eslintrc.js`), formatting (`.prettierrc`), and monorepo scripts in root `package.json`.

## Build, Test, and Development Commands

- Install: `pnpm install` (at repo root).
- Build all: `pnpm build` (runs `rollup -c` in each package).
- Test all: `pnpm test` (Vitest across packages).
- Lint all: `pnpm lint` (ESLint on `src` in each package).
- Type check: `pnpm typecheck` (TS `--noEmit`).
- Per-package examples:
  - Core build: `pnpm --filter @loro-mirror/core build`
  - React tests (watch): `pnpm --filter @loro-mirror/react test:watch`

## Coding Style & Naming Conventions

- Language: TypeScript (strict). React files use `.tsx`.
- Formatting: Prettier (tabWidth 4). Keep imports ordered logically and avoid unused vars (underscore- prefix is ignored by lint).
- Linting: ESLint with `@typescript-eslint`, `react`, and `react-hooks`. Run `pnpm lint` before pushing.
- Structure: Export public APIs from each package’s `src/index.ts`. Keep tests mirroring source folder layout.

## Testing Guidelines

- Framework: Vitest. Core runs in `node` env; React in `jsdom`.
- Location: `packages/*/tests/**`. Filenames: `*.test.ts` or `*.test.tsx`.
- Scope: Add unit tests for new logic and update snapshots when behavior changes intentionally.
- Run: `pnpm --filter <pkg> test` or `test:watch` for TDD.

## Commit & Pull Request Guidelines

- Commits: Use Conventional Commit style (e.g., `feat(core): ...`, `fix(mirror): ...`, `chore: ...`). Reference issues/PRs when relevant (e.g., `(#12)`).
- PRs: Include a clear description, linked issues, test coverage for changes, and any relevant before/after notes or screenshots. Ensure `pnpm build && pnpm test && pnpm lint && pnpm typecheck` pass.

## Security & Configuration Tips

- Peer deps: Keep `loro-crdt` versions aligned with peer requirements.
- Node/Tooling: Use Node 18+ and pnpm. Do not commit `dist/`; builds are produced by Rollup during release or CI.

