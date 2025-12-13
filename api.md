# Loro Mirror — API Reference

This is the complete API reference for the `loro-mirror` package. It covers the public classes, functions, types, and utilities exported from the package entry and includes practical tips for effective usage.

Contents

- Installation & Imports
- Core: Mirror
- Schema Builder
- Validation & Defaults
- Utilities (Advanced)
- Types & Constants
- Tips & Recipes

## Installation & Imports

- Install: `npm install loro-mirror loro-crdt`
- Import styles:
    - Named imports (recommended): `import { Mirror, schema } from "loro-mirror"`
    - Default (convenience bundle of `schema` + `core`): `import loroMirror from "loro-mirror"`

## Core: Mirror

### Mirror

- Constructor: `new Mirror(options)`
    - `options: MirrorOptions<S>`
        - `doc: LoroDoc` — the Loro document to sync with
        - `schema?: S` — root schema (enables validation, typed defaults)
        - `initialState?: Partial<InferInputType<S>>` — shallow overlay onto doc snapshot and schema defaults (does not write to Loro)
        - `validateUpdates?: boolean` (default `true`) — validate on `setState`
        - `throwOnValidationError?: boolean` (default `false`) — throw on schema validation errors
        - `debug?: boolean` (default `false`) — verbose logging to console for diagnostics
        - `checkStateConsistency?: boolean` (default `false`) — verify after each `setState` that in-memory state matches the normalized `LoroDoc`
        - `inferOptions?: { defaultLoroText?: boolean; defaultMovableList?: boolean }` — inference hints when no schema covers a field

- Methods
    - `getState(): InferType<S>` — returns the current mirror state (immutable snapshot)
    - `setState(updater, options?): void`
        - Synchronous; the state, validation, and subscriber notifications all finish before `setState` returns.
        - `updater` supports both styles:
            - Mutate a draft: `(draft: InferType<S>) => void`
            - Return a new object: `(prev: Readonly<InferInputType<S>>) => InferInputType<S>`
            - Shallow partial: `Partial<InferInputType<S>>`
        - `options?: { tags?: string | string[]; origin?: string; timestamp?: number; message?: string }` — tags surface in subscriber metadata; commit metadata (`origin`, `timestamp`, `message`) is forwarded to the underlying Loro commit
    - `subscribe((state, metadata) => void): () => void`
        - `metadata: { direction: SyncDirection; tags?: string[] }`
        - Returns an unsubscribe function
    - `dispose(): void` — removes all internal subscriptions and listeners
    - `checkStateConsistency(): void` — manually triggers the consistency assertion described above
    - `getContainerIds(): ContainerID[]` — advanced helper that lists registered Loro container IDs for debugging

- Behavior & Notes
    - Sync directions:
        - `FROM_LORO` — changes applied from the Loro document
        - `TO_LORO` — changes produced by `setState`
        - `BIDIRECTIONAL` — manual/initial sync context
    - Mirror suppresses document events emitted during its own `setState` commits to prevent feedback loops; provide `origin`, `timestamp`, or `message` when you need to tag those commits.
    - Initial state precedence: defaults (from schema) → `doc` snapshot (normalized) → hinted shapes from `initialState` (no writes to Loro).
    - Trees: mirror state uses `{ id: string; data: object; children: Node[] }`. Loro tree `meta` is normalized to `data`.
    - `$cid` on maps: Mirror injects a read-only `$cid` field into every LoroMap shape in state. It equals the Loro container ID, is not written back to Loro, and is ignored by diffs.
    - Inference: with no schema, Mirror can infer containers from values; configure via `inferOptions`.

#### Example

```ts
import { Mirror, schema } from "loro-mirror";
import { LoroDoc } from "loro-crdt";

const appSchema = schema({
    settings: schema.LoroMap({
        title: schema.String(),
        dark: schema.Boolean(),
    }),
    todos: schema.LoroMovableList(
        schema.LoroMap({ id: schema.String(), text: schema.String() }),
        (t) => t.id,
    ),
});

const mirror = new Mirror({ doc: new LoroDoc(), schema: appSchema });

mirror.setState((s) => {
    s.settings.title = "Docs";
    s.todos.push({ id: "1", text: "Ship" });
});

const unsub = mirror.subscribe((state, { direction, tags }) => {
    // ...
});

unsub();
```

## Schema Builder

All schema builders live under the `schema` namespace and are exported at the package root.

- Root schema: `schema(definition, options?)`
    - `definition: { [key: string]: ContainerSchemaType }`
    - `options?: SchemaOptions`

- Primitives
    - `schema.String<T = string>(options?)`
    - `schema.Number(options?)`
    - `schema.Boolean(options?)`
    - `schema.Any(options?)` — runtime-inferred value/container type (useful for dynamic JSON-like fields)
    - `schema.Ignore(options?)` — present in state, ignored for Loro diffs/validation

- Containers
    - `schema.LoroMap(definition)`
        - Returns an object with `.catchall(valueSchema)` to allow mixed fixed keys + dynamic keys
    - `schema.LoroMapRecord(valueSchema, options?)` — dynamic record (all keys share `valueSchema`)
    - `schema.LoroList(itemSchema, idSelector?, options?)`
        - `idSelector?: (item) => string` enables identity‑aware minimal updates
    - `schema.LoroMovableList(itemSchema, idSelector, options?)`
        - Emits explicit list `move` ops on reorder (strongly recommended for reordering UIs)
    - `schema.LoroText(options?)` — collaborative text represented as `string` in state
    - `schema.LoroTree(nodeMapSchema, options?)` — hierarchical data. Node shape in state: `{ id: string; data: {...}; children: Node[] }`

- Options & Validation on fields (`SchemaOptions`)
    - `required?: boolean` — default `true`; set `false` to allow `undefined`
    - `defaultValue?: unknown` — default value when not present
    - `description?: string`
    - `validate?: (value) => boolean | string` — custom validator message when not true

- `schema.Any` options (per-Any inference overrides)
    - `defaultLoroText?: boolean` — default `false` for `Any` when omitted (primitive string), overriding the global `inferOptions.defaultLoroText`.
    - `defaultMovableList?: boolean` — inherits from the global inference options unless explicitly set.

- Type inference
    - `InferType<S>` — state type produced by a schema
    - `InferInputType<S>` — input type accepted by `setState` (map `$cid` optional)
    - `InferSchemaType<T>` — infers the type of a map definition
    - `InferTreeNodeType<M>` / `InferTreeNodeTypeWithCid<M>` — inferred node shapes for trees
    - `InferInputTreeNodeType<M>` — input node shape for trees (node `data.$cid` optional)
    - `$cid` is present in inferred types for all map schemas (including list items and tree `data` maps)

Examples

```ts
const App = schema({
    user: schema.LoroMap({
        name: schema.String(),
        // cache is local-only and will not sync to Loro
        cache: schema.Ignore<{ hits: number }>(),
    }),
    notes: schema.LoroText(),
    tags: schema.LoroList(schema.String()),
});

// Dynamic record
const KV = schema.LoroMapRecord(schema.String());

// Mixed fixed + dynamic keys
const Mixed = schema
    .LoroMap({ fixed: schema.Number() })
    .catchall(schema.String());
```

## Validation & Defaults

- `validateSchema(schema, value): { valid: boolean; errors?: string[] }`
    - Validates recursively according to the schema. `ignore` fields are skipped.
- `getDefaultValue(schema): InferType<S> | undefined`
    - Produces defaults for a schema (respects `required` and `defaultValue`).
- `createValueFromSchema(schema, value): InferType<S>`
    - Casts/wraps a value into the shape expected by a schema (primitives pass through).

## Utilities (Advanced)

Most applications will not need the low-level helpers below, but they are part of the published surface for tooling and testing.

- `toNormalizedJson(doc: LoroDoc): unknown` — returns `doc.toJSON()` with tree `meta` data normalized into `data` so it matches Mirror state.
- Schema guards exported from `schema/validators`:
    - `isContainerSchema`, `isRootSchemaType`, `isLoroMapSchema`, `isLoroListSchema`, `isListLikeSchema`, `isLoroMovableListSchema`, `isLoroTextSchema`, `isLoroTreeSchema`

## Types & Constants

- `SyncDirection` — enum: `FROM_LORO`, `TO_LORO`, `BIDIRECTIONAL`
- `MirrorOptions<S>` — constructor options for `Mirror`
- `SetStateOptions` — `{ tags?: string | string[] }`
- `UpdateMetadata` — `{ direction: SyncDirection; tags?: string[] }`
- `InferType<S>` — state shape produced by a schema (includes `$cid` on maps)
- `InferInputType<S>` — input shape accepted by `setState` (like `InferType` but `$cid` is optional on maps)
- `InferContainerOptions` — `{ defaultLoroText?: boolean; defaultMovableList?: boolean }`
- `SubscriberCallback<T>` — `(state: T, metadata: UpdateMetadata) => void`
- Change types (advanced): `ChangeKinds`, `Change`, `MapChangeKinds`, `ListChangeKinds`, `MovableListChangeKinds`, `TreeChangeKinds`, `TextChangeKinds`
- Schema types: `SchemaType`, `ContainerSchemaType`, `RootSchemaType`, `LoroMapSchema`, `LoroListSchema`, `LoroMovableListSchema`, `LoroTextSchemaType`, `LoroTreeSchema`, `SchemaOptions`, …

## Tips & Recipes

- Lists: always provide an `idSelector` if items have stable IDs — enables minimal add/update/move/delete instead of positional churn. Prefer `LoroMovableList` when reorder operations are common.
- `$cid` for IDs: Every `LoroMap` includes a stable `$cid` you can use as a React `key` or as a `LoroList` item selector: `(item) => item.$cid`.
- `setState` styles: choose your favorite — draft mutation or returning a new object. Both run synchronously, so follow-up logic can safely read the updated state immediately.
- Tagging updates: pass `{ tags: ["analytics", "user"] }` to `setState` and inspect `metadata.tags` in subscribers.
- Trees: you can create/move/delete nodes in state (Mirror emits precise `tree-create/move/delete`). Node `data` is a normal Loro map — nested containers (text, list, map) update incrementally.
- Initial state: providing `initialState` hints shapes and defaults in memory, but does not write into the LoroDoc until a real change occurs.
- Validation: keep `validateUpdates` on during development; flip `throwOnValidationError` as you see fit.
- Inference: if you work schemaless but prefer text containers for strings or movable lists for arrays by default, set `inferOptions: { defaultLoroText: true, defaultMovableList: true }`.

---

Questions or gaps? If you need deeper internals (diff pipelines, event application), explore the source under `src/core/` — but for most apps, `Mirror` and the schema builders are all you need.
