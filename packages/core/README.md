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
    - subscribe((state, metadata) => void): Subscribe; returns unsubscribe
        - metadata: `{ direction: FROM_LORO | TO_LORO; tags?: string[] }`
    - dispose(): Remove all subscriptions

Types: `SyncDirection`, `UpdateMetadata`, `SetStateOptions`.

### Schema Builder

- Root: `schema({ ...fields })`
- Primitives: `schema.String`, `schema.Number`, `schema.Boolean`, `schema.Ignore`
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

Reserved key `$cid`:

- `$cid` is injected into mirrored state for all `LoroMap` schemas; it is never written back to Loro and is ignored by diffs/updates. It’s useful as a stable identifier (e.g., `schema.LoroList(map, x => x.$cid)`).

### Validators & Helpers

- `validateSchema(schema, value)` — returns `{ valid: boolean; errors?: string[] }`
- `getDefaultValue(schema)` — default value inferred from schema/options
- `toNormalizedJson(doc)` — JSON matching Mirror’s state shape (e.g., Tree `meta` -> `data`)

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
