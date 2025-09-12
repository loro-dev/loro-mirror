 # Loro Mirror — API Reference
 
 This is the complete API reference for the `loro-mirror` package. It covers the public classes, functions, types, and utilities exported from the package entry and includes practical tips for effective usage.
 
 Contents
 
 - Installation & Imports
 - Core: Mirror and Store
 - Schema Builder
 - Validation & Defaults
 - Utilities (Advanced)
 - Types & Constants
 - Tips & Recipes
 
 ## Installation & Imports
 
 - Install: `npm install loro-mirror loro-crdt`
 - Import styles:
   - Named imports (recommended): `import { Mirror, createStore, schema } from "loro-mirror"`
   - Default (convenience bundle of `schema` + `core`): `import loroMirror from "loro-mirror"`
 
 ## Core: Mirror and Store
 
 ### Mirror
 
 - Constructor: `new Mirror(options)`
   - `options: MirrorOptions<S>`
     - `doc: LoroDoc` — the Loro document to sync with
     - `schema?: S` — root schema (enables validation, typed defaults)
     - `initialState?: Partial<InferType<S>>` — shallow overlay onto doc snapshot and schema defaults (does not write to Loro)
     - `validateUpdates?: boolean` (default `true`) — validate on `setState`
     - `throwOnValidationError?: boolean` (default `false`) — throw on schema validation errors
     - `debug?: boolean` — verbose logging to console for diagnostics
     - `checkStateConsistency?: boolean` (default `false`) — deep checks in-memory state equals normalized `doc` JSON after `setState`
     - `inferOptions?: { defaultLoroText?: boolean; defaultMovableList?: boolean }` — inference hints when no schema covers a field
 
 - Methods
   - `getState(): InferType<S>` — returns the current mirror state (immutable snapshot)
   - `setState(updater, options?): void`
     - `updater: ((draft: InferType<S>) => void | InferType<S>) | Partial<InferType<S>>`
       - Mutate a draft (Immer-style), or return a new object, or pass a shallow partial
     - `options?: { tags?: string | string[] }` — tags surface in subscriber metadata
   - `subscribe((state, metadata) => void): () => void`
     - `metadata: { direction: SyncDirection; tags?: string[] }`
     - Returns an unsubscribe function
   - `dispose(): void` — removes all internal subscriptions and listeners
   - `checkStateConsistency(): void` — throws if `state` diverges from normalized `doc` JSON (use with `checkStateConsistency: true`)
 
 - Behavior & Notes
   - Sync directions:
     - `FROM_LORO` — changes applied from the Loro document
     - `TO_LORO` — changes produced by `setState`
   - Mirror ignores events with origin `"to-loro"` to prevent feedback loops.
   - Initial state precedence: defaults (from schema) → `doc` snapshot (normalized) → hinted shapes from `initialState` (no writes to Loro).
   - Trees: mirror state uses `{ id: string; data: object; children: Node[] }`. Loro tree `meta` is normalized to `data`.
   - `$cid` injection: when a map schema uses `{ withCid: true }`, mirror injects a read‑only `$cid` field in state equals to the Loro container ID. This is not written back to Loro and ignored by diffs.
   - Inference: with no schema, Mirror can infer containers from values; configure via `inferOptions`.
 
 - Example
 
 ```ts
 import { Mirror, schema } from "loro-mirror";
 import { LoroDoc } from "loro-crdt";
 
 const appSchema = schema({
     settings: schema.LoroMap({ title: schema.String(), dark: schema.Boolean() }),
     todos: schema.LoroMovableList(
         schema.LoroMap({ id: schema.String(), text: schema.String() }),
         (t) => t.id
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
 
 ### Store
 
 Convenience wrapper around `Mirror` with a minimal Redux‑like surface.
 
 - `createStore(options): Store<S>`
   - `options: CreateStoreOptions<S>`
     - `doc: LoroDoc`
     - `schema: S`
     - `initialState?: Partial<InferType<S>>`
     - `validateUpdates?: boolean`
     - `throwOnValidationError?: boolean` (default `true`)
     - `debug?: boolean`
     - `checkStateConsistency?: boolean`
   - Returns `Store<S>` with:
     - `getState(): InferType<S>`
     - `setState(updater): void` (same shapes as Mirror)
     - `subscribe(cb): () => void` (same metadata as Mirror)
     - `getMirror(): Mirror<S>`
     - `getLoro(): LoroDoc`
 
 - `createReducer(handlers) -> (store) => dispatch(type, payload)`
   - Define an object of handlers that mutate an Immer draft. The returned `dispatch` wires those actions to `store.setState`.
 
 Example
 
 ```ts
 import { createStore, createReducer, schema } from "loro-mirror";
 import { LoroDoc } from "loro-crdt";
 
 const s = schema({
   todos: schema.LoroList(schema.LoroMap({ id: schema.String(), text: schema.String(), done: schema.Boolean({ defaultValue: false }) }), (t) => t.id),
 });
 
 const store = createStore({ doc: new LoroDoc(), schema: s });
 
 const actions = {
   add(state, { id, text }: { id: string; text: string }) {
     state.todos.push({ id, text });
   },
   toggle(state, id: string) {
     const item = state.todos.find((t) => t.id === id);
     if (item) item.done = !item.done;
   },
 };
 
 const dispatch = createReducer(actions)(store);
 
 dispatch("add", { id: "a", text: "Task" });
 dispatch("toggle", "a");
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
   - `schema.Ignore<T = unknown>(options?)` — present in state, ignored for Loro diffs/validation
 
 - Containers
   - `schema.LoroMap(definition, options?)`
     - Options: e.g. `{ withCid?: boolean }`
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
 
 - Type inference
   - `InferType<S>` — turns a schema into a TypeScript type
   - `InferSchemaType<T>` — infers the type of a map definition
   - `InferTreeNodeType<M>` / `InferTreeNodeTypeWithCid<M>` — inferred node shapes for trees
   - `$cid` is present in inferred types when `{ withCid: true }` is used on a map schema (including list items and tree `data` maps)
 
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
 const Mixed = schema.LoroMap({ fixed: schema.Number() }).catchall(schema.String());
 ```
 
 ## Validation & Defaults
 
 - `validateSchema(schema, value): { valid: boolean; errors?: string[] }`
   - Validates recursively according to the schema. `ignore` fields are skipped.
 - `getDefaultValue(schema): InferType<S> | undefined`
   - Produces defaults for a schema (respects `required` and `defaultValue`).
 - `createValueFromSchema(schema, value): InferType<S>`
   - Casts/wraps a value into the shape expected by a schema (primitives pass through).
 
 ## Utilities (Advanced)
 
 The following helpers are exported for advanced use, tooling, or tests. Most apps do not need them directly.
 
 - Equality & JSON
   - `deepEqual(a, b): boolean` — deep structural equality
   - `toNormalizedJson(doc: LoroDoc): unknown` — `doc.toJSON()` with tree `meta` normalized to `data`
 
 - Path helpers
   - `getPathValue(obj, path: string[]): unknown` — read nested path
   - `setPathValue(obj, path: string[], value): void` — write nested path (mutates the object)
 
 - Container detection & IDs
   - `valueIsContainer(v): { cid: string; value: unknown }` — check values from `doc.getDeepValueWithID()`
   - `valueIsContainerOfType(v, suffix: string): boolean` — e.g. `":Text"`, `":Map"`, `":List"`, `":MovableList"`
   - `containerIdToContainerType(id): ContainerType | undefined`
   - `getRootContainerByType(doc, key, type): Container`
   - `isTreeID(id: unknown): boolean` — test if a string looks like a Loro `TreeID` (e.g. `"0@1"`)
 
 - Inference helpers
   - `schemaToContainerType(schema): ContainerType | undefined`
   - `tryInferContainerType(value, inferOptions?): ContainerType | undefined`
   - `inferContainerTypeFromValue(value, inferOptions?): "loro-map" | "loro-list" | "loro-text" | "loro-movable-list" | undefined`
   - `isValueOfContainerType(type, value): boolean`
 
 - Guards & shapes
   - `isObject(v): v is Record<string, unknown>`
   - `isObjectLike(v): v is Record<string, unknown>`
   - `isArrayLike(v): v is unknown[]`
   - `isStringLike(v): v is string`
   - `isStateAndSchemaOfType(values, stateGuard, schemaGuard)` — generic narrow helper
 
 - Change helpers (primarily internal)
   - `insertChildToMap(containerId, key, value): Change` — produce a map change (container‑aware)
   - `tryUpdateToContainer(change, enable, schema?): Change` — upgrade an insert/set to a container operation based on schema/value
 
 ## Types & Constants
 
 - `SyncDirection` — enum: `FROM_LORO`, `TO_LORO`, `BIDIRECTIONAL`
 - `MirrorOptions<S>` — constructor options for `Mirror`
 - `SetStateOptions` — `{ tags?: string | string[] }`
 - `UpdateMetadata` — `{ direction: SyncDirection; tags?: string[] }`
 - Change types (advanced): `ChangeKinds`, `Change`, `MapChangeKinds`, `ListChangeKinds`, `MovableListChangeKinds`, `TreeChangeKinds`, `TextChangeKinds`
 - Schema types: `SchemaType`, `ContainerSchemaType`, `RootSchemaType`, `LoroMapSchema`, `LoroListSchema`, `LoroMovableListSchema`, `LoroTextSchemaType`, `LoroTreeSchema`, `SchemaOptions`, …
 - `CID_KEY` — the literal string `"$cid"` used by `withCid` maps in mirrored state
 
 ## Tips & Recipes
 
 - Lists: always provide an `idSelector` if items have stable IDs — enables minimal add/update/move/delete instead of positional churn. Prefer `LoroMovableList` when reorder operations are common.
 - `$cid` for IDs: Use `{ withCid: true }` on `schema.LoroMap(...)` to get a stable `$cid` you can use as a React `key` or as a `LoroList` item selector: `(item) => item.$cid`.
 - `setState` styles: choose your favorite — draft mutation or returning a new object. Both are supported.
 - Tagging updates: pass `{ tags: ["analytics", "user"] }` to `setState` and inspect `metadata.tags` in subscribers.
 - Trees: you can create/move/delete nodes in state (Mirror emits precise `tree-create/move/delete`). Node `data` is a normal Loro map — nested containers (text, list, map) update incrementally.
 - Initial state: providing `initialState` hints shapes and defaults in memory, but does not write into the LoroDoc until a real change occurs.
 - Validation: keep `validateUpdates` on during development; flip `throwOnValidationError` as you see fit.
 - Inference: if you work schemaless but prefer text containers for strings or movable lists for arrays by default, set `inferOptions: { defaultLoroText: true, defaultMovableList: true }`.
 
 ---
 
 Questions or gaps? If you need deeper internals (diff pipelines, event application), explore the source under `src/core/` — but for most apps, `Mirror`, the schema builders, and `createStore` are all you need.
