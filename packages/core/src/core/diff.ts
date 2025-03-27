import { ContainerID, isContainer, LoroDoc } from "loro-crdt";
import { LoroListSchema, LoroMovableListSchema, SchemaType } from "../schema";
import { Change, schemaToContainerType, tryUpdateToInsertContainer } from "./mirror";
import { containerIdToContainerType, deepEqual } from "./utils";

/** 
 * Finds the longest increasing subsequence of a sequence of numbers
 * @param sequence The sequence of numbers
 * @returns The longest increasing subsequence
 */
export function longestIncreasingSubsequence(sequence: number[]): number[] {
  const n = sequence.length;
  const p = new Array(n).fill(-1);
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

type CommonListItemInfo = {
  id: string;
  oldIndex: number;
  newIndex: number;
  oldItem: unknown;
  newItem: unknown;
};

type IdSelector<T> = (item: T) => string | undefined;

type ContainerChangeFn = (
  oldState: unknown,
  newState: unknown,
  containerId: ContainerID | "",
  schema: SchemaType | undefined,
) => Change[];


export function diffContainer(
  doc: LoroDoc,
  oldState: unknown,
  newState: unknown,
  containerId: ContainerID | "",
  schema: SchemaType | undefined,
): Change[] {
  // Container is root
  if (containerId === "") {
    throw new Error("Root container should not be directly diffed");
  }

  const containerType = containerIdToContainerType(containerId);

  if (schema) {
    const schemaContainerType = schemaToContainerType(schema);
    if (schemaContainerType && schemaContainerType !== containerType) {
      throw new Error("Schema container type does not match container type");
    }
  }

  let changes: Change[] = [];

  switch (containerType) {
    case "Map":
      break;
    case "List":
      break;
    case "MovableList":
      if (!schema) {
        throw new Error("Movable list schema is required");
      }
      const idSelector = (schema as LoroMovableListSchema<SchemaType>).idSelector;

      if (!idSelector) {
        throw new Error("Movable list schema must have an idSelector");
      }

      changes = diffMovableList(
        doc,
        oldState as Array<unknown>,
        newState as Array<unknown>,
        containerId,
        schema as LoroMovableListSchema<SchemaType>,
        idSelector,
        diffContainer,
      );
      break;
    case "Text":
      changes = diffText(
        oldState as string,
        newState as string,
        containerId,
      );
      break;
  }

  return changes;
}

export function diffText(
  oldState: unknown,
  newState: unknown,
  containerId: ContainerID | "",
): Change[] {

  if (newState === oldState) {
    return [];
  }

  return [{
    container: containerId,
    key: "",
    value: newState as string,
    kind: "insert",
  }];
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
 * @param findChangesForContainer A function to find changes for a container
 * @param supportMoves Whether to support moves, if true Change[] will include Change.kind === "move"
 * @returns The list of changes
 */
export function diffMovableList<
  D extends Array<unknown>,
  S extends
  | LoroListSchema<SchemaType>
  | LoroMovableListSchema<SchemaType>
  | undefined,
>(
  doc: LoroDoc,
  oldState: D,
  newState: D,
  containerId: ContainerID,
  schema: S,
  idSelector: IdSelector<unknown>,
  findChangesForContainer: ContainerChangeFn,
): Change[] {
  /** Changes resulting from the diff */
  const changes: Change[] = [];

  /** Map of old items by ID */
  const oldMap = new Map<string, { index: number; item: any }>();
  /** Map of new items by ID */
  const newMap = new Map<string, { index: number; item: any }>();
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
    if (id) {
      newMap.set(id, { index: newIndex, item });
      if (oldMap.has(id)) {
        const { index: oldIndex, item: oldItem } = oldMap.get(id)!;
        commonItems.push({ id, oldIndex, newIndex, oldItem, newItem: item });
      }
    }
  }

  const deletionOps: Change[] = [];

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
  // TODO: typing for list should have key be a number
  deletionOps.sort((a, b) => (b.key as number) - (a.key as number));
  changes.push(...deletionOps);

  // Handle moves
  const oldIndicesSequence = commonItems.map((info) => info.oldIndex);

  /** LIS of the old indices that are in the common items
   * This is represented as the core set of indexes which remain the same
   * betweeen both old and new states.
   * All move operations should only be performed on items that are not in the LIS.
   * By excluding items in the LIS, we ensure that we don't perform unnecessary move operations.
   */
  const lisIndices = longestIncreasingSubsequence(oldIndicesSequence);
  const lisSet = new Set<number>(lisIndices);
  for (const [i, info] of commonItems.entries()) {
    // If the common item is not in the LIS and its positions differ, mark it for move
    if (!lisSet.has(i) && info.oldIndex !== info.newIndex) {
      changes.push({
        container: containerId,
        key: info.oldIndex,
        value: info.newItem,
        kind: "move",
        fromIndex: info.oldIndex,
        toIndex: info.newIndex,
      });
    }
  }

  // Handle Insertions
  for (const [newIndex, item] of newState.entries()) {
    const id = idSelector(item);
    if (!id || !oldMap.has(id)) {
      const op = tryUpdateToInsertContainer(
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
      const containerChanges = findChangesForContainer(
        info.oldItem,
        info.newItem,
        currentItem.id,
        schema?.itemSchema,
      );
      changes.push(...containerChanges);
    } else {
      // For non-container items, simulate an update as a deletion followed by an insertion.
      changes.push({
        container: containerId,
        key: info.newIndex,
        value: undefined,
        kind: "delete",
      });
      changes.push(
        tryUpdateToInsertContainer(
          {
            container: containerId,
            key: info.newIndex,
            value: info.newItem,
            kind: "insert",
          },
          true,
          schema?.itemSchema,
        ),
      );
    }
  }

  return changes;
}
