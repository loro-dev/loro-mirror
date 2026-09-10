# Repository Guidelines

## Project Structure & Module Organization

- packages/core: TypeScript core logic (state, diff, schema). Entry at `src/index.ts`; implementation in `src/core/*` and `src/schema/*`. Tests under `packages/core/tests/**` with snapshots in `__snapshots__/`.
- packages/react: React bindings and hooks (`src/index.ts`, `src/hooks.tsx`). Tests (when present) live under `packages/react/tests/**`.
- Root: Workspace config (`pnpm-workspace.yaml`), TypeScript config (`tsconfig.json`), linting (`.eslintrc.js`), formatting (`.prettierrc`), and monorepo scripts in root `package.json`.

## Build, Test, and Development Commands

- Install: `pnpm install` (at repo root).
- Build all: `pnpm build` (runs `tsc -p .` in each package).
- Test all: `pnpm test` (Vitest across packages).
- Lint all: `pnpm lint` (ESLint on `src` in each package).
- Type check: `pnpm typecheck` (TS `--noEmit`).

## Coding Style & Naming Conventions

- Language: TypeScript (strict). React files use `.tsx`.
- Formatting: Prettier (tabWidth 4). Keep imports ordered logically and avoid unused vars (underscore- prefix is ignored by lint).
- Linting: ESLint with `@typescript-eslint`, `react`, and `react-hooks`. Run `pnpm lint` before pushing.
- Structure: Export public APIs from each package’s `src/index.ts`. Keep tests mirroring source folder layout.
- Do not use 'any' type in typescript

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
- Node/Tooling: Use Node 18+ and pnpm. Do not commit `dist/`; builds are produced by TypeScript (tsc).

## Public API (loro-mirror)

- `Mirror(options: MirrorOptions<S>)`
    - `doc` (required), `schema?`, `initialState?`, `validateUpdates?`, `ignoreUnknownProperties?`, `debug?`, `checkStateConsistency?`, `inferOptions?`.
    - Methods: `getState()`, `setState(updater, options?)`, `subscribe(cb)`, `dispose()`, `checkStateConsistency()`, `getContainerIds()`, `list<T>(path)` (returns a `LazyListWriter<T>` with `push`/`insert`/`deleteById`/`updateById`/`updateAt` for schema-declared lazy lists).
    - `SetStateOptions` supports `{ tags?: string | string[] }`; subscriber metadata includes `{ source: UpdateSource; tags?: string[] }`.
- `schema(definition, options?)` plus builders: `.String()`, `.Number()`, `.Boolean()`, `.Ignore()`, `.LoroMap()`, `.LoroMapRecord()`, `.LoroList()`, `.LoroMovableList()`, `.LoroText()`, `.LoroTree()`.
    - `schema.LoroList(item, idSelector?, options?)` accepts `options.lazy: LazyListOptions` (`{ index: string[]; maxHydrated?: number; tailKeep?: number }`). A lazy list is not read into state at init; `getState()` exposes a `LazyList<T, I>` (length/version/ids/indexOf/index/get/slice/isHydrated/hydrate/release/subscribeRange), `setState` touching a lazy path throws `LazyListWriteError`, and writes go through `mirror.list(path)`. When all schema roots are lazy lists, init uses shallow reads only (no full-document deep read).
- Runtime helpers from the schema module: `validateSchema`, `getDefaultValue`, `createValueFromSchema`, and type guards such as `isContainerSchema`, `isLoroMapSchema`, `isLoroListSchema`, `isLoroMovableListSchema`, `isLoroTextSchema`, `isLoroTreeSchema`, `isRootSchemaType`, `isListLikeSchema`, `isLazyListSchema`, `schemaContainsLazyList`. Value helpers from core: `isLazyList` (brand check, brand is `Symbol.for("loro-mirror.lazyList")`), `LazyListImpl`, `LazyListWriteError`.
- Types re-exported at the root: `MirrorOptions`, `SetStateOptions`, `UpdateMetadata`, `InferType`, `InferInputType`, `InferContainerOptions`, `SchemaType`, `ContainerSchemaType`, `RootSchemaType`, `LoroMapSchema`, `LoroListSchema`, `LoroMovableListSchema`, `LoroTextSchemaType`, `LoroTreeSchema`, `SchemaOptions`, `LazyList`, `LazyListOptions`, `LazyListWriter`, `ChangeKinds`, `MapChangeKinds`, `ListChangeKinds`, `MovableListChangeKinds`, `TreeChangeKinds`, `TextChangeKinds`, `SubscriberCallback`, `UpdateSource`. For a lazy list, `InferType` is `LazyList<Item, Partial<Item>>` and `InferInputType` is the same `LazyList` type (arrays are rejected at the type level; seed via `mirror.list(path)`).
- Utilities: `toNormalizedJson(doc)` for tree normalization. `$cid` is a reserved property injected into mirrored map values but there is no exported constant.

Bulk initialization prefers optional `LoroDoc.toContainerTree()` when available. Its
`Value` nodes are opaque, including embedded objects with `type/cid/value` fields.
Carry the format flag in each walk context; never infer it from child value shape.
Older packages continue through verified deep-value or handle reads. Typed trees read node data through the schema-aware container reader; untyped trees
retain JSON normalization. Tests must disable both bulk APIs when
explicitly comparing with the legacy handle path.
The container-tree path selects required roots before materialization, excluding
explicit Ignore roots. Preserve unknown roots according to ignoreUnknownProperties.

Lazy hydration uses the published container.toContainerTree API for ordinary item
subtrees. Roots/items containing nested lazy lists retain shallow traversal so
unrequested descendants stay unread; mixed schemas exclude those roots from
the document bulk read. Never feed structured Value nodes to the legacy index parser.

Root schema fields may be Ignore (RootFieldSchemaType); Ignore events are filtered before registration and lazy handling.
Consistency checks preserve nested Ignore memory values and still check normal siblings.

Lazy item event recursion stops at an already-handled list boundary; never route
that item's events back to an outer lazy list. `subscribeRange` remains half-open.
`subscribeLength` observes length without retaining items; React range readers
subscribe to both so a tail window can advance after an append.
Lazy writer insertions cache the schema-decoded document read, not the input
object (nested lists must already be LazyList views). Structural deletion or
replacement clears unreachable lazy-list state using final container liveness;
ordinary text/scalar events do not scan all lazy lists. Undo may create a fresh
view for a restored subtree; stale deleted views must remain empty.
Consistency checks exclude Ignore values and their container identities at nested
schema paths as well as roots; document changes to Ignore must not make later
normal setState calls fail. Normal sibling values and identities remain checked.

Tree consistency comparison applies nodeSchema to each node.data and the tree schema to children; wrapper fields are not node data. Ignore projection must not suppress comparison of ordinary tree fields.

When container-tree reading hits Loro's nesting limit, fall back to per-container reads. Other read or schema/decode errors must propagate unchanged.

Lazy slots preserve container provenance from real handles independently of their
id strings. A literal string, including one equal to a live container id, stays
opaque. Resolve ambiguous shallow map fields through map.get(field), not by
looking up the string as an id elsewhere in the document.

Nested Ignore fields are omitted on initial reads and filtered inside parent Map
diffs as well as container-targeted events; mixed batches retain normal fields.
Lazy write guards traverse eager lists, map records and tree data, matching
surviving list items by container ID and tree nodes by node ID across reordering.
Typed tree reads must not materialize nested lazy bodies through toJSON.
New list rows without a container ID are insertions, never positional matches
for lazy-view write guards. Newly initialized map fields declared lazy must
publish LazyList views after their document containers have been created.
