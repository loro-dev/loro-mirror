## React Todo List (Vite)

Lightweight example showing how to use `loro-mirror` and `loro-mirror-react` in a React app with Vite.

### Scripts

- `pnpm dev` – runs the app with Vite. Prebuilds local `loro-mirror` packages.
- `pnpm app:build` – builds the app with Vite (manual usage).
- `pnpm preview` – serves the production build (requires a prior `app:build`).

### Run locally

From the repo root (ensure workspace deps are installed), then:

```
pnpm --filter loro-mirror-monorepo install
pnpm --filter loro-mirror --filter loro-mirror-react build
pnpm --filter loro-mirror-example-react-todo-list dev
```

Or from within this folder:

```
pnpm install
pnpm dev
```

Note: The `predev` step builds workspace packages `loro-mirror` and `loro-mirror-react` to ensure their `dist` outputs exist for Vite to resolve.

