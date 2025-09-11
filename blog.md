# Loro Mirror: Make Local State Collaboraive

Loro Mirror keeps your UI state and a Loro document in sync. You keep writing normal UI code. Mirror figures out what changed, applies small CRDT updates under the hood, and puts stable IDs back into your data. This gives you live collaboration, offline edits, and history you can travel through.

## What it is

- Loro is a CRDT engine. CRDTs are data types that merge changes from many places without conflicts.
- Loro Mirror is a small layer that ties your React state to a Loro document.

## Why it matters

- Keep your current React patterns (setState, hooks).
- Add multiplayer and offline editing support without custom patch logic.
- Get collaboraive undo/redo and time travel based on real edit history.

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
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { useLoroStore } from "loro-mirror-react";

type TodoStatus = "todo" | "inProgress" | "done";

const todoSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true }, // auto‑assign Loro's container id `$cid` on insert
        ),
        (t) => t.$cid,
    ),
});

export function TodoApp() {
    const { state, setState } = useLoroStore({
        doc: new LoroDoc(),
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
                    <li key={(t as any).$cid}>
                        {t.text} — {t.status}
                    </li>
                ))}
            </ul>
        </>
    );
}
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
