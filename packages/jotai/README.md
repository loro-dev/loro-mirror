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
    },
    { withCid: true },
)
// Define your schema
const todoDocSchema = schema({
    todos: schema.LoroList(
        todoSchema,
        (t) => t.$cid, // stable id from Loro container id
    )
});

// Auto generated type from schema
type Todo = InferType<typeof todoSchema>;

// Create a Loro document instance
const doc = new LoroDoc();

// Maybe subscribe the doc for persisting
let sub = doc.subscribe(......)

// Create the Jotai atom with Loro Mirror config
// Optionally pass onError to handle async failures
const todoDocAtom = loroMirrorAtom({
    doc,
    schema: todoDocSchema,
    initialState: { todos: [] as Todo[] },
    // onError: (err) => console.error('update failed', err),
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
        {state.todos.map((todo) => (
          <li key={todo.$cid /* stable key from Loro container id */}>
            {todo.text}: {todo.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Async behavior

- The setter returned by `useAtom(loroMirrorAtom(...))` returns a Promise. Await
  it when you need deterministic ordering or to handle validation/consistency
  errors.
- You can also pass `onError` in the atom config to catch rejections centrally.

### About `$cid`

- `$cid` is always present on `LoroMap` state and equals the underlying Loro
  container id.
- Use `$cid` as a stable list selector and React key:
  `schema.LoroList(item, x => x.$cid)` and `<li key={todo.$cid}>`.

## License

[MIT](./LICENSE)
