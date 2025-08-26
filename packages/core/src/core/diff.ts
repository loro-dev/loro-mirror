import {
    Container,
    ContainerID,
    isContainer,
    LoroDoc,
    LoroMap,
} from "loro-crdt";
import {
    ContainerSchemaType,
    isLoroListSchema,
    isLoroMapSchema,
    isLoroMovableListSchema,
    isLoroTextSchema,
    isRootSchemaType,
    LoroListSchema,
    LoroMapSchema,
    LoroMovableListSchema,
    LoroTextSchemaType,
    RootSchemaType,
    SchemaType,
} from "../schema";
import { InferContainerOptions, type Change } from "./mirror";

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
    inferOptions?: InferContainerOptions,
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
                "Failed to diff container. Old and new state must be objects",
            );
        }

        return diffMap(
            doc,
            stateAndSchema.oldState,
            stateAndSchema.newState,
            containerId,
            stateAndSchema.schema,
            inferOptions,
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
                    "Failed to diff container(map). Old and new state must be objects",
                );
            }

            changes = diffMap(
                doc,
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId,
                stateAndSchema.schema,
                inferOptions,
            );
            break;
        case "List":
            if (
                !isStateAndSchemaOfType<ArrayLike, LoroListSchema<SchemaType>>(
                    stateAndSchema,
                    isArrayLike,
                    isLoroListSchema,
                )
            ) {
                throw new Error(
                    "Failed to diff container(list). Old and new state must be arrays",
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
                    inferOptions,
                );
            } else {
                changes = diffList(
                    doc,
                    oldState as Array<unknown>,
                    newState as Array<unknown>,
                    containerId,
                    schema as LoroListSchema<SchemaType>,
                    inferOptions,
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
                    "Failed to diff container(movable list). Old and new state must be arrays",
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
                inferOptions,
            );
            break;
        case "Text":
            if (
                !isStateAndSchemaOfType<string, LoroTextSchemaType>(
                    stateAndSchema,
                    isStringLike,
                    isLoroTextSchema,
                )
            ) {
                throw new Error(
                    "Failed to diff container(text). Old and new state must be strings",
                );
            }
            changes = diffText(
                stateAndSchema.oldState,
                stateAndSchema.newState,
                containerId,
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
    containerId: ContainerID | "",
): Change[] {
    if (newState === oldState) {
        return [];
    }

    return [
        {
            container: containerId,
            key: "",
            value: newState,
            kind: "insert",
        },
    ];
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
    inferOptions?: InferContainerOptions,
): Change[] {
    /** Changes resulting from the diff */
    const changes: Change[] = [];
    if (oldState === newState) {
        return changes;
    }

    /** Map of old items by ID */
    const oldMap = new Map<string, { index: number; item: unknown }>();
    /** Map of new items by ID */
    const newMap = new Map<string, { index: number; item: unknown }>();
    /** Common items that are shared between old and new states */
    const commonItems: CommonListItemInfo[] = [];

    for (const [index, item] of oldState.entries()) {
        const id = idSelector(item);
        if (id) {
            oldMap.set(id, { index, item });
        }
    }

    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        if (!id) {
            throw new Error("Item ID cannot be null");
        }
        if (newMap.has(id)) {
            throw new Error("Duplicate item id in new state");
        }
        newMap.set(id, { index: newIndex, item });
        if (oldMap.has(id)) {
            const { index: oldIndex, item: oldItem } = oldMap.get(id)!;
            commonItems.push({
                id,
                oldIndex,
                newIndex,
                oldItem,
                newItem: item,
            });
        }
    }

    const deletionOps: Change<number>[] = [];

    // Figure out which items need to be deleted
    for (const [id, { index }] of oldMap.entries()) {
        if (!newMap.has(id)) {
            deletionOps.push({
                container: containerId,
                key: index,
                value: undefined,
                kind: "delete",
            });
        }
    }

    // Sort deletions in descending order to avoid index shift issues.
    deletionOps.sort((a, b) => b.key - a.key);
    changes.push(...deletionOps);

    // Handle moves
    // After deletions are applied, indices shift left for items after a deleted index.
    // Compute move operations relative to the post-deletion list to avoid index mismatch.
    // Build the order of common item IDs in old and new states.
    const oldCommonIds: string[] = [];
    for (const item of oldState) {
        const id = idSelector(item);
        if (id && newMap.has(id)) {
            oldCommonIds.push(id);
        }
    }
    const newCommonIds: string[] = commonItems.map((info) => info.id);

    // Simulate moves on an array of IDs to compute correct from/to indices
    const currentOrder = [...oldCommonIds];
    const currentIndexMap = new Map<string, number>();
    currentOrder.forEach((id, idx) => currentIndexMap.set(id, idx));

    for (
        let targetIndex = 0;
        targetIndex < newCommonIds.length;
        targetIndex++
    ) {
        const id = newCommonIds[targetIndex];
        const currentIndex = currentIndexMap.get(id);
        if (currentIndex === undefined) continue; // safety guard
        if (currentIndex === targetIndex) continue; // already in place

        changes.push({
            container: containerId,
            key: currentIndex,
            value: undefined,
            kind: "move",
            fromIndex: currentIndex,
            toIndex: targetIndex,
        });

        // Update the simulated order and index map after the move
        const [moved] = currentOrder.splice(currentIndex, 1);
        currentOrder.splice(targetIndex, 0, moved);

        // Update indices for the affected range
        const start = Math.min(currentIndex, targetIndex);
        const end = Math.max(currentIndex, targetIndex);
        for (let i = start; i <= end; i++) {
            currentIndexMap.set(currentOrder[i], i);
        }
    }

    // Handle Insertions
    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        if (!id || !oldMap.has(id)) {
            const op = tryUpdateToContainer(
                {
                    container: containerId,
                    key: newIndex,
                    value: item,
                    kind: "insert",
                },
                true,
                schema?.itemSchema,
            );
            changes.push(op);
        }
    }

    // Handle Updates
    for (const info of commonItems) {
        if (deepEqual(info.oldItem, info.newItem)) {
            continue;
        }
        const movableList = doc.getMovableList(containerId);
        const currentItem = movableList.get(info.oldIndex);

        if (isContainer(currentItem)) {
            // Recursively diff container items.
            const containerChanges = diffContainer(
                doc,
                info.oldItem,
                info.newItem,
                currentItem.id,
                schema?.itemSchema,
                inferOptions,
            );
            changes.push(...containerChanges);
        } else {
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: info.newIndex,
                        value: info.newItem,
                        kind: "set",
                    },
                    true,
                    schema?.itemSchema,
                ),
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
    inferOptions?: InferContainerOptions,
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
        } else {
            throw new Error("Item ID cannot be null");
        }
    }

    for (const [newIndex, item] of newState.entries()) {
        const id = idSelector(item);
        if (id) {
            newItemsById.set(id, { item, newIndex });
        } else {
            throw new Error("Item ID cannot be null");
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
                kind: "delete",
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
                        inferOptions,
                    ),
                );
            } else if (!deepEqual(oldItem, newItem)) {
                changes.push({
                    container: containerId,
                    key: index + offset,
                    value: undefined,
                    kind: "delete",
                });
                changes.push(
                    tryUpdateToContainer(
                        {
                            container: containerId,
                            key: index + offset,
                            value: newItem,
                            kind: "insert",
                        },
                        useContainer,
                        schema?.itemSchema,
                    ),
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
                        kind: "insert",
                    },
                    useContainer,
                    schema?.itemSchema,
                ),
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
            kind: "delete",
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
                    kind: "insert",
                },
                useContainer,
                schema?.itemSchema,
            ),
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
    inferOptions?: InferContainerOptions,
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
                inferOptions,
            );
            changes.push(...nestedChanges);
        } else {
            changes.push({
                container: containerId,
                key: i,
                value: undefined,
                kind: "delete",
            });
            changes.push(
                tryUpdateToContainer(
                    {
                        container: containerId,
                        key: i,
                        value: newState[i],
                        kind: "insert",
                    },
                    true,
                    schema?.itemSchema,
                ),
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
            kind: "delete",
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
                    kind: "insert",
                },
                true,
                schema?.itemSchema,
            ),
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
    inferOptions?: InferContainerOptions,
): Change[] {
    const changes: Change[] = [];
    const oldStateObj = oldState as Record<string, unknown>;
    const newStateObj = newState as Record<string, unknown>;

    // Check for removed keys
    for (const key in oldStateObj) {
        if (!(key in newStateObj)) {
            changes.push({
                container: containerId,
                key,
                value: undefined,
                kind: "delete",
            });
        }
    }

    // Check for added or modified keys
    for (const key in newStateObj) {
        const oldItem = oldStateObj[key];
        const newItem = newStateObj[key];

        // Figure out if the modified new value is a container
        const childSchema = (
            schema as LoroMapSchema<Record<string, SchemaType>> | undefined
        )?.definition?.[key];
        const containerType =
            childSchema?.getContainerType() ??
            tryInferContainerType(newItem, inferOptions);

        // added new key
        if (!oldItem) {
            // Inserted a new container
            if (containerType) {
                changes.push({
                    container: containerId,
                    key,
                    value: newItem,
                    kind: "insert-container",
                    childContainerType: containerType,
                });
                // Inserted a new value
            } else {
                changes.push({
                    container: containerId,
                    key,
                    value: newItem,
                    kind: "insert",
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
                    let container = getRootContainerByType(
                        doc,
                        key,
                        containerType,
                    );
                    changes.push(
                        ...diffContainer(
                            doc,
                            oldStateObj[key],
                            newStateObj[key],
                            container.id,
                            childSchema,
                            inferOptions,
                        ),
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
                        insertChildToMap(containerId, key, newStateObj[key]),
                    );
                } else {
                    changes.push(
                        ...diffContainer(
                            doc,
                            oldStateObj[key],
                            newStateObj[key],
                            child.id,
                            childSchema,
                            inferOptions,
                        ),
                    );
                }
                // The type of the child has changed
                // Either it was previously a container and now it's not
                // or it was not a container and now it is
            } else {
                changes.push(
                    insertChildToMap(containerId, key, newStateObj[key]),
                );
            }
        }
    }

    return changes;
}
