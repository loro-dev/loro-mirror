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

// 1. Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String(),
      text: schema.String(),
      completed: schema.Boolean({ defaultValue: false }),
    }),
  ),
});

// 2. Create a Loro document instance
const doc = new LoroDoc();

// 3. Create the Jotai atom with Loro Mirror config
const todoAtom = loroMirrorAtom({
  doc,
  schema: todoSchema,
  key: 'todos', // A unique key for this state
  initialState: { todos: [] },
});

// 4. Use it in your React component
function TodoApp() {
  const [state, setState] = useAtom(todoAtom);

  const addTodo = () => {
    setState((prevState) => ({
      ...prevState,
      todos: [
        ...prevState.todos,
        {
          id: `${Date.now()}`,
          text: 'New Todo',
          completed: false,
        },
      ],
    }));
  };

  return (
    <div>
      <button onClick={addTodo}>Add Todo</button>
      <ul>
        {state.todos.map((todo) => (
          <li key={todo.id} style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## License

[MIT](./LICENSE)
