# Loro Mirror Core

Core functionality for Loro Mirror - a state management library with Loro CRDT synchronization.

## Installation

```bash
npm install @loro-mirror/core loro-crdt
# or
yarn add @loro-mirror/core loro-crdt
# or
pnpm add @loro-mirror/core loro-crdt
```

## Usage

```typescript
import { LoroDoc } from 'loro-crdt';
import { schema, createStore } from '@loro-mirror/core';

// Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
    }),
    // ID selector for the list items
    (item) => item.id
  ),
  filter: schema.String({ defaultValue: 'all' }),
});

// Create a Loro document
const doc = new LoroDoc();

// Create a store
const store = createStore({
  doc,
  schema: todoSchema,
  initialState: { todos: [], filter: 'all' },
});

// Get the current state
const state = store.getState();

// Update the state
store.setState((state) => {
  state.todos.push({
    id: Date.now().toString(),
    text: 'Learn Loro Mirror',
    completed: false,
  });
  return state;
});

// Subscribe to state changes
const unsubscribe = store.subscribe((state, direction) => {
  console.log('State updated:', state);
  console.log('Update direction:', direction);
});

// Sync with Loro
store.syncFromLoro(); // Sync from Loro to application state
store.syncToLoro();   // Sync from application state to Loro
store.sync();         // Full bidirectional sync
```

## Schema System

Loro Mirror includes a powerful schema system for defining the structure of your state.

### Basic Types

```typescript
import { schema } from '@loro-mirror/core';

const userSchema = schema({
  // Basic types
  name: schema.String({ required: true }),
  age: schema.Number({ defaultValue: 0 }),
  isActive: schema.Boolean({ defaultValue: true }),
  
  // Fields to ignore (not synced with Loro)
  localOnly: schema.Ignore(),
  
  // Loro specific types
  bio: schema.LoroText(), // Rich text
  
  // Nested objects
  profile: schema.LoroMap({
    avatar: schema.String(),
    website: schema.String(),
  }),
  
  // Arrays
  tags: schema.LoroList(
    schema.String(),
    // Optional ID selector for list items
    (item) => item
  ),
  
  // Complex nested structures
  posts: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      title: schema.String({ required: true }),
      content: schema.LoroText(),
      published: schema.Boolean({ defaultValue: false }),
      tags: schema.LoroList(schema.String()),
    }),
    // ID selector for list items
    (post) => post.id
  ),
});
```

### Schema Options

Each schema type accepts options:

```typescript
schema.String({
  // Whether the field is required
  required: true,
  
  // Default value
  defaultValue: '',
  
  // Description
  description: 'User name',
  
  // Custom validation function
  validate: (value) => {
    if (value.length < 3) {
      return 'Name must be at least 3 characters';
    }
    return true;
  },
});
```

## API Reference

### `schema`

Function to create a schema definition.

```typescript
const mySchema = schema({
  // Schema definition
});
```

### Schema Types

- `schema.String(options?)` - String type
- `schema.Number(options?)` - Number type
- `schema.Boolean(options?)` - Boolean type
- `schema.Ignore(options?)` - Field to ignore (not synced with Loro)
- `schema.LoroText(options?)` - Loro rich text
- `schema.LoroMap(definition, options?)` - Loro map (object)
- `schema.LoroList(itemSchema, idSelector?, options?)` - Loro list (array)

### `createStore`

Creates a store with the given options.

```typescript
const store = createStore({
  doc: loroDoc,
  schema: mySchema,
  initialState: initialState,
  validateUpdates: true,
  throwOnValidationError: false,
  debug: false,
});
```

### Store API

- `getState()` - Get the current state
- `setState(updater)` - Update the state
- `subscribe(callback)` - Subscribe to state changes
- `syncFromLoro()` - Sync from Loro to application state
- `syncToLoro()` - Sync from application state to Loro
- `sync()` - Full bidirectional sync
- `getMirror()` - Get the underlying Mirror instance

### `createReducer`

Creates a reducer function for handling actions.

```typescript
const todoReducer = createReducer({
  addTodo: (state, payload: { text: string }) => {
    state.todos.push({
      id: Date.now().toString(),
      text: payload.text,
      completed: false,
    });
  },
  toggleTodo: (state, payload: { id: string }) => {
    const todoIndex = state.todos.findIndex(todo => todo.id === payload.id);
    if (todoIndex !== -1) {
      state.todos[todoIndex].completed = !state.todos[todoIndex].completed;
    }
  },
  // More actions...
});

// Usage with a store
const dispatch = todoReducer(store);
dispatch.addTodo({ text: 'Learn Loro Mirror' });
dispatch.toggleTodo({ id: '123' });
```

## License

MIT 
