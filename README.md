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

## Installation

### Core Package

```bash
npm install loro-mirror loro-crdt
# or
yarn add loro-mirror loro-crdt
# or
pnpm add loro-mirror loro-crdt
```

### React Package

```bash
npm install loro-mirror-react loro-mirror loro-crdt
# or
yarn add loro-mirror-react loro-mirror loro-crdt
# or
pnpm add loro-mirror-react loro-mirror loro-crdt
```

## Quick Start

### Core Usage

```typescript
import { LoroDoc } from "loro-crdt";
import { schema, createStore } from "loro-mirror";

// Define your schema
const todoSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({
            id: schema.String({ required: true }),
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
        }),
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
            id: Date.now().toString(),
            text: "Learn Loro Mirror",
            completed: false,
        },
    ],
}));

// Or: draft-style updates (mutate a draft)
store.setState((state) => {
    state.todos.push({
        id: Date.now().toString(),
        text: "Learn Loro Mirror",
        completed: false,
    });
    // no return needed
});

// Subscribe to state changes
store.subscribe((state) => {
    console.log("State updated:", state);
});
```

### React Usage

```tsx
import React, { useMemo, useState } from "react";
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { createLoroContext } from "loro-mirror-react";

// Define your schema
const todoSchema = schema({
    todos: schema.LoroList(
        schema.LoroMap({
            id: schema.String({ required: true }),
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
        }),
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
    const toggleTodo = useLoroAction((s, id: string) => {
        const i = s.todos.findIndex((t) => t.id === id);
        if (i !== -1) s.todos[i].completed = !s.todos[i].completed;
    }, []);

    return (
        <ul>
            {todos.map((todo) => (
                <li key={todo.id}>
                    <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => toggleTodo(todo.id)}
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
                id: Date.now().toString(),
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

- [Core Documentation](./packages/core/README.md)
- [React Documentation](./packages/react/README.md)

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
            id: schema.String({ required: true }),
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
        }),
        (t) => t.id,
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
            id: Date.now().toString(),
            text: "Write docs",
            completed: false,
        });
    },
    { tags: ["ui:add"] },
);

// Cleanup
unsubscribe();
mirror.dispose();
```

## License

MIT
