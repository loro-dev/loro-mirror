import {
	Container,
	ContainerID,
	ContainerType,
	isContainer,
	LoroDoc,
	LoroMap,
} from "loro-crdt";
import {
	LoroListSchema,
	LoroMapSchema,
	LoroMovableListSchema,
	SchemaType,
} from "../schema";
import {
	Change,
	insertChildToMap,
	isValueOfContainerType,
	schemaToContainerType,
	tryInferContainerType,
	tryUpdateToInsertContainer,
} from "./mirror";
import {
	containerIdToContainerType,
	deepEqual,
	getRootContainerByType,
} from "./utils";

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

export function diffContainer(
	doc: LoroDoc,
	oldState: unknown,
	newState: unknown,
	containerId: ContainerID | "",
	schema: SchemaType | undefined,
): Change[] {
	if (containerId === "") {
		return diffMap(
			doc,
			oldState as Record<string, unknown>,
			newState as Record<string, unknown>,
			containerId,
			schema as LoroMapSchema<Record<string, SchemaType>>,
		);
	}

	const containerType = containerIdToContainerType(containerId);

	if (schema) {
		const schemaContainerType = schemaToContainerType(schema);
		if (schemaContainerType && schemaContainerType !== containerType) {
			throw new Error("Schema container type does not match container type");
		}
	}

	let changes: Change[] = [];

	let idSelector: IdSelector<unknown> | undefined;

	switch (containerType) {
		case "Map":
			changes = diffMap(
				doc,
				oldState as Record<string, unknown>,
				newState as Record<string, unknown>,
				containerId,
				schema as LoroMapSchema<Record<string, SchemaType>>,
			);
			break;
		case "List":
			idSelector = (schema as LoroListSchema<SchemaType> | undefined)
				?.idSelector;

			if (idSelector) {
				changes = diffListWithIdSelector(
					doc,
					oldState as Array<unknown>,
					newState as Array<unknown>,
					containerId,
					schema as LoroListSchema<SchemaType>,
					idSelector,
				);
			} else {
				changes = diffList(
					doc,
					oldState as Array<unknown>,
					newState as Array<unknown>,
					containerId,
					schema as LoroListSchema<SchemaType>,
				);
			}
			break;
		case "MovableList":
			if (!schema) {
				throw new Error("Movable list schema is required");
			}
			idSelector = (schema as LoroMovableListSchema<SchemaType>).idSelector;

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
			);
			break;
		case "Text":
			changes = diffText(oldState as string, newState as string, containerId);
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

	return [
		{
			container: containerId,
			key: "",
			value: newState as string,
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
			const containerChanges = diffContainer(
				doc,
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

export function diffListWithIdSelector(
	doc: LoroDoc,
	oldState: unknown[],
	newState: unknown[],
	containerId: ContainerID,
	schema: LoroListSchema<SchemaType> | undefined,
	idSelector: IdSelector<unknown>,
): Change[] {
	const changes: Change[] = [];

	const useContainer = !!(schema?.itemSchema.getContainerType() ?? true);
	const oldItemsById = new Map();
	const newItemsById = new Map();

	for (const [index, item] of oldState.entries()) {
		const id = idSelector(item);
		if (id) {
			oldItemsById.set(id, { item, index });
		}
	}

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
	for (; index < oldState.length; index++) {
		const oldItem = oldState[index];
		const newItem = newState[newIndex];
		if (oldItem === newItem) {
			newIndex++;
			continue;
		}

		const oldId = oldItem ? idSelector(oldItem) : null;
		const newId = newItem ? idSelector(newItem) : null;

		if (oldId === null || newId === null) {
			continue;
		}

		if (oldId === newId) {
			const item = list.get(index);
			if (isContainer(item)) {
				changes.push(
					...diffContainer(doc, oldItem, newItem, item.id, schema?.itemSchema),
				);
			} else if (!deepEqual(oldItem, newItem)) {
				changes.push({
					container: containerId,
					key: index + offset,
					value: undefined,
					kind: "delete",
				});
				changes.push(
					tryUpdateToInsertContainer(
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
			newIndex++;
			continue;
		}

		if (newId && !oldItemsById.has(newId)) {
			changes.push(
				tryUpdateToInsertContainer(
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
			index--;
			offset++;
			newIndex++;
			continue;
		}

		changes.push({
			container: containerId,
			key: index + offset,
			value: undefined,
			kind: "delete",
		});
		offset--;
	}

	for (; newIndex < newState.length; newIndex++) {
		const newItem = newState[newIndex];
		changes.push(
			tryUpdateToInsertContainer(
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

export function diffList(
	doc: LoroDoc,
	oldState: unknown[],
	newState: unknown[],
	containerId: ContainerID,
	schema: LoroListSchema<SchemaType> | undefined,
): Change[] {
	const changes: Change[] = [];
	const oldLen = oldState.length;
	const newLen = newState.length;
	const minLen = Math.min(oldLen, newLen);
	const list = doc.getList(containerId);

	for (let i = 0; i < minLen; i++) {
		if (oldState[i] === newState[i]) continue;

		const itemOnLoro = list.get(i);
		if (isContainer(itemOnLoro)) {
			const nestedChanges = diffContainer(
				doc,
				oldState[i],
				newState[i],
				itemOnLoro.id,
				schema?.itemSchema,
			);
			changes.push(...nestedChanges);
		} else if (!deepEqual(oldState[i], newState[i])) {
			changes.push({
				container: containerId,
				key: i,
				value: undefined,
				kind: "delete",
			});
			changes.push(
				tryUpdateToInsertContainer(
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

	for (let i = newLen; i < oldLen; i++) {
		changes.push({
			container: containerId,
			key: i,
			value: undefined,
			kind: "delete",
		});
	}

	for (let i = oldLen; i < newLen; i++) {
		changes.push(
			tryUpdateToInsertContainer(
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

	return changes;
}

export function diffMap<D extends Record<string, unknown>>(
	doc: LoroDoc,
	oldState: D,
	newState: D,
	containerId: ContainerID | "",
	schema: LoroMapSchema<Record<string, SchemaType>> | undefined,
): Change[] {
	const changes: Change[] = [];
	const oldStateObj = oldState as Record<string, any>;
	const newStateObj = newState as Record<string, any>;

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
			childSchema?.getContainerType() ?? tryInferContainerType(newItem);

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
					let container = getRootContainerByType(doc, key, containerType);
					changes.push(
						...diffContainer(
							doc,
							oldStateObj[key],
							newStateObj[key],
							container.id,
							childSchema,
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
					changes.push(insertChildToMap(containerId, key, newStateObj[key]));
				} else {
					changes.push(
						...diffContainer(
							doc,
							oldStateObj[key],
							newStateObj[key],
							child.id,
							childSchema,
						),
					);
				}
				// The type of the child has changed
				// Either it was previously a container and now it's not
				// or it was not a container and now it is
			} else {
				changes.push(insertChildToMap(containerId, key, newStateObj[key]));
			}
		}
	}

	return changes;
}
