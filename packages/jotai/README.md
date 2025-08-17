# Loro Mirror Jotai

Jotai integration for Loro Mirror - 基于原子化状态管理的 Loro CRDT 同步库

## 特性

- 🎯 **原子化状态管理** - 遵循 Jotai 的 bottom-up 哲学，每个状态片段都是独立的原子
- 🔄 **CRDT 同步** - 利用 Loro 的 CRDT 功能实现实时协作
- ⚡ **细粒度更新** - 只有相关的组件会在状态变化时重新渲染
- 🎛️ **灵活的组合** - 可以轻松组合不同的原子来构建复杂的状态逻辑
- 💾 **持久化支持** - 内置 localStorage 等持久化存储支持
- 🔧 **完整的 TypeScript 支持** - 类型安全的状态管理

## 安装

```bash
npm install @loro-mirror/jotai @loro-mirror/core loro-crdt jotai
# or
pnpm add @loro-mirror/jotai @loro-mirror/core loro-crdt jotai
```

## 基础用法

### 创建 Loro 原子

```tsx
import { LoroDoc } from 'loro-crdt';
import { schema } from '@loro-mirror/core';
import { loroAtom, useAtom } from '@loro-mirror/jotai';

// 定义 schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
    })
  ),
  filter: schema.String({ defaultValue: 'all' }),
});

// 创建 Loro 文档和原子
const doc = new LoroDoc();
const todoAtom = loroAtom({
  doc,
  schema: todoSchema,
  initialState: { todos: [], filter: 'all' },
  key: 'todos'
});

function TodoApp() {
  const [state, setState] = useAtom(todoAtom);
  
  return (
    <div>
      <h1>Todo App</h1>
      <p>Total todos: {state.todos.length}</p>
      <button 
        onClick={() => setState(prev => ({
          ...prev,
          todos: [...prev.todos, {
            id: Date.now().toString(),
            text: 'New Todo',
            completed: false
          }]
        }))}
      >
        Add Todo
      </button>
    </div>
  );
}
```

### 选择性订阅

使用 `loroSelect` 创建派生原子，只订阅状态的特定部分：

```tsx
import { loroSelect, useAtomValue } from '@loro-mirror/jotai';

// 只订阅 todos 列表
const todosAtom = loroSelect(todoAtom, (state) => state.todos);

// 只订阅过滤条件
const filterAtom = loroSelect(todoAtom, (state) => state.filter);

function TodoList() {
  const todos = useAtomValue(todosAtom); // 只在 todos 变化时重新渲染
  
  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}

function FilterControls() {
  const filter = useAtomValue(filterAtom); // 只在 filter 变化时重新渲染
  
  return (
    <div>
      Current filter: {filter}
    </div>
  );
}
```

### 聚焦特定路径

使用 `loroFocus` 创建聚焦于状态树特定路径的原子：

```tsx
import { loroFocus, useAtom } from '@loro-mirror/jotai';

// 聚焦第一个 todo 项目
const firstTodoAtom = loroFocus(
  todoAtom,
  // getter: 从状态中提取值
  (state) => state.todos[0],
  // setter: 更新状态中的值
  (state, newTodo) => ({
    ...state,
    todos: state.todos.map((todo, index) => 
      index === 0 ? newTodo : todo
    )
  })
);

function FirstTodoEditor() {
  const [todo, setTodo] = useAtom(firstTodoAtom);
  
  if (!todo) return <div>No todos</div>;
  
  return (
    <div>
      <input 
        value={todo.text}
        onChange={e => setTodo({ ...todo, text: e.target.value })}
      />
      <label>
        <input 
          type="checkbox"
          checked={todo.completed}
          onChange={e => setTodo({ ...todo, completed: e.target.checked })}
        />
        Completed
      </label>
    </div>
  );
}
```

### 动作原子

使用 `loroAction` 创建封装业务逻辑的动作原子：

```tsx
import { loroAction, useSetAtom } from '@loro-mirror/jotai';

// 添加 todo 的动作
const addTodoAtom = loroAction(todoAtom, (get, set, text: string) => {
  const currentState = get(todoAtom);
  set(todoAtom, {
    ...currentState,
    todos: [...currentState.todos, {
      id: Date.now().toString(),
      text,
      completed: false,
    }]
  });
});

// 切换 todo 完成状态的动作
const toggleTodoAtom = loroAction(todoAtom, (get, set, id: string) => {
  const currentState = get(todoAtom);
  set(todoAtom, {
    ...currentState,
    todos: currentState.todos.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    )
  });
});

function TodoControls() {
  const addTodo = useSetAtom(addTodoAtom);
  const toggleTodo = useSetAtom(toggleTodoAtom);
  
  return (
    <div>
      <button onClick={() => addTodo('New task')}>
        Add Todo
      </button>
      <button onClick={() => toggleTodo('todo-id')}>
        Toggle Todo
      </button>
    </div>
  );
}
```

### 原子族

使用 `loroAtomFamily` 为动态集合创建原子族：

```tsx
import { loroAtomFamily, useAtomValue } from '@loro-mirror/jotai';

// 为每个 todo 创建单独的原子
const todoItemFamily = loroAtomFamily((id: string) => 
  loroSelect(todoAtom, (state) => 
    state.todos.find(todo => todo.id === id)
  )
);

function TodoItem({ id }: { id: string }) {
  const todo = useAtomValue(todoItemFamily(id));
  
  if (!todo) return null;
  
  return (
    <div>
      <span>{todo.text}</span>
      {todo.completed && <span> ✓</span>}
    </div>
  );
}
```

### 同步控制

使用 `loroSync` 进行手动同步控制：

```tsx
import { loroSync, useSetAtom } from '@loro-mirror/jotai';

const syncAtom = loroSync({
  doc,
  schema: todoSchema,
  key: 'todos'
});

function SyncControls() {
  const sync = useSetAtom(syncAtom);
  
  return (
    <div>
      <button onClick={() => sync('fromLoro')}>
        从 Loro 同步
      </button>
      <button onClick={() => sync('toLoro')}>
        同步到 Loro
      </button>
      <button onClick={() => sync('bidirectional')}>
        双向同步
      </button>
    </div>
  );
}
```

### 持久化

使用 `loroPersistent` 添加本地存储持久化：

```tsx
import { loroPersistent } from '@loro-mirror/jotai';

const persistentTodoAtom = loroPersistent({
  doc,
  schema: todoSchema,
  initialState: { todos: [], filter: 'all' },
  key: 'persistent-todos',
  storage: localStorage, // 可选，默认使用 localStorage
});

function PersistentTodoApp() {
  const [state, setState] = useAtom(persistentTodoAtom);
  
  // 状态会自动保存到 localStorage 并在页面刷新后恢复
  return (
    <div>
      <h1>Persistent Todo App</h1>
      {/* ... */}
    </div>
  );
}
```

### 高级用法：响应式原子

使用 `loroReactive` 创建响应式原子，自动响应底层 Loro 文档的变化：

```tsx
import { loroReactive } from '@loro-mirror/jotai';

const reactiveTodoAtom = loroReactive({
  doc,
  schema: todoSchema,
  initialState: { todos: [], filter: 'all' },
  key: 'reactive-todos',
  debug: true // 启用调试模式
});

function ReactiveTodoApp() {
  const [state, setState] = useAtom(reactiveTodoAtom);
  
  // 当其他客户端修改 Loro 文档时，这个组件会自动重新渲染
  return (
    <div>
      <h1>Reactive Todo App</h1>
      {/* ... */}
    </div>
  );
}
```

## API 参考

### `loroAtom(config)`
创建主要的 Loro 状态原子

### `loroSelect(baseAtom, selector)`
创建派生原子，选择状态的特定部分

### `loroFocus(baseAtom, getter, setter)`
创建聚焦于状态特定路径的原子

### `loroAction(baseAtom, actionFn)`
创建封装业务逻辑的动作原子

### `loroAtomFamily(atomCreator)`
创建原子族，用于动态集合管理

### `loroSync(config)`
创建同步控制原子

### `loroPersistent(config)`
创建带持久化的原子

### `loroReactive(config)`
创建响应式原子

### Hooks

- `useLoroDoc(config)` - 获取底层 Loro 文档
- `useLoroMirror(config)` - 获取底层 Mirror 实例

## 最佳实践

1. **原子粒度**: 根据组件的需求创建适当粒度的原子，避免过度细分或过于粗糙
2. **选择性订阅**: 使用 `loroSelect` 只订阅组件实际需要的状态部分
3. **动作封装**: 使用 `loroAction` 封装复杂的状态更新逻辑
4. **原子族**: 对于动态列表，使用原子族可以获得更好的性能
5. **持久化**: 在需要离线支持的应用中使用 `loroPersistent`

## 与 React 包的对比

| 特性 | React 包 | Jotai 包 |
|------|----------|----------|
| 状态管理哲学 | 组件级状态 | 原子化状态 |
| 重新渲染优化 | 手动优化 | 自动细粒度更新 |
| 状态组合 | Context 提供者 | 原子组合 |
| 学习曲线 | React 开发者友好 | 需要了解 Jotai 概念 |
| 性能 | 取决于使用方式 | 更好的细粒度控制 |

选择 Jotai 包如果你：
- 喜欢原子化的状态管理方式
- 需要更细粒度的重新渲染控制
- 想要更灵活的状态组合能力
- 已经在项目中使用 Jotai

选择 React 包如果你：
- 更熟悉传统的 React 状态管理
- 需要更简单的上手体验
- 项目中已有基于 Context 的状态管理模式