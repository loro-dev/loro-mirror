import {
    Container,
    ContainerID,
    isContainer,
    LoroDoc,
    LoroMap,
    TreeID
} from "loro-crdt";
import {
    ContainerSchemaType,
    isLoroListSchema,
    isLoroMapSchema,
    isLoroMovableListSchema,
    isLoroTextSchema,
    isLoroTreeSchema,
    isRootSchemaType,
    LoroListSchema,
    LoroMapSchema,
    LoroMapSchemaWithCatchall,
    LoroMovableListSchema,
    LoroTextSchemaType,
    LoroTreeSchema,
    RootSchemaType,
    SchemaType
} from "../schema";
import { ChangeKinds, InferContainerOptions, type Change } from "./mirror";
import { CID_KEY } from "../constants";

import {
    containerIdToContainerType,
    deepEqual,
    getRootContainerByType,
    insertChildToMap,
    isObjectLike,
    isStateAndSchemaOfType,
    isValueOfContainerType,
    type ObjectLike,
    type ArrayLike,
    tryInferContainerType,
    tryUpdateToContainer,
    isStringLike,
    isArrayLike,
    isTreeID,
    defineCidProperty
} from "./utils";

/**
 * Finds the longest increasing subsequence of a sequence of numbers
 * @param sequence The sequence of numbers
 * @returns The longest increasing subsequence
 */
export function longestIncreasingSubsequence(sequence: number[]): number[] {
    const n = sequence.length;
    const p = Array.from({ length: n }, () => -1);
    const m: number[] = [];
    for (let i = 0; i < n; i++) {
        const x = sequence[i];
        let low = 0;
        let high = m.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (sequence[m[mid]] < x) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if (low >= m.length) {
            m.push(i);
        } else {
            m[low] = i;
        }
        if (low > 0) {
            p[i] = m[low - 1];
        }
    }
    const lis: number[] = [];
    let k = m[m.length - 1];
    for (let i = m.length - 1; i >= 0; i--) {
        lis[i] = k;
        k = p[k];
    }
    return lis;
}

/**
 * Helper Type for common list item information
 */
type CommonListItemInfo = {
    id: string;
    oldIndex: number;
    newIndex: number;
    oldItem: unknown;
    newItem: unknown;
};

type IdSelector<T> = (item: T) => string | undefined;

function getMapChildSchema(
    schema:
        | LoroMapSchema<Record<string, SchemaType>>
        | LoroMapSchemaWithCatchall<Record<string, SchemaType>, SchemaType>
        | RootSchemaType<Record<string, ContainerSchemaType>>
        | undefined,
    key: string
): SchemaType | ContainerSchemaType | undefined {
    if (!schema) return undefined;
    if (schema.type === "schema") {
        return schema.definition[key];
    }
    if (schema.type === "loro-map") {
        if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
            return schema.definition[key];
        }
        const withCatchall = schema as LoroMapSchemaWithCatchall<
            Record<string, SchemaType>,
            SchemaType
        > & { catchallType?: SchemaType };
        if (withCatchall.catchallType) {
            return withCatchall.catchallType;
        }
    }
    return undefined;
}

/**
 * Diffs a container between two states
 *
 * @param doc The LoroDoc instance
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID can be "" for root level changes
 * @param schema The schema for the container (can be undefined)
 * @returns The list of changes
 */
export function diffContainer(
    doc: LoroDoc,
    oldState: unknown,
    newState: unknown,
    containerId: ContainerID | "",
    schema: SchemaType | undefined,
    inferOptions?: InferContainerOptions
): Change[] {
    const stateAndSchema = { oldState, newState, schema };
    if (containerId === "") {
        if (
            !isStateAndSchemaOfType<
                ObjectLike,
                RootSchemaType<Record<string, ContainerSchemaType>>
            >(stateAndSchema, isObjectLike, isRootSchemaType)
        ) {
            console.log("stateAndSchema:", stateAndSchema);
            throw new Error(
                "Failed to diff container. Old and new state must be objects"
            );
        }

        return diffMap(
            doc,
            stateAndSchema.oldState,
            stateAndSchema.newState,
            containerId,
            stateAndSchema.schema,
            inferOptions
        );
    }

    const containerType = containerIdToContainerType(containerId);

    let changes: Change[] = [];

    let idSelector: IdSelector<unknown> | undefined;

    switch (containerType) {
        case "Map":
            if (
                !isStateAndSchemaOfType<
                    ObjectLike,
                    LoroMapSchema<Record<string, SchemaType>>
                >(stateAndSchema, isObjectLike, isLoroMapSchema)
            ) {
                console.log("stateAndSchema:", stateAndSchema);
                throw new Error(
                    "Failed to diff container(map). Old and new state must be objects"
                );
            }

            changes = diffMap(
                doc,
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId,
                stateAndSchema.schema,
                inferOptions
            );
            break;
        case "List":
            if (
                !isStateAndSchemaOfType<ArrayLike, LoroListSchema<SchemaType>>(
                    stateAndSchema,
                    isArrayLike,
                    isLoroListSchema
                )
            ) {
                throw new Error(
                    "Failed to diff container(list). Old and new state must be arrays"
                );
            }

            idSelector = stateAndSchema.schema?.idSelector;

            if (idSelector) {
                changes = diffListWithIdSelector(
                    doc,
                    stateAndSchema.oldState,
                    stateAndSchema.newState,
                    containerId,
                    stateAndSchema.schema,
                    idSelector,
                    inferOptions
                );
            } else {
                changes = diffList(
                    doc,
                    oldState as Array<unknown>,
                    newState as Array<unknown>,
                    containerId,
                    schema as LoroListSchema<SchemaType>,
                    inferOptions
                );
            }
            break;
        case "MovableList":
            if (
                !isStateAndSchemaOfType<
                    ArrayLike,
                    LoroMovableListSchema<SchemaType>
                >(stateAndSchema, isArrayLike, isLoroMovableListSchema)
            ) {
                throw new Error(
                    "Failed to diff container(movable list). Old and new state must be arrays"
                );
            }

            idSelector = stateAndSchema.schema?.idSelector;

            if (!idSelector) {
                throw new Error("Movable list schema must have an idSelector");
            }

            changes = diffMovableList(
                doc,
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId,
                stateAndSchema.schema,
                idSelector,
                inferOptions
            );
            break;
        case "Text":
            if (
                !isStateAndSchemaOfType<string, LoroTextSchemaType>(
                    stateAndSchema,
                    isStringLike,
                    isLoroTextSchema
                )
            ) {
                throw new Error(
                    "Failed to diff container(text). Old and new state must be strings"
                );
            }
            changes = diffText(
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId
            );
            break;
        case "Tree":
            if (
                !isStateAndSchemaOfType<
                    ArrayLike,
                    LoroTreeSchema<Record<string, SchemaType>>
                >(stateAndSchema, isArrayLike, isLoroTreeSchema)
            ) {
                throw new Error(
                    "Failed to diff container(tree). Old and new state must be arrays"
                );
            }
            changes = diffTree(
                doc,
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId,
                stateAndSchema.schema,
                inferOptions
            );
            break;
        default:
            throw new Error(`Unsupported container type: ${containerType}`);
    }

    return changes;
}

/**
 * Diffs a [LoroText] between two states
 *
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID
 * @returns The list of changes
 */
export function diffText(
    oldState: string,
    newState: string,
    containerId: ContainerID | ""
): Change[] {
    if (newState === oldState) {
        return [];
    }

    return [
        {
            container: containerId,
            key: "",
            value: newState,
            kind: "insert"
        }
    ];
}

/**
 * Diffs a LoroTree between two states
 *
 * Produces structural tree operations (create/move/delete) and per-node data updates.
 */
export function diffTree(
    doc: LoroDoc,
    oldState: ArrayLike,
    newState: ArrayLike,
    containerId: ContainerID,
    schema: LoroTreeSchema<Record<string, SchemaType>> | undefined,
    inferOptions?: InferContainerOptions
): Change[] {
    const changes: Change[] = [];
    if (oldState === newState) return changes;

    type Node = { id?: string; data?: unknown; children?: unknown[] };

    const toArray = (arr: ArrayLike) => arr as unknown as Node[];
    const oldArr = toArray(oldState);
    const newArr = toArray(newState);

    // Walk helpers
    type NodeInfo = { id: string; parent?: string; index: number; node: Node };

    const oldInfoById = new Map<string, NodeInfo>();
    const newInfoById = new Map<string, NodeInfo>();

    function walk(arr: Node[], map: Map<string, NodeInfo>, parent?: string) {
        for (let i = 0; i < arr.length; i++) {
            const n = arr[i];
            if (n && typeof n === "object" && typeof n.id === "string") {
                map.set(n.id, { id: n.id, parent, index: i, node: n });
            }
            if (n && Array.isArray(n.children)) {
                walk(
                    n.children as Node[],
                    map,
                    typeof n.id === "string" ? n.id : undefined
                );
            }
        }
    }

    walk(oldArr, oldInfoById);
    walk(newArr, newInfoById);

    // Deletions (ids in old but not in new) – delete deepest nodes first
    // TODO: PERF: maybe we don't need to sort by depth
    const toDelete: NodeInfo[] = [];
    for (const [id, info] of oldInfoById) {
        if (!newInfoById.has(id)) toDelete.push(info);
    }

    // Compute depth for stable deletion order
    const depth = (info: NodeInfo): number => {
        let d = 0;
        let p = info.parent ? oldInfoById.get(info.parent) : undefined;
        while (p) {
            d++;
            p = p.parent ? oldInfoById.get(p.parent) : undefined;
        }
        return d;
    };
    toDelete.sort((a, b) => depth(b) - depth(a));
    for (const info of toDelete) {
        changes.push({
            container: containerId,
            kind: "tree-delete",
            target: info.id as TreeID
        });
    }

    // Creates (nodes in new but not in old) – create parents before children (preorder)
    //
    // Why this is tricky for trees:
    // - New nodes don't have stable IDs yet. Loro assigns a TreeID only when we actually
    //   call `tree.createNode(...)`. But our app state must contain that ID afterwards so
    //   that subsequent diffs and FROM_LORO events can reference it correctly.
    // - When creating a parent and its children in the same batch, children's `parent`
    //   TreeID is unknown at diff time (because the parent has not been created yet).
    //
    // Design:
    // - We schedule a `tree-create` change per new node and attach an `onCreate(id)`
    //   callback. When the create is applied, `onCreate` receives the real TreeID assigned
    //   by Loro. We then:
    //     1) write that ID back into the newState node (so user state now carries the
    //        correct, canonical ID), and
    //     2) patch any pending child creates so their `parent` field becomes this new ID.
    // - This introduces an ordering requirement: apply tree creates one-by-one and invoke
    //   `onCreate` immediately so downstream child creates have the right parent.
    function pushCreates(
        arr: Node[],
        parent: string | undefined,
        notifyWhenParentCreated?: ChangeKinds["treeCreate"][]
    ) {
        for (let i = 0; i < arr.length; i++) {
            const n = arr[i];
            const id = isTreeID(n.id) ? n.id : undefined;
            const needCreate = !id || !oldInfoById.has(id);
            const notifySet: ChangeKinds["treeCreate"][] = [];
            if (needCreate) {
                const c: ChangeKinds["treeCreate"] = {
                    container: containerId,
                    kind: "tree-create",
                    parent: parent as TreeID | undefined,
                    index: i,
                    value: n?.data,
                    // When Loro assigns the concrete TreeID for this newly created node,
                    // we immediately:
                    // - store it back onto the node in the newState (so future diffs/events
                    //   use a consistent ID), and
                    // - update any pending child create ops so their `parent` now refers to
                    //   this new ID.
                    onCreate: (id) => {
                        n.id = id;
                        for (const c of notifySet) {
                            c.parent = id;
                        }
                    }
                };
                changes.push(c);
                notifyWhenParentCreated?.push(c);
            }

            if (n && Array.isArray(n.children)) {
                const pid = isTreeID(n.id) ? n.id : undefined;
                if (needCreate) {
                    // We don't yet know the parent's ID; collect children's create ops so
                    // we can patch their `parent` after the parent is created.
                    pushCreates(n.children as Node[], pid, notifySet);
                } else {
                    pushCreates(n.children as Node[], pid);
                }
            }
        }
    }

    pushCreates(newArr, undefined);
    // Moves and data updates for common nodes
    for (const [id, newInfo] of newInfoById) {
        const oldInfo = oldInfoById.get(id);
        if (!oldInfo) continue; // created above

        const parentChanged =
            (oldInfo.parent ?? undefined) !== (newInfo.parent ?? undefined);
        const indexChanged = oldInfo.index !== newInfo.index;
        if (parentChanged || indexChanged) {
            changes.push({
                container: containerId,
                kind: "tree-move",
                target: id as TreeID,
                parent: newInfo.parent as TreeID | undefined,
                index: newInfo.index
            });
        }

        // Data updates: diff node.data via its map container id
        try {
            const tree = doc.getTree(containerId);
            const node = tree.getNodeByID(id as TreeID);
            if (node && schema) {
                // Ensure $cid is present on incoming node.data when omitted.
                const incoming = newInfo.node?.data;
                if (
                    incoming &&
                    typeof incoming === "object" &&
                    !(CID_KEY in (incoming as Record<string, unknown>))
                ) {
                    defineCidProperty(incoming, node.data.id);
                }
                const nested = diffContainer(
                    doc,
                    oldInfo.node?.data,
                    newInfo.node?.data,
                    node.data.id,
                    schema.nodeSchema,
                    inferOptions
                );
                changes.push(...nested);
            }
        } catch (e) {
            console.error(`Failed to diff node.data for node ${id}:`, e);
        }
    }

    return changes;
}

/**
 * Finds the difference between two lists based on an idSelector function
 *
 * Time Complexity:
 *
 * - O(1) if not changed
 * - O(n + klogk) for insertions/deletions/replacements, where k is the number of deletions
 * - O(n) for one move op
 * - Worst case O(n^2) for move op
 *
 * @param doc The LoroDoc instance
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID
 * @param schema The schema for the container
 * @param idSelector The idSelector function
 * @returns The list of changes
 */
export function diffMovableList<S extends ArrayLike>(
    doc: LoroDoc,
    oldState: S,
    newState: S,
    containerId: ContainerID,
    schema:
        | LoroListSchema<SchemaType>
        | LoroMovableListSchema<SchemaType>
        | undefined,
    idSelector: IdSelector<unknown>,
    inferOptions?: InferContainerOptions
): Change[] {
    const changes: Change[] = [];
    if (oldState === newState) return changes;

    type IndexItemMap = Map<string, { index: number; item: unknown }>;

    // 1) Build per-state maps and collect common items (ordered by new state)
    const oldMap: IndexItemMap = new Map();
    const newMap: IndexItemMap = new Map();
    const common: CommonListItemInfo[] = [];

    for (const [i, item] of oldState.entries()) {
        const id = idSelector(item);
        if (id) oldMap.set(id, { index: i, item });
    }

    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        // New items may not have an id yet (e.g., $cid is assigned during apply).
        // Treat them as pure inserts later; only track items that already have an id.
        if (!id) continue;
        if (newMap.has(id)) throw new Error("Duplicate item id in new state");
        newMap.set(id, { index: newIndex, item });
        const oldEntry = oldMap.get(id);
        if (oldEntry) {
            common.push({
                id,
                oldIndex: oldEntry.index,
                newIndex,
                oldItem: oldEntry.item,
                newItem: item
            });
        }
    }

    // 2) Deletions (from highest index to lowest)
    const deletions: ChangeKinds["delete"][] = [];
    for (const [id, { index }] of oldMap) {
        if (!newMap.has(id)) {
            deletions.push({
                container: containerId,
                key: index,
                value: undefined,
                kind: "delete" as const
            });
        }
    }
    deletions.sort((a, b) => (b.key as number) - (a.key as number));
    changes.push(...deletions);

    // 3) Moves (simulate post-deletion order; place each target item)
    const oldCommonIds: string[] = [];
    for (const item of oldState) {
        const id = idSelector(item);
        if (id && newMap.has(id)) oldCommonIds.push(id);
    }
    const newCommonIds: string[] = common.map((c) => c.id);
    if (!deepEqual(oldCommonIds, newCommonIds)) {
        // Need to move
        const order = [...oldCommonIds];
        const idxOf = new Map<string, number>();
        order.forEach((id, i) => idxOf.set(id, i));

        for (let target = 0; target < newCommonIds.length; target++) {
            const id = newCommonIds[target];
            const from = idxOf.get(id);
            if (from == null || from === target) continue;

            changes.push({
                container: containerId,
                key: from,
                value: undefined,
                kind: "move",
                fromIndex: from,
                toIndex: target
            });

            const [moved] = order.splice(from, 1);
            order.splice(target, 0, moved);
            const start = Math.min(from, target);
            const end = Math.max(from, target);
            for (let i = start; i <= end; i++) idxOf.set(order[i], i);
        }
    }

    // 4) Insertions (items only in new state)
    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        if (!id || !oldMap.has(id)) {
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: newIndex,
                        value: item,
                        kind: "insert"
                    },
                    true,
                    schema?.itemSchema
                )
            );
        }
    }

    // 5) Updates (for items present in both states)
    for (const info of common) {
        if (deepEqual(info.oldItem, info.newItem)) continue;

        const movableList = doc.getMovableList(containerId);
        const currentItem = movableList.get(info.oldIndex);
        if (isContainer(currentItem)) {
            const nested = diffContainer(
                doc,
                info.oldItem,
                info.newItem,
                currentItem.id,
                schema?.itemSchema,
                inferOptions
            );
            changes.push(...nested);
        } else {
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: info.newIndex,
                        value: info.newItem,
                        kind: "set"
                    },
                    true,
                    schema?.itemSchema
                )
            );
        }
    }

    return changes;
}

/**
 * Finds the difference between two lists based on an idSelector function
 *
 * @param doc The LoroDoc instance
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID
 * @param schema The schema for the container
 * @param idSelector The idSelector function
 * @returns The list of changes
 */
export function diffListWithIdSelector<S extends ArrayLike>(
    doc: LoroDoc,
    oldState: S,
    newState: S,
    containerId: ContainerID,
    schema: LoroListSchema<SchemaType> | undefined,
    idSelector: IdSelector<unknown>,
    inferOptions?: InferContainerOptions
): Change[] {
    const changes: Change[] = [];
    if (oldState === newState) {
        return changes;
    }

    const useContainer = !!(schema?.itemSchema.getContainerType() ?? true);
    const oldItemsById = new Map();
    const newItemsById = new Map();

    for (const [index, item] of oldState.entries()) {
        const id = idSelector(item);
        if (id) {
            oldItemsById.set(id, { item, index });
        }
    }

    // Note: Items in the NEW state may legitimately be missing an ID when
    // using $cid injection; IDs are stamped during apply. Treat them as new inserts
    // later instead of throwing here.
    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        if (id) {
            newItemsById.set(id, { item, newIndex });
        }
    }

    const list = doc.getList(containerId);
    let newIndex = 0;
    let offset = 0;
    let index = 0;
    while (index < oldState.length) {
        if (newIndex >= newState.length) {
            // An old item not found in the new state, delete here
            changes.push({
                container: containerId,
                key: index + offset,
                value: undefined,
                kind: "delete"
            });
            offset--;
            index++;
            continue;
        }

        const oldItem = oldState[index];
        const newItem = newState[newIndex];
        if (oldItem === newItem) {
            newIndex++;
            index++;
            continue;
        }

        const oldId = idSelector(oldItem);
        const newId = idSelector(newItem);
        if (oldId === newId) {
            const item = list.get(index);
            if (isContainer(item)) {
                changes.push(
                    ...diffContainer(
                        doc,
                        oldItem,
                        newItem,
                        item.id,
                        schema?.itemSchema,
                        inferOptions
                    )
                );
            } else if (!deepEqual(oldItem, newItem)) {
                changes.push({
                    container: containerId,
                    key: index + offset,
                    value: undefined,
                    kind: "delete"
                });
                changes.push(
                    tryUpdateToContainer(
                        {
                            container: containerId,
                            key: index + offset,
                            value: newItem,
                            kind: "insert"
                        },
                        useContainer,
                        schema?.itemSchema
                    )
                );
            }

            index++;
            newIndex++;
            continue;
        }

        if (newId && !oldItemsById.has(newId)) {
            // A new item
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: index + offset,
                        value: newItem,
                        kind: "insert"
                    },
                    useContainer,
                    schema?.itemSchema
                )
            );

            offset++;
            newIndex++;
            continue;
        }

        // An old item not found in the new state, delete here
        changes.push({
            container: containerId,
            key: index + offset,
            value: undefined,
            kind: "delete"
        });
        offset--;
        index++;
    }

    for (; newIndex < newState.length; newIndex++) {
        const newItem = newState[newIndex];
        changes.push(
            tryUpdateToContainer(
                {
                    container: containerId,
                    key: index + offset,
                    value: newItem,
                    kind: "insert"
                },
                useContainer,
                schema?.itemSchema
            )
        );
        offset++;
    }

    return changes;
}

/**
 * Diffs a [LoroList] between two states
 *
 * This function handles list diffing without an ID selector.
 * This can result in less precise updates, and can cause clone/fork of items.
 *
 * If an ID selector is possible, use [diffMovableList] instead.
 *
 * @param doc The LoroDoc instance
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID of the list
 * @param schema The schema for the container
 * @returns The list of changes
 */
export function diffList<S extends ArrayLike>(
    doc: LoroDoc,
    oldState: S,
    newState: S,
    containerId: ContainerID,
    schema: LoroListSchema<SchemaType> | undefined,
    inferOptions?: InferContainerOptions
): Change[] {
    if (oldState === newState) {
        return [];
    }

    const changes: Change[] = [];
    const oldLen = oldState.length;
    const newLen = newState.length;
    const list = doc.getList(containerId);

    // Find common prefix
    let start = 0;
    while (
        start < oldLen &&
        start < newLen &&
        oldState[start] === newState[start]
    ) {
        start++;
    }

    // Find common suffix (after the differing middle), ensuring no overlap with prefix
    let suffix = 0;
    while (
        suffix < oldLen - start &&
        suffix < newLen - start &&
        oldState[oldLen - 1 - suffix] === newState[newLen - 1 - suffix]
    ) {
        suffix++;
    }

    const oldBlockLen = oldLen - start - suffix;
    const newBlockLen = newLen - start - suffix;

    // First, handle overlapping part in the middle block as updates (preserve nested containers)
    const overlap = Math.min(oldBlockLen, newBlockLen);
    for (let j = 0; j < overlap; j++) {
        const i = start + j;
        if (oldState[i] === newState[i]) continue;

        const itemOnLoro = list.get(i);
        if (isContainer(itemOnLoro)) {
            const nestedChanges = diffContainer(
                doc,
                oldState[i],
                newState[i],
                itemOnLoro.id,
                schema?.itemSchema,
                inferOptions
            );
            changes.push(...nestedChanges);
        } else {
            changes.push({
                container: containerId,
                key: i,
                value: undefined,
                kind: "delete"
            });
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: i,
                        value: newState[i],
                        kind: "insert"
                    },
                    true,
                    schema?.itemSchema
                )
            );
        }
    }

    // Then handle extra deletions (when old middle block is longer)
    for (let k = 0; k < oldBlockLen - overlap; k++) {
        // Always delete at the same index (start + overlap) to remove a contiguous block
        changes.push({
            container: containerId,
            key: start + overlap,
            value: undefined,
            kind: "delete"
        });
    }

    // Finally handle extra insertions (when new middle block is longer)
    for (let k = 0; k < newBlockLen - overlap; k++) {
        const insertIndex = start + overlap + k;
        changes.push(
            tryUpdateToContainer(
                {
                    container: containerId,
                    key: insertIndex,
                    value: newState[insertIndex],
                    kind: "insert"
                },
                true,
                schema?.itemSchema
            )
        );
    }

    return changes;
}

/**
 * Diffs a [LoroMap] between two states
 *
 * @param doc The LoroDoc instance
 * @param oldState The old state
 * @param newState The new state
 * @param containerId The container ID of the map
 * @param schema The schema for the container
 * @returns The list of changes
 */
export function diffMap<S extends ObjectLike>(
    doc: LoroDoc,
    oldState: S,
    newState: S,
    containerId: ContainerID | "",
    schema:
        | LoroMapSchema<Record<string, SchemaType>>
        | RootSchemaType<Record<string, ContainerSchemaType>>
        | undefined,
    inferOptions?: InferContainerOptions
): Change[] {
    const changes: Change[] = [];
    const oldStateObj = oldState as Record<string, unknown>;
    const newStateObj = newState as Record<string, unknown>;

    // Check for removed keys
    for (const key in oldStateObj) {
        // Skip synthetic CID field for maps
        if (key === CID_KEY) {
            continue;
        }
        // Skip ignored fields defined in schema
        const childSchemaForDelete = getMapChildSchema(
            schema as
                | LoroMapSchema<Record<string, SchemaType>>
                | LoroMapSchemaWithCatchall<
                      Record<string, SchemaType>,
                      SchemaType
                  >
                | RootSchemaType<Record<string, ContainerSchemaType>>
                | undefined,
            key
        );
        if (childSchemaForDelete && childSchemaForDelete.type === "ignore") {
            continue;
        }
        if (!(key in newStateObj)) {
            changes.push({
                container: containerId,
                key,
                value: undefined,
                kind: "delete"
            });
        }
    }

    // Check for added or modified keys
    for (const key in newStateObj) {
        // Skip synthetic CID field for maps
        if (key === CID_KEY) {
            continue;
        }
        const oldItem = oldStateObj[key];
        const newItem = newStateObj[key];

        // Figure out if the modified new value is a container
        const childSchema = getMapChildSchema(
            schema as
                | LoroMapSchema<Record<string, SchemaType>>
                | LoroMapSchemaWithCatchall<
                      Record<string, SchemaType>,
                      SchemaType
                  >
                | RootSchemaType<Record<string, ContainerSchemaType>>
                | undefined,
            key
        );

        // Skip ignored fields defined in schema
        if (childSchema && childSchema.type === "ignore") {
            continue;
        }

        // Determine container type with schema-first, but respect actual value.
        // If schema suggests a container but the provided value doesn't match it,
        // log a warning and fall back to inferring from the value to avoid divergence.
        let containerType =
            childSchema?.getContainerType() ??
            tryInferContainerType(newItem, inferOptions);
        if (
            childSchema?.getContainerType() &&
            containerType &&
            !isValueOfContainerType(containerType, newItem)
        ) {
            console.warn(
                `Schema mismatch on key "${key}": expected ${childSchema.getContainerType()} but got value ${JSON.stringify(
                    newItem
                )}. Falling back to value-based inference to avoid divergence.`
            );
            containerType = tryInferContainerType(newItem, inferOptions);
        }

        // Added new key: detect by property presence, not truthiness.
        // Using `!oldItem` breaks for valid falsy values like "" or null.
        if (!(key in oldStateObj)) {
            // Inserted a new container
            if (
                containerType &&
                isValueOfContainerType(containerType, newItem)
            ) {
                changes.push({
                    container: containerId,
                    key,
                    value: newItem,
                    kind: "insert-container",
                    childContainerType: containerType
                });
                // Inserted a new value
            } else {
                changes.push({
                    container: containerId,
                    key,
                    value: newItem,
                    kind: "insert"
                });
            }
            continue;
        }

        // Item inside map has changed
        if (oldItem !== newItem) {
            // The key was previously a container and new item is also a container
            if (
                containerType &&
                isValueOfContainerType(containerType, newItem) &&
                isValueOfContainerType(containerType, oldItem)
            ) {
                // the parent is the root container
                if (containerId === "") {
                    const container = getRootContainerByType(
                        doc,
                        key,
                        containerType
                    );
                    // Reattach $cid on the incoming object if missing when the child
                    // is an existing map container but the new value omitted $cid.
                    // This keeps container identity stable for subsequent updates.
                    if (
                        containerType === "Map" &&
                        newItem &&
                        typeof newItem === "object" &&
                        !(CID_KEY in (newItem as Record<string, unknown>))
                    ) {
                        defineCidProperty(newItem, container.id);
                    }
                    changes.push(
                        ...diffContainer(
                            doc,
                            oldStateObj[key],
                            newStateObj[key],
                            container.id,
                            childSchema,
                            inferOptions
                        )
                    );
                    continue;
                }

                const container = doc.getContainerById(containerId);

                if (container?.kind() !== "Map") {
                    throw new Error("Expected map container");
                }

                const map = container as LoroMap;
                const child = map.get(key) as Container | undefined;
                if (!child || !isContainer(child)) {
                    changes.push(
                        insertChildToMap(containerId, key, newStateObj[key])
                    );
                } else {
                    // Reattach $cid on the incoming object if missing when the child
                    // is an existing map container but the new value omitted $cid.
                    if (
                        containerType === "Map" &&
                        newItem &&
                        typeof newItem === "object" &&
                        !(CID_KEY in (newItem as Record<string, unknown>))
                    ) {
                        defineCidProperty(newItem, child.id);
                    }
                    changes.push(
                        ...diffContainer(
                            doc,
                            oldStateObj[key],
                            newStateObj[key],
                            child.id,
                            childSchema,
                            inferOptions
                        )
                    );
                }
                // The type of the child has changed
                // Either it was previously a container and now it's not
                // or it was not a container and now it is
            } else {
                changes.push(
                    insertChildToMap(containerId, key, newStateObj[key])
                );
            }
        }
    }

    return changes;
}
