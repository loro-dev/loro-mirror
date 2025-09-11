# Loro Mirror: Make UI State Collaborative by Mirroring to CRDTs

Loro is a high‑performance CRDT engine for local‑first apps. It merges concurrent edits without conflicts, works offline with later sync, and provides versioning/time‑travel plus compact updates and snapshots across rich containers (Text, Map, List/MovableList, Tree).

However, wiring Loro to application state typically involves a lot of repetitive boilerplate (mapping state, diffing changes, handling event deltas).

Loro Mirror makes bidirectional sync between your App State and the Loro document effortless. Keep your normal React setState patterns; Mirror computes minimal CRDT deltas for local edits and applies remote event deltas back to state. You get live collaboration, offline edits, and history you can travel through.

## Why

Teams building on Loro often end up writing the same glue code: mapping Loro (CRDT) state into app state, diffing app‑state edits back into minimal CRDT updates, and applying Loro events as deltas to update app state. CRDTs guarantee convergence between documents, but they don’t keep your app state in sync with the CRDT document. That consistency boundary is exactly what Loro Mirror addresses.

- Declarative mapping: define a schema once; Mirror keeps an immutable app‑state view in sync with your Loro document.
- Event → state: Loro events automatically update the immutable state.
- State → CRDT: setState diffs are turned into minimal CRDT changesets (insert/delete/move/text edits) — no manual patching.
- Keep your habits: continue using familiar React setState/hooks (and similar patterns elsewhere); Mirror handles the deltas.
- Scales with change, not size: work is O(km), where k is the number of changed items and m is the average number of child elements per item; avoids full‑state traversals and matches React‑style render complexity.

## How to use

1. Define a schema that describes your app state as Loro containers (Map/List/Text/MovableList/Tree).
2. Create a `LoroDoc` and a Mirror store; provide `schema` and optional `initialState`.
3. Update via `setState` (immutable return or Immer‑style draft). Subscribe for changes if needed.
4. Sync across peers using Loro updates; Mirror applies remote changes back to your app state automatically.

### Basic Example (TypeScript, no React)

```ts
import { LoroDoc } from "loro-crdt";
import { schema, createStore, SyncDirection } from "loro-mirror";

// 1) Declare state shape – a MovableList of todos with stable Container ID `$cid`
type TodoStatus = "todo" | "inProgress" | "done";
const appSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true },
        ),
        (t) => t.$cid,
    ),
});

// 2) Create a Loro document and a Mirror store
const doc = new LoroDoc();
const store = createStore({
    doc,
    schema: appSchema,
    initialState: { todos: [] },
});

// 3) Subscribe (optional) – know whether updates came from local or remote
const unsubscribe = store.subscribe((state, { direction, tags }) => {
    if (direction === SyncDirection.FROM_LORO) {
        console.log("Remote update", { state, tags });
    } else {
        console.log("Local update", { state, tags });
    }
});

// 4) Either draft‑mutate or return a new state
// Draft‑style (mutate a draft)
store.setState((s) => {
    s.todos.push({ text: "Draft add", status: "todo" });
});

// Immutable return (construct a new object)
store.setState((s) => ({
    ...s,
    todos: [...s.todos, { text: "Immutable add", status: "todo" }],
}));

// 5) Sync across peers with Loro updates (transport‑agnostic)
// Example: two docs in memory – in real apps, send `bytes` over WS/HTTP/WebRTC
const other = new LoroDoc();
other.import(doc.export({ mode: "snapshot" }));

// Wire realtime sync (local updates → remote import)
const stop = doc.subscribeLocalUpdates((bytes) => {
    other.import(bytes);
});

// Any `store.setState(...)` on `doc` now appears in `other` as well
```

### React Example

```tsx
import React, { useMemo } from "react";
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { useLoroStore } from "loro-mirror-react";

type TodoStatus = "todo" | "inProgress" | "done";

const todoSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true }, // inject stable `$cid` from Loro
        ),
        (t) => t.$cid,
    ),
});

export function TodoApp() {
    const doc = useMemo(() => new LoroDoc(), []);
    const { state, setState } = useLoroStore({
        doc,
        schema: todoSchema,
        initialState: { todos: [] },
    });

    function addTodo(text: string) {
        setState((s) => {
            s.todos.push({ text, status: "todo" });
        });
    }

    return (
        <>
            <button onClick={() => addTodo("Write blog")}>Add</button>
            <ul>
                {state.todos.map((t) => (
                    <li key={t.$cid}>
                        <input
                            value={t.text}
                            onChange={(e) =>
                                setState((s) => {
                                    const i = s.todos.findIndex(
                                        (x) => x.$cid === t.$cid,
                                    );
                                    // Text delta will be calculated automatically
                                    if (i !== -1)
                                        s.todos[i].text = e.target.value;
                                })
                            }
                        />
                        <select
                            value={t.status}
                            onChange={(e) =>
                                setState((s) => {
                                    const i = s.todos.findIndex(
                                        (x) => x.$cid === t.$cid,
                                    );
                                    if (i !== -1)
                                        s.todos[i].status = e.target
                                            .value as TodoStatus;
                                })
                            }
                        >
                            <option value="todo">Todo</option>
                            <option value="inProgress">In Progress</option>
                            <option value="done">Done</option>
                        </select>
                    </li>
                ))}
            </ul>
        </>
    );
}
```

Tiny Undo/Redo (React)

```tsx
import { UndoManager } from "loro-crdt";

// Inside the same component, after creating `doc`:
const undo = useMemo(() => new UndoManager(doc), [doc]);

// Add controls anywhere in your UI:
<div>
    <button onClick={() => undo.undo()}>Undo</button>
    <button onClick={() => undo.redo()}>Redo</button>
    {/* UndoManager only reverts your local edits; remote edits stay. */}
    {/* See docs: https://loro.dev/docs/advanced/undo */}
    {/* For full time travel, see: https://loro.dev/docs/tutorial/time_travel */}
</div>;
```

What you get

- Type-safe, framework-agnostic state
- Each mutation becomes a minimal change-set (CRDT delta)—no manual diffing
- Fine-grained updates to subscribers for fast, predictable renders
- [Built-in history and time travel](https://loro.dev/docs/tutorial/time_travel)
- [Offline-first sync](https://loro.dev/docs/tutorial/sync) via updates or snapshots with deterministic conflict resolution over any transport (HTTP, WebSocket, P2P)
- [Collaborative undo/redo](https://loro.dev/docs/advanced/undo) across clients

## Where we’re going

Because Mirror owns the bidirectional mapping between application state and the Loro document, we can move value up the stack while lowering integration cost. For example:

- Text. Many interfaces render by lines, yet LoroText’s low‑level API is index‑based. Teams typically re‑implement line segmentation and map edits back to lines by hand. With Mirror in the middle, it becomes feasible to surface optional line‑aware events on top of LoroText so the UI receives stable, line‑based diffs without custom conversion—while retaining the underlying CRDT guarantees.
- Tree. LoroTree CRDT already ensures correct concurrent moves, but developers still translate tree operations into application‑state patches. Mirror carries first‑class mappings from tree events into your state shape, so consumers can work with natural “insert/move/delete node” updates.
- Lists at scale. Large collections benefit from virtualization. One possibility unlocked by Mirror is slice/window helpers so subscribers can focus on a moving window of list state without traversing or diffing the entire list—enabling infinite scroll and virtual tables with predictable performance.

These are illustrative possibilities rather than an exhaustive or committed roadmap. If this work helps you build collaborative, local‑first experiences, we’d be grateful for your sponsorship—it lets us keep investing in these higher‑level ergonomics.
