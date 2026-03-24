# Loro Mirror for Jotai

Jotai integration for Loro Mirror, providing atomic state management with Loro
CRDT synchronization.

## Installation

```bash
# Using pnpm
pnpm add loro-mirror-jotai jotai loro-crdt

# Using npm
npm install loro-mirror-jotai jotai loro-crdt

# Using yarn
yarn add loro-mirror-jotai jotai loro-crdt
```

## Usage

Create a `loroMirrorAtom` to represent your shared state. It syncs automatically
with the provided Loro document.

```tsx
import { useAtom } from 'jotai';
import { LoroDoc } from 'loro-crdt';
import { schema } from 'loro-mirror';
import { loroMirrorAtom } from 'loro-mirror-jotai';

type TodoStatus = "todo" | "inProgress" | "done";

const todoSchema = schema.LoroMap(
    {
        text: schema.String(),
        status: schema.String<TodoStatus>()
    }
)
// Define your schema
const todoDocSchema = schema({
    todos: schema.LoroList(
        todoSchema,
        (t) => t.$cid, // stable LoroMap id from Loro container id
    )
});

// Auto generated type from schema
type Todo = InferType<typeof todoSchema>;

// Create a Loro document instance
const doc = new LoroDoc();

// Maybe subscribe the doc for persisting
let sub = doc.subscribe(......)

// Create the Jotai atom with Loro Mirror config
const todoDocAtom = loroMirrorAtom({
    doc,
    schema: todoDocSchema,
    initialState: { todos: [] as Todo[] },
});

// Selector atom
const todosAtom = atom(get => get(todoDocAtom).todos, (_get, set, todos: Todo[]) => {
    set(todoDocAtom, { todos })
})

// Action atom
const addTodoAtom = atom(null, (get, set, todo: Todo) => {
    set(todosAtom, [...get(todosAtom), todo])
})

// Use it in your React component
function TodoApp() {
  const todos = useAtomValue(todosAtom);
  const addTodo = useSetAtom(addTodoAtom);

  return (
    <div>
      <button onClick={()=>{
        addTodo({text: "New todo", status: "todo"})
      }}>Add Todo</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.$cid /* stable key from Loro container id */}>
            {todo.text}: {todo.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### About `$cid`

- `$cid` is always present on `LoroMap` state and equals the underlying Loro
  container id.
- Use `$cid` as a stable list selector and React key:
  `schema.LoroList(item, x => x.$cid)` and `<li key={todo.$cid}>`.

### Ephemeral Patches

For high-frequency temporary changes, use `loroMirrorAtoms` (instead of `loroMirrorAtom`) to get a `finalizeAtom` alongside the state atom. Pass `ephemeralStore` and the write side of `stateAtom` automatically routes eligible changes (primitive values on existing Map keys) through EphemeralStore instead of LoroDoc. No separate atom is needed for ephemeral vs persistent updates.

```tsx
import { EphemeralStore } from 'loro-crdt';
import { loroMirrorAtoms } from 'loro-mirror-jotai';

const { stateAtom, finalizeAtom } = loroMirrorAtoms({
    doc,
    schema: canvasSchema,
    ephemeralStore: new EphemeralStore(), // ← changes how writes work
});

function Canvas() {
    const [state, setState] = useAtom(stateAtom);
    const finalize = useSetAtom(finalizeAtom);

    const onDrag = (x: number, y: number) => {
        // x/y are primitives on existing keys → EphemeralStore
        // No LoroDoc history for intermediate positions
        setState({ x, y });
    };

    const onDragEnd = () => finalize(); // commit to LoroDoc
}
```

Without `ephemeralStore`, `setState` writes everything to LoroDoc as usual.

- `stateAtom` — read/write atom; reads return composed state (`LoroDoc + EphemeralStore overlay`); writes go through ephemeral routing when `ephemeralStore` is configured
- `finalizeAtom` — write-only; commits pending ephemeral patches to LoroDoc

See the [core package README](../core/README.md#ephemeral-patches) for routing rules and finalization details.

## License

[MIT](./LICENSE)
