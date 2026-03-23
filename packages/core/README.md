# Loro Mirror

## Quick Start

Define a schema and instantiate a `Mirror` with a `LoroDoc`.

```ts
import { Mirror, schema } from "loro-mirror";
import { LoroDoc } from "loro-crdt";

const doc = new LoroDoc();

const appSchema = schema({
    // LoroMap: structured object
    settings: schema.LoroMap({
        title: schema.String({ defaultValue: "Docs" }),
        darkMode: schema.Boolean({ defaultValue: false }),
    }),
    // LoroList: array of items (use `$cid` from maps)
    todos: schema.LoroList(
        schema.LoroMap({
            text: schema.String(),
        }),
        (t) => t.$cid, // `$cid` reuses Loro container id (explained later)
    ),
    // LoroText: collaborative text (string in state)
    notes: schema.LoroText(),
});

const store = new Mirror({ doc, schema: appSchema });

// Read state
const state = store.getState();

// Update (return a new state) — synchronous; the next line sees the new state.
store.setState({
    ...state,
    settings: { ...state.settings, darkMode: true },
    todos: [...state.todos, { text: "Add milk" }],
    notes: "Hello, team!",
});

// Or mutate a draft (Immer-style)
store.setState((s) => {
    s.todos.push({ text: "Ship" });
    s.settings.title = "Project";
});

// Subscribe
const unsubscribe = store.subscribe((next, { direction }) => {
    // direction: "FROM_LORO" | "TO_LORO"
});
```

## Installation

```bash
npm install loro-mirror loro-crdt
```

## API Reference

Core structures first:

- LoroMap: Structured object synced to a Loro map. Update fields by setting plain JS values. Nested containers (maps/lists/text) are created automatically from schema.
- LoroList: Array of items. With an `idSelector`, Mirror performs minimal add/update/move/delete; without it, updates are by index.
- LoroText: Collaborative rich text represented as a string in state; Mirror calls `LoroText.update` on changes.

Trees are advanced usage; see Advanced: Trees at the end.

### Mirror

- Constructor: `new Mirror({ doc, schema?, initialState?, validateUpdates?=true, throwOnValidationError?=false, debug?=false, checkStateConsistency?=false, inferOptions? })`
    - doc: LoroDoc to sync with
    - schema: Root schema; enables validation and typed defaults
    - initialState: Shallow-merged over schema defaults and current doc JSON
    - validateUpdates: Validate on `setState`
    - throwOnValidationError: Throw if validation fails (default false)
    - debug: Verbose logging
    - checkStateConsistency: Extra runtime check that `deepEqual(state, toNormalizedJson(doc))` after updates
    - inferOptions: `{ defaultLoroText?: boolean; defaultMovableList?: boolean }` for container inference when schema is missing
- Methods:
    - getState(): Current state
    - setState(updater | partial, options?): Mutate a draft or return a new object. Runs synchronously so downstream logic can immediately read the latest state.
        - options: `{ tags?: string | string[]; origin?: string; timestamp?: number; message?: string }` — tags surface in subscriber metadata; commit metadata is forwarded to the underlying Loro commit.
    - setStateWithEphemeralPatch(updater, options?): Like `setState`, but routes **eligible** changes to an `EphemeralStore` instead of LoroDoc. See [Ephemeral Patches](#ephemeral-patches) below.
    - finalizeEphemeralPatches(): Immediately commit pending ephemeral patches to LoroDoc (e.g. on `mouseup`).
    - subscribe((state, metadata) => void): Subscribe; returns unsubscribe
        - metadata: `{ direction: FROM_LORO | TO_LORO | FROM_EPHEMERAL; tags?: string[] }`
    - dispose(): Remove all subscriptions

Types: `SyncDirection`, `UpdateMetadata`, `SetStateOptions`.

### Schema Builder

- Root: `schema({ ...fields })`
- Primitives: `schema.String`, `schema.Number`, `schema.Boolean`, `schema.Any`, `schema.Ignore`
- Containers (core):
    - `schema.LoroMap({ ...fields })`
    - `schema.LoroList(itemSchema, idSelector?)`
    - `schema.LoroText()`
- Containers (additional):
    - `schema.LoroMovableList(itemSchema, idSelector)` — emits move ops on reorder
    - `schema.LoroTree(nodeMapSchema)` — hierarchical data (advanced)
    - `schema.LoroMapRecord(valueSchema)` — dynamic key map with a single value schema
    - `schema.LoroMap({...}).catchall(valueSchema)` — mix fixed keys with a catchall value schema

Signatures:

- `schema.LoroMap(definition, options?)` — mirrored state always includes a read-only `$cid` field equal to the underlying Loro container id (applies to root/nested maps, list items, and tree node `data` maps).
- `schema.LoroList(itemSchema, idSelector?: (item) => string, options?)`
- `schema.LoroMovableList(itemSchema, idSelector: (item) => string, options?)`
- `schema.LoroText(options?)`
- `schema.LoroTree(nodeMapSchema, options?)`

SchemaOptions for any field: `{ required?: boolean; defaultValue?: unknown; description?: string; validate?: (value) => boolean | string }`.

Any options:

- `schema.Any({ defaultLoroText?: boolean; defaultMovableList?: boolean })`
    - `defaultLoroText` defaults to `false` for Any when omitted (primitive string), overriding the global `inferOptions.defaultLoroText`.
    - `defaultMovableList` inherits from the global inference options unless specified.

Reserved key `$cid`:

- `$cid` is injected into mirrored state for all `LoroMap` schemas; it is never written back to Loro and is ignored by diffs/updates. It’s useful as a stable identifier (e.g., `schema.LoroList(map, x => x.$cid)`).

### Validators & Helpers

- `validateSchema(schema, value)` — returns `{ valid: boolean; errors?: string[] }`
- `getDefaultValue(schema)` — default value inferred from schema/options
- `toNormalizedJson(doc)` — JSON matching Mirror’s state shape (e.g., Tree `meta` -> `data`)

## Ephemeral Patches

When users drag or scale canvas elements, syncing every intermediate position through LoroDoc creates redundant editing history. `setStateWithEphemeralPatch` solves this by routing temporary changes through an `EphemeralStore` for real-time sync, then committing once to LoroDoc when the operation ends.

### Setup

```ts
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { Mirror, schema } from "loro-mirror";

const doc = new LoroDoc();
const eph = new EphemeralStore();

const mirror = new Mirror({
    doc,
    schema: mySchema,
    ephemeralStore: eph, // enables setStateWithEphemeralPatch
});

// Network sync for ephemeral state (your responsibility)
eph.subscribeLocalUpdates((bytes) => channel.send(bytes));
channel.on("ephemeral", (bytes) => eph.apply(bytes));
```

### What goes where

| Change type | Destination | Example |
|---|---|---|
| Primitive value on an **existing key** of an **existing Map** | `EphemeralStore` | `s.items[0].x = 100` |
| New Map, new key, container value | `LoroDoc` | `s.items.push({...})` |
| List / Text / Tree operations | `LoroDoc` | `s.items.splice(...)` |

### Usage

```ts
// During drag — called on every mousemove (~60fps)
// Only x/y go to EphemeralStore; LoroDoc stays clean.
mirror.setStateWithEphemeralPatch(
    (s) => {
        s.items[i].x = e.clientX;
        s.items[i].y = e.clientY;
    },
    { finalizeTimeout: 1_000 }, // auto-commit after 1s of inactivity
);

// On mouseup — commit to LoroDoc immediately
mirror.finalizeEphemeralPatches();
```

### Finalization

Ephemeral values are committed to LoroDoc when:

1. The debounced `finalizeTimeout` expires (default: 50 000 ms). The timer resets on each `setStateWithEphemeralPatch` call, so it only fires after the user stops updating.
2. You call `finalizeEphemeralPatches()` manually (e.g. on `mouseup`).

On finalize, only values that still match what **this peer** last wrote are committed. If a remote peer overwrote a value in the EphemeralStore, it is skipped to prevent stale writes.

### Subscriber direction

Subscribers receive `direction: "FROM_EPHEMERAL"` when state changes due to an EphemeralStore update (local or remote). Use this to distinguish ephemeral changes from permanent LoroDoc changes:

```ts
mirror.subscribe((state, { direction }) => {
    if (direction === "FROM_EPHEMERAL") {
        // Lightweight update — no LoroDoc history created
    }
});
```

## Advanced: Trees

Trees are for hierarchical data where each node has a `data` map. The state shape is `{ id?: string; data: {...}; children: Node[] }`.

```ts
const node = schema.LoroMap({ name: schema.String({ required: true }) });
const s = schema({ tree: schema.LoroTree(node) });
const mirror = new Mirror({ doc: new LoroDoc(), schema: s });

mirror.setState((st) => {
    st.tree.push({ data: { name: "root" }, children: [] });
});
```

Note: If you omit `id` when creating a node, Loro assigns one; Mirror writes it back on the next state after sync.

## Tiny React Example

Prefer the React helpers in `loro-mirror-react` for a clean setup.

```tsx
import { useLoroStore } from "loro-mirror-react";
import { schema } from "loro-mirror";
import { LoroDoc } from "loro-crdt";

const todosSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({ text: schema.String() }),
        (t) => t.$cid, // list selector uses `$cid` (Loro container id)
    ),
});

export function App() {
    const { state, setState } = useLoroStore({
        doc: new LoroDoc(),
        schema: todosSchema,
    });
    return (
        <div>
            <button
                onClick={() =>
                    setState((s) => {
                        s.todos.push({ text: "New" });
                    })
                }
            >
                Add
            </button>
            <ul>
                {state.todos.map((t) => (
                    <li key={t.$cid /* stable key from Loro container id */}>
                        {t.text}
                    </li>
                ))}
            </ul>
        </div>
    );
}
```

For more React patterns (selectors, actions, provider), see `packages/react/README.md` or the `useLoroContext` helpers.

## Notes & Tips

- Use an `idSelector` whenever list items have stable IDs to get efficient moves instead of delete+insert.
- `setState` accepts an updater that either mutates a draft or returns a new object — use whichever style you prefer.
- Subscriptions receive `{ direction: FROM_LORO | TO_LORO, tags?: string[] }` to help you attribute changes.

## License

MIT
