# Implementation Plan: LoroTree Support in Mirror

Status: Completed • Owner: Core • Last updated: 2025-08-28

## Goals

- Provide first-class LoroTree support in Mirror for bidirectional sync between app state and loro-crdt Tree containers.
- Maintain parity with existing Map/List/Text/MovableList flows, including schema validation and event-driven state updates.

## Non-Goals

- Rich tree-aware UIs (out of scope, Mirror focuses on sync/state).
- Automatic inference of Tree from plain arrays without schema.

## Current Gaps (as-is)

- Mirror has no Tree handling in: root init, nested registration, read path, or write path.
- loroEventApply does not apply `tree` diffs; path walker cannot resolve nodes by id within arrays.
- diff does not compute structural Tree diffs.
- Schema lacks `loro-tree` type/guards/defaults; utils lacks `Tree` in helpers.

## State Model

Represent a Tree in Mirror state as nested nodes:

```ts
type TreeNode<T = Record<string, unknown>> = {
  id: string;             // TreeID string from Loro
  data: T;                // node metadata (validated by nodeSchema)
  children: TreeNode[];   // ordered children
}

// Mirror state value for a LoroTree: array of roots
type TreeValue<T> = TreeNode<T>[]
```

Notes:
- When app creates new nodes via state, `id` may be omitted; Loro assigns it on create; events will fill it back.
- Node data is a LoroMap schema (`nodeSchema`) for validation and nested containers.

## Public Schema API Changes

- Add `schema.LoroTree(nodeSchema, options?)`
  - `type: "loro-tree"`, `getContainerType(): "Tree"`.
  - `nodeSchema`: `LoroMapSchema<Record<string, SchemaType>>` for `node.data`.
- `types.ts`
  - Add `LoroTreeSchema<T>` to `SchemaType` and `ContainerSchemaType` unions.
  - `InferType<LoroTreeSchema<T>>` resolves to `Array<{ id: string; data: InferType<T>; children: ... }>`.
- `validators.ts`
  - Add `isLoroTreeSchema` type guard.
  - `validateSchema` support: top-level is `Array`; validate `node.data` recursively using `nodeSchema`; validate `children` recursively.
  - `getDefaultValue` returns `[]` when required; else `undefined`.

## Core Changes (Read Path)

`loroEventApply.ts`
- Implement `tree` diff application:
  - Initialize target as `[]` if missing.
  - `create`: insert `{ id, data: {}, children: [] }` at `parent/index` (root if `parent` undefined).
  - `move`: remove from `oldParent/oldIndex` and insert at `parent/index` (if same parent and `oldIndex < index`, decrement target index).
  - `delete`: remove subtree at `oldParent/oldIndex`.
- Enhance path resolution to support node lookup by `id` inside arrays so map diffs to `node.data` apply cleanly:
  - When current is an array and next segment is a string, interpret as `TreeID` string and select element with `elem.id === seg`.
- Continue using `applyMapDiff` for `node.data` changes.

## Core Changes (Write Path)

`diff.ts`
- Extend `diffContainer` to handle `ContainerType === "Tree"` with `diffTree(...)`.
- Implement `diffTree` (structure + node data):
  - Build old/new id->node maps and parent relationships.
  - Deletions: nodes in old not in new (delete deepest-first to avoid orphaning).
  - Creates: nodes in new not in old (create top-down so parents exist).
  - Moves: common nodes whose `(parentId, index)` changed.
  - Node data updates: for common nodes, route to `diffContainer` of `node.data` via the attached `LoroMap` container id.

`mirror.ts`
- `Change` union: add Tree operations
  - `tree-create`: `{ container: ContainerID, kind: "tree-create", parent?: TreeID, index: number }`
  - `tree-move`: `{ container: ContainerID, kind: "tree-move", target: TreeID, parent?: TreeID, index: number }`
  - `tree-delete`: `{ container: ContainerID, kind: "tree-delete", target: TreeID }`
- Initialization
  - Include `"loro-tree"` in root container registration and `getRootContainerByType` calls.
  - For Tree nested registration, when visiting nodes, register `node.data` container with `nodeSchema`.
- Loro event registration
  - For `event.diff.type === "tree"`, on `create` resolve node then `registerContainer(node.data.id, nodeSchema)`.
- Apply changes
  - `applyRootChanges`: support `"loro-tree"` root and forward to `updateTopLevelContainer`.
  - `applyContainerChanges`: add `case "Tree"` to handle `tree-*` changes via `LoroTree.createNode/move/delete`.
  - `updateTopLevelContainer`: add `"Tree"` branch to compute tree diffs and apply.
  - `initializeContainer`: when kind `"Tree"` and initial value present, seed structure with `createNode`, then initialize each `node.data` using schema.
  - `createContainerFromSchema`: return `[new LoroTree(), "Tree"]` for `"loro-tree"`.
  - `getSchemaForChild`: when parent schema is `loro-tree`, return `nodeSchema` for node data.

`utils.ts`
- `getRootContainerByType`: add `"Tree" -> doc.getTree(key)`.
- Do not infer `Tree` in `tryInferContainerType` (requires schema to avoid ambiguity with plain lists).

## Tests

New: `packages/core/tests/core/mirror-tree.test.ts`
- FROM_LORO: create/move/delete in Loro updates Mirror state (`{id,data,children}`), including nested `data` updates.
- TO_LORO: mutating state (new nodes without id, moves, deletes, data changes) updates Loro via `tree-*` changes and map updates.
- Mixed operations in one `setState` produce consistent changes.
- Fractional index compatible: numeric `index` passed; Loro handles ordering.

## Edge Cases & Performance

- Same-parent move index adjustment when `oldIndex < index`.
- Deepest-first deletion ordering.
- Optional in-memory index per tree during event application for O(1) node lookup (can be a follow-up optimization).
- Concurrency handled by Loro; Mirror applies diffs idempotently.

## Rollout & Verification

1) Baseline
- [x] `pnpm build && pnpm test && pnpm typecheck`
- [ ] `pnpm lint`

2) Schema & Utils
- [x] Add `LoroTreeSchema` to `types.ts` (+ InferType)
- [x] Add `schema.LoroTree()` to `schema/index.ts`
- [x] Add `isLoroTreeSchema`, extend validators and defaults
- [x] Add `Tree` to `getRootContainerByType`

3) Read Path
- [x] loroEventApply: apply `tree` diffs (create/move/delete)
- [x] loroEventApply: path walker supports node id in arrays
- [x] Register `node.data` containers on tree creates

4) Write Path
- [x] diff: add `Tree` branch and implement `diffTree`
- [x] mirror: extend `Change` union with `tree-*`
- [x] mirror: handle `case "Tree"` in `applyContainerChanges`
- [x] mirror: update top-level container branch for `"Tree"`
- [x] mirror: nested registration + initialization for `node.data`

5) Tests
- [x] Add `mirror-tree.test.ts` with FROM_LORO, TO_LORO, mixed flows
- [x] Run and fix regressions

6) Docs
- [ ] README entry: Tree shape `{ id, data, children }` and schema requirements

7) Final QA
- [x] `pnpm build`
- [x] `pnpm test`
- [ ] `pnpm lint`
- [x] `pnpm typecheck`

## Progress Notes

- Normalized tree JSON from `{ id, meta, children }` to `{ id, data, children }` during initialization for consistent state shape.
- Scoped path remapping so only tree node `meta` is treated as `data` (does not affect root `meta` maps), fixing a regression in state.test profile.bio.
- Initial Tree top-level updates rebuild structure; `diffTree` is implemented and can be used at root for minimal ops in a follow-up if desired.

## Risks / Open Questions

- Node identification in state: require `id` to match Loro `TreeID` (string). For newly created nodes without id, Mirror will create and fill id from events; interim state may temporarily show empty `id` values—acceptable for UI with optimistic updates.
- Large tree performance: consider indexing maps for event application if profiling shows hotspots.
- Schema composition: `nodeSchema` can itself contain containers; ensure nested registration paths are correct.
