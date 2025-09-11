# Loro Mirror: Make UI State Collaborative by Mirroring to CRDTs

Loro is a high‑performance CRDT engine for local‑first apps. It merges concurrent edits without conflicts, works offline with later sync, and provides versioning/time‑travel plus compact updates and snapshots across rich containers (Text, Map, List/MovableList, Tree).

However, wiring Loro to application state typically involves a lot of repetitive boilerplate (mapping state, diffing changes, handling event deltas).

Loro Mirror makes bidirectional sync between your App State and the Loro document effortless. Keep your normal React setState patterns; Mirror computes minimal CRDT deltas for local edits and applies remote event deltas back to state. You get live collaboration, offline edits, and history you can travel through.

## Why

Teams building on Loro often end up writing the same glue code: mapping Loro (CRDT) state into app state, diffing app‑state edits back into minimal CRDT updates, and applying Loro events as deltas to update app state. CRDTs guarantee convergence between documents, but they don’t keep your app state in sync with the CRDT document. That consistency boundary is exactly what Loro Mirror addresses.

- Declarative mapping: define a schema once; Mirror keeps an immutable app‑state view in sync with your Loro document.
- Event → state: Loro events automatically update the immutable state.
- State → CRDT: setState diffs are turned into minimal CRDT changesets (insert/delete/move/text edits) — no manual patching.
- Keep your habits: continue using familiar React setState/hooks (and similar patterns elsewhere); Mirror handles the deltas.
- Scales with change, not size: work is O(km), where k is the number of changed items and m is the average number of child elements per item; avoids full‑state traversals and matches React‑style render complexity.

## How to use

1. 声明 schema
2. 绑定 loro 文档和 Loro Mirror
3. 通过 setState 更新状态，通过 subscribe 获取状态（或者通过 loro-mirror-react 的 hook 完成）
4. 实时协作就被支持啦！

---

TODO: Example here

### Basic Example

TODO:

### React Example

```tsx
import React, { useMemo } from "react";
import { LoroDoc } from "loro-crdt";
import { schema } from "loro-mirror";
import { useLoroStore } from "loro-mirror-react";

type TodoStatus = "todo" | "inProgress" | "done";

const todoSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true }, // inject stable `$cid` from Loro
        ),
        (t) => t.$cid,
    ),
});

export function TodoApp() {
    const doc = useMemo(() => new LoroDoc(), []);
    const { state, setState } = useLoroStore({
        doc,
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
                    <li key={t.$cid}>
                        <input
                            value={t.text}
                            onChange={(e) =>
                                setState((s) => {
                                    const i = s.todos.findIndex(
                                        (x) => x.$cid === t.$cid,
                                    );
                                    // Text delta will be calculated automatically
                                    if (i !== -1)
                                        s.todos[i].text = e.target.value;
                                })
                            }
                        />
                        <select
                            value={t.status}
                            onChange={(e) =>
                                setState((s) => {
                                    const i = s.todos.findIndex(
                                        (x) => x.$cid === t.$cid,
                                    );
                                    if (i !== -1)
                                        s.todos[i].status = e.target
                                            .value as TodoStatus;
                                })
                            }
                        >
                            <option value="todo">Todo</option>
                            <option value="inProgress">In Progress</option>
                            <option value="done">Done</option>
                        </select>
                    </li>
                ))}
            </ul>
        </>
    );
}
```

Tiny Undo/Redo (React)

```tsx
import { UndoManager } from "loro-crdt";

// Inside the same component, after creating `doc`:
const undo = useMemo(() => new UndoManager(doc), [doc]);

// Add controls anywhere in your UI:
<div>
    <button onClick={() => undo.undo()}>Undo</button>
    <button onClick={() => undo.redo()}>Redo</button>
    {/* UndoManager only reverts your local edits; remote edits stay. */}
    {/* See docs: https://loro.dev/docs/advanced/undo */}
    {/* For full time travel, see: https://loro.dev/docs/tutorial/time_travel */}
</div>;
```

What you get

- Type-safe, framework-agnostic state
- Each mutation becomes a minimal change-set (CRDT delta)—no manual diffing
- Fine-grained updates to subscribers for fast, predictable renders
- [Built-in history and time travel](https://loro.dev/docs/tutorial/time_travel)
- [Offline-first sync](https://loro.dev/docs/tutorial/sync) via updates or snapshots with deterministic conflict resolution over any transport (HTTP, WebSocket, P2P)
- [Collaborative undo/redo](https://loro.dev/docs/advanced/undo) across clients

## Future

- 因为和 App state 的双向映射也由我们完成，所以我们能够交付更多价值了，用户的使用成本也更低
    - 例如对 LoroText 的分行格式的支持。在 App State 上常常需要将文本拆分成行来渲染，但是 LoroText 提供的接口是 index-based 的，这需要用户自行进行额外的转换。而我们的数据结构通过简单调整就可以生成基于 line-based 的事件。但这些优化在缺少 loro-mirror 配合时所带来的价值就并不高，因为用户要去学习使用这样的特殊 diff 结构的成本很高。
    - 例如 LoroTree 会变得好用得多，因为用户不用关心如何转换事件到 app state 上执行 diff
    - 例如我们也可以在 List 上支持 Slice 的行为来支持 UI 上的虚拟滚动
- 如果对你的工作有帮助，请考虑 sponsor 我们
