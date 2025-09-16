import { LoroDoc, UndoManager } from "loro-crdt";
import { schema, type InferInputType, type InferType } from "loro-mirror";

export type TodoStatus = "todo" | "done";

const todoSchemaDefinition = {
    workspace: schema.LoroMap({
        name: schema.String(),
    }),
    todos: schema.LoroMovableList(
        schema.LoroMap(
            { text: schema.String(), status: schema.String<TodoStatus>() },
            { withCid: true },
        ),
        (item) => item.$cid,
    ),
} as const;

export const todoSchema = schema(todoSchemaDefinition);

export type TodoDocState = InferType<typeof todoSchema>;
export type TodoItem = TodoDocState["todos"][number];

export const initialTodoState: InferInputType<typeof todoSchema> = {
    todos: [],
    workspace: { name: "Untitled List" },
};

export function createConfiguredDoc(): LoroDoc {
    const doc = new LoroDoc();
    doc.setRecordTimestamp(true);
    doc.setChangeMergeInterval(1);
    return doc;
}

export function createUndoManager(doc: LoroDoc): UndoManager {
    return new UndoManager(doc, {});
}
