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

## What Loro brings

- Collaboration: Multiple people can edit the same state, and changes merge automatically (CRDT).
- Offline‑first: Keep working without a network; changes sync later.
- Flexible sync (incl. P2P): Send updates over WebSocket, HTTP, or WebRTC. Works with servers or peer‑to‑peer. See [Sync](https://loro.dev/docs/tutorial/sync).
- History you can use: Local undo/redo with [Undo](https://loro.dev/docs/advanced/undo) and full time travel with [Time travel](https://loro.dev/docs/tutorial/time_travel).

## When to use it

- Shared state across tabs or devices.
- Real‑time or async collaboration in editors, boards, or dashboards.
- Offline editing with automatic merge later.

## When not to use it

- You need strict, single‑winner rules (e.g., bookings, payments).
- You need strong consistency enforced.

## How it works (in short)

- Mirror maps your state to Loro containers (List, Map, Text, Tree, MovableList).
- When you change state, Mirror creates minimal CRDT ops (insert, delete, move, text edits).
- Remote changes import into the doc and Mirror updates your state.

## Quick start (React example)

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

## Core building blocks

- Lists and Movable Lists: Use MovableList when you need reliable moves/replace under concurrency. See [List and MovableList](https://loro.dev/docs/tutorial/list).
- Tree: Create, move, and delete hierarchical nodes without cycles; order siblings when you need to. See [Tree](https://loro.dev/docs/tutorial/tree).
- Text: Fast text insert/delete. See [Text](https://loro.dev/docs/tutorial/text).

## Undo and history

- Undo/redo with `UndoManager` (does not undo other people’s edits). See [Undo](https://loro.dev/docs/advanced/undo).
- Time travel with `doc.checkout(frontiers)` and return with `doc.attach()`. See [Time travel](https://loro.dev/docs/tutorial/time_travel) and [Versioning deep dive](https://loro.dev/docs/advanced/version_deep_dive).

## Save and load

- Updates (diffs): `doc.export({ mode: 'update', from })` for network sync. See [Export modes](https://loro.dev/docs/tutorial/encoding).
- Full snapshot: `doc.export({ mode: 'snapshot' })` to save everything. See [Export modes](https://loro.dev/docs/tutorial/encoding).
- Shallow snapshot: keep current state and only recent history to save space. See [Shallow snapshots](https://loro.dev/docs/concepts/shallow_snapshots).

## Cursors and presence

- Stable cursors: store caret/selection that survives edits. See [Cursor](https://loro.dev/docs/tutorial/cursor).
- Ephemeral Store: send presence (like cursors) as small key/value updates. See [Ephemeral Store](https://loro.dev/docs/tutorial/ephemeral).

## Learn more about Loro

- [Getting started](https://loro.dev/docs/tutorial/get_started)
- [Sync guide](https://loro.dev/docs/tutorial/sync)
- [Text](https://loro.dev/docs/tutorial/text), [List & MovableList](https://loro.dev/docs/tutorial/list), [Tree](https://loro.dev/docs/tutorial/tree)
- [Undo](https://loro.dev/docs/advanced/undo)
- [Versioning deep dive](https://loro.dev/docs/advanced/version_deep_dive)
