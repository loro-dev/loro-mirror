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

For high-frequency temporary changes, use `loroMirrorAtoms` (instead of `loroMirrorAtom`) to get ephemeral patch support:

```tsx
import { EphemeralStore } from 'loro-crdt';
import { loroMirrorAtoms } from 'loro-mirror-jotai';

const { stateAtom, ephemeralAtom, finalizeAtom } = loroMirrorAtoms({
    doc,
    schema: canvasSchema,
    ephemeralStore: new EphemeralStore(),
});

function Canvas() {
    const [state] = useAtom(stateAtom);
    const ephemeralUpdate = useSetAtom(ephemeralAtom);
    const finalize = useSetAtom(finalizeAtom);

    const onDrag = (x: number, y: number) => {
        ephemeralUpdate({
            updater: (s) => { s.items[0].x = x; s.items[0].y = y; },
            options: { finalizeTimeout: 1_000 },
        });
    };

    const onDragEnd = () => finalize();
}
```

- `stateAtom` — same read/write atom as `loroMirrorAtom` returns; reflects both LoroDoc and ephemeral state
- `ephemeralAtom` — write-only; routes eligible changes through EphemeralStore
- `finalizeAtom` — write-only; commits pending ephemeral patches to LoroDoc

## License

[MIT](./LICENSE)
