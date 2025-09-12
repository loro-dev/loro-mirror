# Loro Mirror

A TypeScript state management library that syncs application state with [loro-crdt](https://github.com/loro-dev/loro).

## Features

- 🔄 **Bidirectional Sync**: Seamlessly sync between application state and Loro CRDT
- 📊 **Schema Validation**: Type-safe schema system for validating state
- 🧩 **Modular Design**: Core package for state management, React package for React integration
- 🔍 **Selective Updates**: Subscribe to specific parts of your state
- 🛠️ **Developer Friendly**: Familiar API inspired by popular state management libraries
- 📱 **React Integration**: Hooks and context providers for React applications

## Packages

- [`loro-mirror`](./packages/core): Core state management functionality
- [`loro-mirror-react`](./packages/react): React integration with hooks and context
- [`loro-mirror-jotai`](./packages/jotai): Jotai integration

## Installation

```bash
npm install loro-mirror loro-crdt
# or
yarn add loro-mirror loro-crdt
# or
pnpm add loro-mirror loro-crdt
```

`loro-mirror-react` and `loro-mirror-jotai` are optional.

## Quick Start

### Usage

```typescript
import { LoroDoc } from "loro-crdt";
import { schema, createStore } from "loro-mirror";

// Define your schema
const todoSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({
            text: schema.String(),
            completed: schema.Boolean({ defaultValue: false }),
        }),
        // Use `$cid` (reuses Loro container id; explained later)
        (t) => t.$cid,
    ),
});

// Create a Loro document
const doc = new LoroDoc();
// Create a store
const store = createStore({
    doc,
    schema: todoSchema,
    initialState: { todos: [] },
});

// Update the state (immutable update)
store.setState((s) => ({
    ...s,
    todos: [
        ...s.todos,
        {
            text: "Learn Loro Mirror",
            completed: false,
        },
    ],
}));

// Or: draft-style updates (mutate a draft)
store.setState((state) => {
    state.todos.push({
        text: "Learn Loro Mirror",
        completed: false,
    });
    // `$cid` is injected automatically for LoroMap items
    // and reuses the underlying Loro container id (explained later)
});

// Subscribe to state changes
store.subscribe((state) => {
    console.log("State updated:", state);
});
```

### Schema Definition

Loro Mirror provides a declarative schema system that enables:

- **Type Inference**: Automatically infer TypeScript types for your application state from the schema
- **Runtime Validation**: Validate data structure and types during `setState` operations or synchronization
- **Default Value Generation**: Generate sensible default values based on the schema definition

#### Core Concepts

- **Root Schema**: The root object defined via `schema({...})`, containing only Loro container types (Map/List/Text/MovableList).
- **Field Schema**: A combination of primitive types (string, number, boolean), ignore fields, and Loro containers.
- **Schema Options (`SchemaOptions`)**:
    - **`required?: boolean`**: Whether the field is required (default: `true`).
    - **`defaultValue?: unknown`**: Default value for the field.
    - **`description?: string`**: Description of the field.
    - **`validate?: (value) => boolean | string`**: Custom validation function. Return `true` for valid values, or a string as error message for invalid ones.

#### Schema Definition API

- **Primitive Types**:
    - `schema.String<T extends string = string>(options?)` - String type with optional generic constraint
    - `schema.Number(options?)` - Number type
    - `schema.Boolean(options?)` - Boolean type
    - `schema.Ignore(options?)` - Field that won't sync with Loro, useful for local computed fields

- **Container Types**:
    - `schema.LoroMap(definition, options?)` - Object container that can nest arbitrary field schemas
        - Supports dynamic key-value definition with `catchall`: `schema.LoroMap({...}).catchall(valueSchema)`
        - Always injects a read-only `$cid` field in mirrored state equal to the underlying Loro container id. Applies uniformly to root maps, nested maps, list items, and tree node `data` maps.
    - `schema.LoroMapRecord(valueSchema, options?)` - Equivalent to `LoroMap({}).catchall(valueSchema)` for homogeneous maps
        - Entries’ mirrored state always include `$cid`.
    - `schema.LoroList(itemSchema, idSelector?, options?)` - Ordered list container
        - Providing an `idSelector` (e.g., `(item) => item.id`) enables minimal add/remove/update/move diffs
    - `schema.LoroMovableList(itemSchema, idSelector, options?)` - List with native move operations, requires an `idSelector`
    - `schema.LoroText(options?)` - Collaborative text editing container

#### Type Inference

Automatically derive strongly-typed state from your schema:

```ts
import { schema } from "loro-mirror";

type UserId = string & { __brand: "userId" };
const appSchema = schema({
    user: schema.LoroMap({
        name: schema.String(),
        age: schema.Number({ required: false }),
    }),
    tags: schema.LoroList(schema.String()),
});

// Inferred state type:
// type AppState = {
//   user: { $cid: string; name: string; age: number | undefined };
//   tags: string[];
// }
type AppState = InferType<typeof appSchema>;
```

> **Note**: If you need optional custom string types with generics (e.g., `{ status?: Status }`), explicitly define them as `schema.String<Status>({ required: false })`.

For `LoroMap` with dynamic key-value pairs:

```ts
const mapWithCatchall = schema
    .LoroMap({ fixed: schema.Number() })
    .catchall(schema.String());
// Type: { fixed: number } & { [k: string]: string }

const record = schema.LoroMapRecord(schema.Boolean());
// Type: { [k: string]: boolean }
```

When a field has `required: false`, the corresponding type becomes optional (union with `undefined`).

LoroMap and LoroMapRecord inferred types always include a `$cid: string` field. For example:

```ts
const user = schema.LoroMap({ name: schema.String() });
// InferType<typeof user> => { name: string; $cid: string }

// In lists, `$cid` is handy as a stable idSelector:
const users = schema.LoroList(user, (x) => x.$cid);
```

#### Default Values & Creation

- Explicitly specified `defaultValue` takes the highest precedence.
- Built-in defaults for fields without `defaultValue` and `required: true`:
    - **String / LoroText** → `""`
    - **Number** → `0`
    - **Boolean** → `false`
    - **LoroList** → `[]`
    - **LoroMap / Root** → Recursively aggregated defaults from child fields

#### Runtime Validation

`Mirror` validates against the schema when `validateUpdates` is enabled (default: `true`). You can also validate directly:

```ts
import { validateSchema } from "loro-mirror";

const result = validateSchema(appSchema, {
    user: { id: "u1", name: "Alice", age: 18 },
    tags: ["a", "b"],
});
// result = { valid: boolean; errors?: string[] }
```

#### Lists & Movement

- `LoroList(item, idSelector?)`: Providing an `idSelector` enables more stable add/remove/update/move diffs; otherwise uses index-based comparison.
- `LoroMovableList(item, idSelector)`: Native move operations (preserves element identity), ideal for drag-and-drop scenarios.

```ts
const todoSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap({
            text: schema.String(),
            completed: schema.Boolean({ defaultValue: false }),
        }),
        (t) => t.$cid, // stable id from Loro container id ($cid)
    ),
});
```

#### Ignored Fields

- Fields defined with `schema.Ignore()` won't sync with Loro, commonly used for derived/cached fields. Runtime validation always passes for these fields.

#### Reserved Field: `$cid`

- `$cid` is a reserved, read-only field injected into mirrored state for all `LoroMap` schemas. It equals the underlying Loro container id, is never written back to Loro, and is ignored by diffs and updates. Use it as a stable identifier where helpful (e.g., list `idSelector`).

### React Usage

```tsx
import React, { useMemo, useState } from "react";
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { createLoroContext } from "loro-mirror-react";

// Define your schema (use `$cid` from maps)
const todoSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
        }),
        (t) => t.$cid, // uses Loro container id; see "$cid" section below
    ),
});

// Create a context
const { LoroProvider, useLoroState, useLoroSelector, useLoroAction } =
    createLoroContext(todoSchema);

// Root component
function App() {
    const doc = useMemo(() => new LoroDoc(), []);

    return (
        <LoroProvider doc={doc} initialState={{ todos: [] }}>
            <TodoList />
            <AddTodoForm />
        </LoroProvider>
    );
}

// Todo list component
function TodoList() {
    const todos = useLoroSelector((state) => state.todos);
    const toggleTodo = useLoroAction((s, cid: string) => {
        const i = s.todos.findIndex((t) => t.$cid === cid);
        if (i !== -1) s.todos[i].completed = !s.todos[i].completed;
    }, []);

    return (
        <ul>
            {todos.map((todo) => (
                <li key={todo.$cid}>
                    <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => toggleTodo(todo.$cid)} // `$cid` is the Loro container id
                    />
                    <span>{todo.text}</span>
                </li>
            ))}
        </ul>
    );
}

// Add todo form component
function AddTodoForm() {
    const [text, setText] = useState("");

    const addTodo = useLoroAction(
        (state) => {
            state.todos.push({
                text: text.trim(),
                completed: false,
            });
        },
        [text],
    );

    const handleSubmit = (e) => {
        e.preventDefault();
        if (text.trim()) {
            addTodo();
            setText("");
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What needs to be done?"
            />
            <button type="submit">Add Todo</button>
        </form>
    );
}
```

## Documentation

For detailed documentation, see the README files in each package:

- [Loro Mirror Documentation](./packages/core/README.md)
- [React Documentation](./packages/react/README.md)
- [Jotai Documentation](./packages/jotai/README.md)

## Schema Overview

Loro Mirror uses a typed schema to map your app state to Loro containers. Common schema constructors:

- `schema.String(options?)`: string
- `schema.Number(options?)`: number
- `schema.Boolean(options?)`: boolean
- `schema.Ignore(options?)`: exclude from sync (app-only)
- `schema.LoroText(options?)`: rich text (`LoroText`)
- `schema.LoroMap(definition, options?)`: object (`LoroMap`)
- `schema.LoroList(itemSchema, idSelector?, options?)`: list (`LoroList`)
- `schema.LoroMovableList(itemSchema, idSelector, options?)`: movable list that emits move ops (requires `idSelector`)
- `schema.LoroTree(nodeSchema, options?)`: hierarchical tree (`LoroTree`) with per-node `data` map

Tree nodes have the shape `{ id?: string; data: T; children: Node<T>[] }`. Define a tree by passing a node `LoroMap` schema:

```ts
import { schema } from "loro-mirror";

const node = schema.LoroMap({ title: schema.String({ required: true }) });
const mySchema = schema({ outline: schema.LoroTree(node) });
```

## API Reference (Core Mirror)

### Mirror

- `new Mirror(options)`: Creates a bidirectional sync between app state and a `LoroDoc`.
    - **`doc`**: `LoroDoc` – required Loro document instance.
    - **`schema`**: root schema – optional but recommended for strong typing and validation.
    - **`initialState`**: partial state – merged with schema defaults and current doc JSON.
    - **`validateUpdates`**: boolean (default `true`) – validate new state against schema.
    - **`throwOnValidationError`**: boolean (default `false`) – throw on invalid updates.
    - **`debug`**: boolean (default `false`) – log diffs and applied changes.
    - **`inferOptions`**: `{ defaultLoroText?: boolean; defaultMovableList?: boolean }` – influence container-type inference when inserting containers from plain values.

- `getState(): State`: Returns the current in-memory state view.
- `setState(updater, options?)`: Update state and sync to Loro.
    - **`updater`**: either a partial object to shallow-merge or a function that may mutate a draft (Immer-style) or return a new state object.
    - **`options`**: `{ tags?: string | string[] }` – arbitrary tags attached to this update; delivered to subscribers in metadata.
- `subscribe(callback): () => void`: Subscribe to state changes. `callback` receives `(state, metadata)` where `metadata` includes:
    - **`direction`**: `SyncDirection` – `FROM_LORO` when changes came from the doc, `TO_LORO` when produced locally, `BIDIRECTIONAL` for manual/initial syncs.
    - **`tags`**: `string[] | undefined` – tags provided via `setState`.
- `dispose()`: Unsubscribe internal listeners and clear subscribers.

#### Notes

- **Lists and IDs**: If your list schema provides an `idSelector`, list updates use minimal add/remove/update/move operations; otherwise index-based diffs are applied.
- **Container inference**: When schema is missing/ambiguous for a field, the mirror infers container types from values. `inferOptions.defaultLoroText` makes strings become `LoroText`; `inferOptions.defaultMovableList` makes arrays become `LoroMovableList`.

### Types

- `SyncDirection`:
    - `FROM_LORO` – applied due to incoming `LoroDoc` changes
    - `TO_LORO` – applied due to local `setState`
    - `BIDIRECTIONAL` – initial/manual sync context
- `UpdateMetadata`: `{ direction: SyncDirection; tags?: string[] }`
- `SetStateOptions`: `{ tags?: string | string[] }`

### Example

```ts
import { LoroDoc } from "loro-crdt";
import { Mirror, schema, SyncDirection } from "loro-mirror";

const todoSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
        }),
        (t) => t.$cid, // stable id from Loro container id ($cid)
    ),
});

const doc = new LoroDoc();
const mirror = new Mirror({ doc, schema: todoSchema, validateUpdates: true });

// Subscribe with metadata
const unsubscribe = mirror.subscribe((state, { direction, tags }) => {
    if (direction === SyncDirection.FROM_LORO) {
        console.log("Remote update", tags);
    } else {
        console.log("Local update", tags);
    }
});

// Update with draft mutation + tags
mirror.setState(
    (s) => {
        s.todos.push({
            text: "Write docs",
            completed: false,
        });
    },
    { tags: ["ui:add"] },
);

### How `$cid` Works

- Every Loro container has a stable container ID provided by Loro (e.g., a map’s `container.id`).
- For any `schema.LoroMap(...)`, Mirror injects a read-only `$cid` field into the mirrored state that equals the underlying Loro container ID.
- `$cid` lives only in the app state and is never written back to the document. Mirror uses it for efficient diffs; you can use it as a stable list selector: `schema.LoroList(item, (x) => x.$cid)`.

// Cleanup
unsubscribe();
mirror.dispose();
```

## License

MIT
