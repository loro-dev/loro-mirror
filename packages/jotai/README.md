# Loro Mirror for Jotai

Jotai integration for Loro Mirror, providing atomic state management with Loro CRDT synchronization. 

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

Create a `loroMirrorAtom` to represent your shared state. It syncs automatically with the provided Loro document.

```tsx
import { useAtom } from 'jotai';
import { LoroDoc } from 'loro-crdt';
import { schema } from 'loro-mirror';
import { loroMirrorAtom } from 'loro-mirror-jotai';

type TodoStatus = "todo" | "inProgress" | "done";

// 1. Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      text: schema.String(),
      status: schema.String<TodoStatus>()
    }),
    (t) => t.$cid, // stable id from Loro container id
  ),
});

// 2. Create a Loro document instance
const doc = new LoroDoc();

// 3. Create the Jotai atom with Loro Mirror config
const todoAtom = loroMirrorAtom({
  doc,
  schema: todoSchema,
  initialState: { todos: [] },
});

// 4. Use it in your React component
function TodoApp() {
  const [state, setState] = useAtom(todoAtom);

  const addTodo = () => {
    setState((prevState) => ({
      todos: [
        ...prevState.todos,
        {
          text: 'New Todo',
          status: "todo",
        },
      ],
    }));
  };

  return (
    <div>
      <button onClick={addTodo}>Add Todo</button>
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

### About `$cid`

- `$cid` is always present on `LoroMap` state and equals the underlying Loro container id.
- Use `$cid` as a stable list selector and React key: `schema.LoroList(item, x => x.$cid)` and `<li key={todo.$cid}>`.

## License

[MIT](./LICENSE)
