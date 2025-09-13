import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { LoroDoc, UndoManager, LORO_VERSION } from "loro-crdt";
import { schema } from "loro-mirror";
import { useLoroStore } from "loro-mirror-react";

type TodoStatus = "todo" | "done";

const todoSchema = schema({
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true },
        ),
        (t) => t.$cid,
    ),
});

export function App() {
    const doc = useMemo(() => {
        const doc = new LoroDoc();
        doc.setRecordTimestamp(true);
        doc.setChangeMergeInterval(10);
        return doc;
    }, []);
    (window as any).doc = doc;
    const undo = useMemo(() => new UndoManager(doc, {}), [doc]);

    const { state, setState } = useLoroStore({
        doc,
        schema: todoSchema,
        initialState: { todos: [] },
    });

    const [newText, setNewText] = useState<string>("");
    const [dragCid, setDragCid] = useState<string | null>(null);
    const [insertIndex, setInsertIndex] = useState<number | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    function addTodo(text: string) {
        if (!text.trim()) return;
        void setState((s) => {
            s.todos.push({ text, status: "todo" });
        });
        setNewText("");
    }

    const handleTextChange = useCallback(
        (cid: string, value: string) => {
            void setState((s) => {
                const i = s.todos.findIndex((x) => x.$cid === cid);
                if (i !== -1) s.todos[i].text = value;
            });
        },
        [setState],
    );

    const handleDoneChange = useCallback(
        (cid: string, done: boolean) => {
            void setState((s) => {
                const i = s.todos.findIndex((x) => x.$cid === cid);
                if (i !== -1) s.todos[i].status = done ? "done" : "todo";
            });
        },
        [setState],
    );

    const handleDragStart = useCallback((cid: string) => {
        setDragCid(cid);
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragCid(null);
        setInsertIndex(null);
    }, []);

    const updateInsertIndexFromPointer = useCallback(
        (clientY: number) => {
            const ul = listRef.current;
            if (!ul) return;
            const items = Array.from(
                ul.querySelectorAll<HTMLLIElement>("li.todo-item"),
            );
            if (items.length === 0) {
                setInsertIndex(0);
                return;
            }
            const filtered = items.filter(
                (el) => !el.classList.contains("dragging"),
            );
            // default to end of the full list (after last item)
            let idx = state.todos.length;
            for (let i = 0; i < filtered.length; i++) {
                const rect = filtered[i].getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (clientY < midpoint) {
                    // insert before this element's current index in the full list
                    const cid = filtered[i].dataset.cid;
                    const realIndex = state.todos.findIndex(
                        (t) => t.$cid === cid,
                    );
                    idx = realIndex === -1 ? i : realIndex;
                    break;
                }
            }
            setInsertIndex(idx);
        },
        [state.todos],
    );

    const handleListDragOver = useCallback(
        (e: React.DragEvent<HTMLUListElement>) => {
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
        },
        [updateInsertIndexFromPointer],
    );

    const commitDrop = useCallback(() => {
        if (!dragCid || insertIndex == null) return;
        void setState((s) => {
            const from = s.todos.findIndex((x) => x.$cid === dragCid);
            if (from === -1) return;
            let to = insertIndex;
            if (from < to) to = Math.max(0, to - 1);
            to = Math.min(Math.max(0, to), s.todos.length);
            if (from === to) return;
            const [item] = s.todos.splice(from, 1);
            s.todos.splice(to, 0, item);
        });
        setDragCid(null);
        setInsertIndex(null);
    }, [dragCid, insertIndex, setState]);

    const handleListDrop = useCallback(
        (e?: React.DragEvent<HTMLUListElement>) => {
            e?.preventDefault();
            commitDrop();
        },
        [commitDrop],
    );

    // Global dragover/drop to handle dropping outside the list bounds
    useEffect(() => {
        if (!dragCid) return;
        const onDragOver = (e: DragEvent) => {
            // allow dropping anywhere by canceling default
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
        };
        const onDrop = (e: DragEvent) => {
            e.preventDefault();
            updateInsertIndexFromPointer(e.clientY);
            // small timeout to ensure insertIndex state updates if needed
            requestAnimationFrame(() => commitDrop());
        };
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("drop", onDrop);
        };
    }, [dragCid, updateInsertIndexFromPointer, commitDrop]);

    return (
        <div className="app">
            <header className="app-header">
                <h1>Loro Mirror Todo</h1>
                <p className="subtitle">
                    Collaborative-ready todos with Loro + React
                </p>
            </header>

            <div className="new-todo">
                <input
                    className="todo-input"
                    placeholder="Add a todo..."
                    value={newText}
                    onChange={(e) => {
                        setNewText(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") addTodo(newText);
                    }}
                />
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        addTodo(newText);
                    }}
                >
                    Add
                </button>
            </div>

            <div className="toolbar">
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        undo.undo();
                    }}
                    disabled={!undo.canUndo?.()}
                >
                    <span className="btn-icon" aria-hidden>⟲</span>
                    Undo
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        undo.redo();
                    }}
                    disabled={!undo.canRedo?.()}
                >
                    <span className="btn-icon" aria-hidden>⟳</span>
                    Redo
                </button>
            </div>

            <ul
                className="todo-list"
                ref={listRef}
                onDragOver={handleListDragOver}
                onDrop={handleListDrop}
            >
                {state.todos.map((t, i) => {
                    const isInsertTop =
                        insertIndex != null && insertIndex === i;
                    const isInsertBottom =
                        insertIndex != null &&
                        insertIndex === state.todos.length &&
                        i === state.todos.length - 1;
                    return (
                        <TodoItemRow
                            key={t.$cid}
                            todo={t}
                            onTextChange={handleTextChange}
                            onDoneChange={handleDoneChange}
                            dragging={dragCid === t.$cid}
                            insertTop={!!isInsertTop}
                            insertBottom={!!isInsertBottom}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                        />
                    );
                })}
            </ul>
        </div>
    );
}

type Todo = { $cid: string; text: string; status: TodoStatus };

function TodoItemRow({
    todo,
    onTextChange,
    onDoneChange,
    dragging,
    insertTop,
    insertBottom,
    onDragStart,
    onDragEnd,
}: {
    todo: Todo;
    onTextChange: (cid: string, value: string) => void;
    onDoneChange: (cid: string, done: boolean) => void;
    dragging: boolean;
    insertTop: boolean;
    insertBottom: boolean;
    onDragStart: (cid: string) => void;
    onDragEnd: () => void;
}) {
    const selection = React.useRef<{ start: number; end: number } | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    // Restore caret/selection after state-driven rerender
    React.useLayoutEffect(() => {
        if (selection.current && inputRef.current) {
            const { start, end } = selection.current;
            try {
                inputRef.current.setSelectionRange(start, end);
            } catch {}
            selection.current = null;
        }
    }, [todo.text]);

    const isDone = todo.status === "done";
    return (
        <li
            className={`todo-item card${isDone ? " done" : ""}${dragging ? " dragging" : ""}${insertTop ? " insert-top" : ""}${insertBottom ? " insert-bottom" : ""}`}
            data-cid={todo.$cid}
        >
            <button
                className="drag-handle"
                draggable
                onDragStart={(e) => {
                    // Hint move semantics and ensure we have some drag data
                    try {
                        e.dataTransfer?.setData("text/plain", todo.$cid);
                        if (e.dataTransfer)
                            e.dataTransfer.effectAllowed = "move";
                    } catch {}
                    onDragStart(todo.$cid);
                }}
                onDragEnd={() => onDragEnd()}
                aria-label="Drag to reorder"
                title="Drag to reorder"
            >
                ☰
            </button>
            <input
                type="checkbox"
                className="todo-checkbox"
                checked={isDone}
                onChange={(e) =>
                    onDoneChange(todo.$cid, e.currentTarget.checked)
                }
                aria-label={isDone ? "Mark as todo" : "Mark as done"}
            />
            <input
                ref={inputRef}
                className="todo-text"
                value={todo.text}
                onChange={(e) => {
                    const start =
                        e.currentTarget.selectionStart ??
                        e.currentTarget.value.length;
                    const end = e.currentTarget.selectionEnd ?? start;
                    selection.current = { start, end };
                    onTextChange(todo.$cid, e.currentTarget.value);
                }}
            />
        </li>
    );
}
