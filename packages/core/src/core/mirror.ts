/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { produce } from "immer";
import {
    Container,
    ContainerID,
    Diff,
    LoroDoc,
    LoroEvent,
    LoroEventBatch,
    LoroList,
    LoroMap,
    LoroText,
} from "loro-crdt";
import {
    getDefaultValue,
    InferType,
    SchemaType,
    validateSchema,
} from "../schema";
import { deepEqual, isObject } from "./utils";

/**
 * Sync direction for handling updates
 */
export enum SyncDirection {
    /**
     * Changes coming from Loro to application state
     */
    FROM_LORO = "FROM_LORO",

    /**
     * Changes going from application state to Loro
     */
    TO_LORO = "TO_LORO",

    /**
     * Initial sync or manual sync operations
     */
    BIDIRECTIONAL = "BIDIRECTIONAL",
}

/**
 * Configuration options for the Mirror
 */
export interface MirrorOptions<S extends SchemaType> {
    /**
     * The Loro document to sync with
     */
    doc: LoroDoc;

    /**
     * The schema definition for the state
     */
    schema: S;

    /**
     * Initial state (optional)
     */
    initialState?: Partial<InferType<S>>;

    /**
     * Whether to validate state updates against the schema
     * @default true
     */
    validateUpdates?: boolean;

    /**
     * Whether to throw errors on validation failures
     * @default false
     */
    throwOnValidationError?: boolean;

    /**
     * Debug mode - logs operations
     * @default false
     */
    debug?: boolean;
}

/**
 * Callback type for subscribers
 */
export type SubscriberCallback<T> = (
    state: T,
    direction: SyncDirection,
) => void;

/**
 * Mirror class that provides bidirectional sync between application state and Loro
 */
export class Mirror<S extends SchemaType> {
    private doc: LoroDoc;
    private schema: S;
    private state: InferType<S>;
    private subscribers: Set<SubscriberCallback<InferType<S>>> = new Set();
    private syncing: boolean = false;
    private options: Required<MirrorOptions<S>>;

    // Map of container IDs to their containers
    private containerRegistry: Map<ContainerID, Container> = new Map();

    // WeakMap to cache container paths for performance
    private containerPathCache: WeakMap<Container, string[]> = new WeakMap();

    // Unsubscribe functions for container subscriptions
    private containerSubscriptions: Map<ContainerID, () => void> = new Map();

    /**
     * Creates a new Mirror instance
     */
    constructor(options: MirrorOptions<S>) {
        this.doc = options.doc;
        this.schema = options.schema;

        // Set default options
        this.options = {
            doc: options.doc,
            schema: options.schema,
            initialState: options.initialState || {},
            validateUpdates: options.validateUpdates !== false,
            throwOnValidationError: options.throwOnValidationError || false,
            debug: options.debug || false,
        };

        // Initialize state with defaults and initial state
        this.state = {
            ...getDefaultValue(this.schema),
            ...this.options.initialState,
        } as InferType<S>;

        // Initialize Loro containers and setup subscriptions
        this.initializeContainers();

        // Subscribe to the root doc for global updates
        this.doc.subscribe(this.handleLoroEvent);
    }

    /**
     * Initialize containers based on schema
     */
    private initializeContainers() {
        if (this.schema.type !== "schema") {
            throw new Error('Root schema must be of type "schema"');
        }

        // Get the initial state of the doc
        const currentDocState = this.doc.toJSON();

        // Update the state with the doc's current state
        const newState = produce<InferType<S>>((draft) => {
            Object.assign(draft, currentDocState);
        })(this.state);

        this.state = newState;

        // Register root containers
        for (const key in this.schema.definition) {
            if (
                Object.prototype.hasOwnProperty.call(
                    this.schema.definition,
                    key,
                )
            ) {
                const fieldSchema = this.schema.definition[key];

                if (
                    ["loro-map", "loro-list", "loro-text"].includes(
                        fieldSchema.type,
                    )
                ) {
                    this.registerContainer(key, [key]);
                }
            }
        }
    }

    /**
     * Register a container with the Mirror
     */
    private registerContainer(name: string, path: string[]) {
        try {
            let container: Container;

            // Get the container based on name
            if (name.includes("cid:")) {
                // Direct container ID reference
                container = this.doc.getContainerById(name as ContainerID)!;
            } else {
                // Root container by name
                const schema = this.getSchemaForPath(path);

                if (!schema) {
                    if (this.options.debug) {
                        console.warn(
                            `No schema found for path: ${path.join(".")}`,
                        );
                    }
                    return;
                }

                switch (schema.type) {
                    case "loro-map":
                        container = this.doc.getMap(name);
                        break;
                    case "loro-list":
                        container = this.doc.getList(name);
                        break;
                    case "loro-text":
                        container = this.doc.getText(name);
                        break;
                    default:
                        if (this.options.debug) {
                            console.warn(
                                `Unsupported container type: ${schema.type}`,
                            );
                        }
                        return;
                }
            }

            if (!container) {
                return;
            }

            const containerId = container.id;

            // Store container in registry
            this.containerRegistry.set(containerId, container);

            // Cache the path for this container
            this.containerPathCache.set(container, path);

            // Subscribe to container events
            const unsubscribe = container.subscribe(this.handleContainerEvent);
            this.containerSubscriptions.set(containerId, unsubscribe);

            // Register nested containers
            this.registerNestedContainers(container, path);
        } catch (error) {
            if (this.options.debug) {
                console.error(
                    `Error registering container: ${name}`,
                    error,
                );
            }
        }
    }

    /**
     * Register nested containers within a container
     */
    private registerNestedContainers(
        container: Container,
        parentPath: string[],
    ) {
        // Skip if not attached or has no getShallowValue
        if (!container.isAttached || !("getShallowValue" in container)) {
            return;
        }

        try {
            const shallowValue = (container as any).getShallowValue();

            if (container.kind() === "Map") {
                // For maps, check each value
                const map = container as LoroMap;
                for (const [key, value] of Object.entries(shallowValue)) {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(
                            value as ContainerID,
                        );
                        if (nestedContainer) {
                            const nestedPath = [...parentPath, key];
                            this.registerContainer(
                                value as ContainerID,
                                nestedPath,
                            );
                        }
                    }
                }
            } else if (container.kind() === "List") {
                // For lists, check each item
                const list = container as LoroList;
                shallowValue.forEach((value: any, index: number) => {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(
                            value as ContainerID,
                        );
                        if (nestedContainer) {
                            const nestedPath = [
                                ...parentPath,
                                index.toString(),
                            ];
                            this.registerContainer(
                                value as ContainerID,
                                nestedPath,
                            );
                        }
                    }
                });
            }
        } catch (error) {
            if (this.options.debug) {
                console.error(
                    `Error registering nested containers for ${container.id}:`,
                    error,
                );
            }
        }
    }

    /**
     * Get schema definition for a specific path
     */
    private getSchemaForPath(path: string[]): SchemaType | null {
        let currentSchema: SchemaType = this.schema;

        for (let i = 0; i < path.length; i++) {
            const part = path[i];

            if (
                currentSchema.type === "schema" ||
                currentSchema.type === "loro-map"
            ) {
                if (
                    !currentSchema.definition || !currentSchema.definition[part]
                ) {
                    return null;
                }
                currentSchema = currentSchema.definition[part];
            } else if (currentSchema.type === "loro-list") {
                // For lists, we only care about the item schema
                currentSchema = currentSchema.itemSchema;
            } else {
                return null;
            }
        }

        return currentSchema;
    }

    /**
     * Handle events from the LoroDoc
     */
    private handleLoroEvent = (event: LoroEventBatch) => {
        if (this.syncing) return;
        if (event.origin === "to-loro") return;

        this.syncing = true;
        try {
            // Get the current state of the doc
            const currentDocState = this.doc.toJSON();

            // Update the state with the current doc state
            const newState = produce<InferType<S>>((draft) => {
                Object.assign(draft, currentDocState);
            })(this.state);

            this.state = newState;

            // Check for new containers in the events
            this.processEventsForContainers(event);

            // Notify subscribers of the update
            this.notifySubscribers(SyncDirection.FROM_LORO);
        } finally {
            this.syncing = false;
        }
    };

    /**
     * Process Loro events to detect new containers
     */
    private processEventsForContainers(event: LoroEventBatch) {
        for (const loroEvent of event.events) {
            // Check if we already know about this container
            if (!this.containerRegistry.has(loroEvent.target)) {
                try {
                    const container = this.doc.getContainerById(
                        loroEvent.target,
                    );
                    if (container) {
                        // Try to determine the path for this container
                        const path = this.doc.getPathToContainer(
                            loroEvent.target,
                        );
                        if (path) {
                            this.registerContainer(
                                loroEvent.target,
                                path.map((p) => p.toString()),
                            );
                        }
                    }
                } catch (error) {
                    if (this.options.debug) {
                        console.error(
                            `Error processing event for container ${loroEvent.target}:`,
                            error,
                        );
                    }
                }
            }
        }
    }

    /**
     * Handle events from individual containers
     */
    private handleContainerEvent = (event: LoroEventBatch) => {
        if (this.syncing) return;
        if (event.origin === "to-loro") return;

        this.syncing = true;
        try {
            // Build a complete new state from the document
            const currentDocState = this.doc.toJSON();

            // Update the app state to match
            const newState = produce<InferType<S>>((draft) => {
                Object.assign(draft, currentDocState);
            })(this.state);

            this.state = newState;

            // Check if new containers were created
            for (const loroEvent of event.events) {
                if (!this.containerRegistry.has(loroEvent.target)) {
                    try {
                        const container = this.doc.getContainerById(
                            loroEvent.target,
                        );
                        if (container) {
                            // Try to determine the path for this container
                            const path = this.doc.getPathToContainer(
                                loroEvent.target,
                            );
                            if (path) {
                                this.registerContainer(
                                    loroEvent.target,
                                    path.map((p) => p.toString()),
                                );
                            }
                        }
                    } catch (error) {
                        if (this.options.debug) {
                            console.error(
                                `Error processing container event:`,
                                error,
                            );
                        }
                    }
                }
            }

            // Notify subscribers
            this.notifySubscribers(SyncDirection.FROM_LORO);
        } finally {
            this.syncing = false;
        }
    };

    /**
     * Update Loro based on state changes
     */
    private updateLoro(newState: InferType<S>) {
        if (this.syncing) return;

        this.syncing = true;
        try {
            // Find the differences between current Loro state and new state
            const currentDocState = this.state;
            const changes = this.findChanges(currentDocState, newState);

            // Apply the changes to the Loro document
            this.applyChangesToLoro(changes);
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Apply a set of changes to the Loro document
     */
    private applyChangesToLoro(
        changes: Array<
            { container: ContainerID | ""; key: string | number; value: any }
        >,
    ) {
        // Group changes by container for batch processing
        const changesByContainer = new Map<
            ContainerID | "",
            Array<{ key: string | number; value: any }>
        >();

        for (const change of changes) {
            if (!changesByContainer.has(change.container)) {
                changesByContainer.set(change.container, []);
            }
            changesByContainer.get(change.container)!.push({
                key: change.key,
                value: change.value,
            });
        }

        // Process changes by container
        for (
            const [containerId, containerChanges] of changesByContainer
                .entries()
        ) {
            if (containerId === "") {
                // Handle root level changes
                this.applyRootChanges(containerChanges);
            } else {
                // Handle container-specific changes
                const container = this.containerRegistry.get(
                    containerId as ContainerID,
                );
                if (container) {
                    this.applyContainerChanges(container, containerChanges);
                } else {
                    throw new Error(
                        `Container not found for ID: ${containerId}. This is likely due to a stale reference or a synchronization issue.`,
                    );
                }
            }
        }
        this.doc.commit({ origin: "to-loro" });
    }

    /**
     * Apply changes to root-level fields
     */
    private applyRootChanges(
        changes: Array<{ key: string | number; value: any }>,
    ) {
        for (const { key, value } of changes) {
            const keyStr = key.toString();

            // Find the container for this key
            const container = this.findContainerForPath(keyStr);
            if (container) {
                // Apply direct changes to the container
                this.updateTopLevelContainer(container, value);
            } else if (
                this.schema.type === "schema" && this.schema.definition &&
                this.schema.definition[keyStr]
            ) {
                // This is a valid field in the schema but the container doesn't exist yet
                // This is normal for new fields, so we don't throw an error
                if (this.options.debug) {
                    console.warn(
                        `No container found for root key: ${keyStr}, but it exists in schema. This might be a new field.`,
                    );
                }
            } else {
                throw new Error(
                    `No container found for root key: ${keyStr}. This key may not be defined in the schema.`,
                );
            }
        }
    }

    /**
     * Update a top-level container directly with a new value
     */
    private updateTopLevelContainer(container: Container, value: any) {
        const kind = container.kind();

        switch (kind) {
            case "Text":
                this.updateTextContainer(container as LoroText, [], value);
                break;
            case "List":
                this.updateListContainer(container as LoroList, [], value);
                break;
            case "Map":
                this.updateMapContainer(container as LoroMap, [], value);
                break;
            default:
                throw new Error(
                    `Unknown container kind for top-level update: ${kind}. This is likely a programming error or unsupported container type.`,
                );
        }
    }

    /**
     * Apply multiple changes to a container
     */
    private applyContainerChanges(
        container: Container,
        changes: Array<{ key: string | number; value: any }>,
    ) {
        const kind = container.kind();

        switch (kind) {
            case "Map": {
                const map = container as LoroMap;
                for (const { key, value } of changes) {
                    if (value === undefined) {
                        map.delete(key.toString());
                    } else {
                        // Find container schema for proper handling
                        const containerPath = this.getContainerPath(container);
                        if (!containerPath) {
                            throw new Error(
                                `Cannot determine path for container: ${container.id}. This is likely due to a detached container.`,
                            );
                        }

                        const schema = this.getSchemaForPath(containerPath);
                        this.updateMapEntry(map, key.toString(), value, schema);
                    }
                }
                break;
            }
            case "List": {
                const list = container as LoroList;

                // Collect all changes to process in the right order
                const indexedChanges = changes
                    .filter((change) => !isNaN(Number(change.key)))
                    .map((change) => ({
                        index: Number(change.key),
                        value: change.value,
                    }))
                    .sort((a, b) => a.index - b.index);

                if (indexedChanges.length > 0) {
                    // Get container schema for proper handling
                    const containerPath = this.getContainerPath(container);
                    if (!containerPath) {
                        throw new Error(
                            `Cannot determine path for container: ${container.id}. This is likely due to a detached container.`,
                        );
                    }

                    const schema = this.getSchemaForPath(containerPath);
                    const itemSchema = schema && schema.type === "loro-list"
                        ? schema.itemSchema
                        : null;

                    if (!itemSchema) {
                        throw new Error(
                            `No item schema found for list container: ${container.id}. This suggests a schema validation issue.`,
                        );
                    }

                    for (const { index, value } of indexedChanges) {
                        if (value === undefined) {
                            // Delete item
                            if (index >= 0 && index < list.length) {
                                list.delete(index, 1);
                            } else {
                                throw new Error(
                                    `Cannot delete item at index ${index} in list with length ${list.length}. Index out of bounds.`,
                                );
                            }
                        } else if (index >= 0 && index < list.length) {
                            // Update existing item
                            list.delete(index, 1);
                            this.insertItemIntoList(
                                list,
                                index,
                                value,
                                itemSchema,
                            );
                        } else if (index === list.length) {
                            // Append item
                            this.insertItemIntoList(
                                list,
                                index,
                                value,
                                itemSchema,
                            );
                        } else {
                            throw new Error(
                                `Cannot update item at index ${index} in list with length ${list.length}. Index out of bounds.`,
                            );
                        }
                    }
                } else if (
                    changes.length === 1 && changes[0].key === "length"
                ) {
                    // Special case for length property
                    const newLength = Number(changes[0].value);
                    if (!isNaN(newLength) && newLength >= 0) {
                        if (newLength < list.length) {
                            // Truncate the list
                            list.delete(newLength, list.length - newLength);
                        }
                    } else {
                        throw new Error(
                            `Invalid length value: ${
                                changes[0].value
                            }. Length must be a non-negative number.`,
                        );
                    }
                }
                break;
            }
            case "Text": {
                const text = container as LoroText;
                // For text, we only handle the direct value update
                if (changes.length === 1 && changes[0].key === "value") {
                    const newText = String(changes[0].value || "");
                    text.update(newText);
                } else {
                    throw new Error(
                        `Unsupported operation on text container: ${container.id}. Text containers only support 'value' updates.`,
                    );
                }
                break;
            }
            default:
                throw new Error(
                    `Unknown container kind: ${kind}. This is likely a programming error or unsupported container type.`,
                );
        }
    }

    /**
     * Update a Text container
     */
    private updateTextContainer(text: LoroText, path: string[], value: any) {
        if (path.length === 0) {
            // Update entire text content
            const newText = String(value || "");
            text.update(newText);
        }
        // Text containers don't support other operations
    }

    /**
     * Update a List container
     */
    private updateListContainer(list: LoroList, path: string[], value: any) {
        if (path.length === 0) {
            // Replace entire list
            if (Array.isArray(value)) {
                // Find the schema for this container path
                const containerPath = this.getContainerPath(list);
                if (!containerPath) {
                    if (this.options.debug) {
                        console.warn(
                            `No container path found for list: ${list.id}`,
                        );
                    }
                    return;
                }

                const schema = this.getSchemaForPath(containerPath);
                if (!schema || schema.type !== "loro-list") {
                    if (this.options.debug) {
                        console.warn(
                            `No valid schema found for list: ${list.id}`,
                        );
                    }
                    return;
                }

                // Get the idSelector function from the schema
                const idSelector = schema.idSelector;
                const itemSchema = schema.itemSchema;

                // If we have an ID selector, use it for more efficient updates
                if (idSelector) {
                    this.updateListWithIdSelector(
                        list,
                        value,
                        idSelector,
                        itemSchema,
                    );
                } else {
                    this.updateListByIndex(list, value, itemSchema);
                }
            }
        } else if (path.length === 1) {
            // Update a specific index
            this.updateListItemByIndex(list, path[0], value);
        }
    }

    /**
     * Update a list using ID selector for efficient updates
     *
     * This method:
     * 1. Maps current and new items by their IDs
     * 2. Identifies items to add, remove, or update
     * 3. Applies minimal operations to achieve the target state
     */
    private updateListWithIdSelector(
        list: LoroList,
        newItems: any[],
        idSelector: (item: any) => string,
        itemSchema: SchemaType,
    ) {
        // Get current list items
        const currentItems = [];
        for (let i = 0; i < list.length; i++) {
            currentItems.push(list.get(i));
        }

        // Create maps for current and new items by ID
        const currentItemMap = new Map();
        const newItemMap = new Map();
        const newPositions = new Map(); // Map ID to its position in the new array

        // Map current items
        for (const item of currentItems) {
            try {
                const id = idSelector(item);
                if (id) {
                    currentItemMap.set(id, item);
                }
            } catch (error) {
                if (this.options.debug) {
                    console.warn(`Error getting ID for item: ${error}`);
                }
            }
        }

        // Map new items and their positions
        newItems.forEach((item, index) => {
            try {
                const id = idSelector(item);
                if (id) {
                    newItemMap.set(id, item);
                    newPositions.set(id, index);
                }
            } catch (error) {
                if (this.options.debug) {
                    console.warn(`Error getting ID for new item: ${error}`);
                }
            }
        });

        // Find items to remove (in current but not in new)
        const idsToRemove = [];
        for (const [id] of currentItemMap) {
            if (!newItemMap.has(id)) {
                idsToRemove.push(id);
            }
        }

        // Find items to add (in new but not in current)
        const idsToAdd = [];
        for (const [id] of newItemMap) {
            if (!currentItemMap.has(id)) {
                idsToAdd.push(id);
            }
        }

        // Find items to update (in both but potentially changed)
        const idsToUpdate = [];
        for (const [id] of currentItemMap) {
            if (newItemMap.has(id)) {
                const currentItem = currentItemMap.get(id);
                const newItem = newItemMap.get(id);
                if (!deepEqual(currentItem, newItem)) {
                    idsToUpdate.push(id);
                }
            }
        }

        // Apply removals (remove from end to start to avoid index shifts)
        for (let i = list.length - 1; i >= 0; i--) {
            const item = list.get(i);
            try {
                const id = idSelector(item);
                if (id && idsToRemove.includes(id)) {
                    list.delete(i, 1);
                }
            } catch (error) {
                if (this.options.debug) {
                    console.warn(`Error removing item: ${error}`);
                }
            }
        }

        // Apply updates
        for (let i = 0; i < list.length; i++) {
            const item = list.get(i);
            try {
                const id = idSelector(item);
                if (id && idsToUpdate.includes(id)) {
                    const newItem = newItemMap.get(id);

                    // Remove and re-insert for now (future optimization: support partial updates)
                    list.delete(i, 1);
                    this.insertItemIntoList(list, i, newItem, itemSchema);
                }
            } catch (error) {
                if (this.options.debug) {
                    console.warn(`Error updating item: ${error}`);
                }
            }
        }

        // Apply additions (at their correct position in the new array)
        for (const id of idsToAdd) {
            const newItem = newItemMap.get(id);
            const targetPosition = newPositions.get(id);

            if (targetPosition !== undefined) {
                // Insert at specified position
                this.insertItemIntoList(
                    list,
                    targetPosition,
                    newItem,
                    itemSchema,
                );
            }
        }
    }

    /**
     * Update a list by comparing items at each index
     *
     * Used when no ID selector is available. Less efficient than ID-based updates
     * but still tries to minimize operations by only changing what's needed.
     */
    private updateListByIndex(
        list: LoroList,
        newItems: any[],
        itemSchema: SchemaType,
    ) {
        const currentLength = list.length;
        const newLength = newItems.length;

        // Update existing items where possible
        const minLength = Math.min(currentLength, newLength);
        for (let i = 0; i < minLength; i++) {
            const currentItem = list.get(i);
            const newItem = newItems[i];

            if (!deepEqual(currentItem, newItem)) {
                list.delete(i, 1);
                this.insertItemIntoList(list, i, newItem, itemSchema);
            }
        }

        // Remove extra items if the new list is shorter
        if (currentLength > newLength) {
            list.delete(newLength, currentLength - newLength);
        }

        // Add new items if the new list is longer
        for (let i = minLength; i < newLength; i++) {
            this.insertItemIntoList(list, i, newItems[i], itemSchema);
        }
    }

    /**
     * Helper to insert an item into a list, handling containers appropriately
     */
    private insertItemIntoList(
        list: LoroList,
        index: number,
        item: any,
        itemSchema: SchemaType,
    ) {
        // Determine if the item should be a container
        const isContainer = itemSchema.type === "loro-map" ||
            itemSchema.type === "loro-list" ||
            itemSchema.type === "loro-text";

        if (isContainer && typeof item === "object" && item !== null) {
            const container = this.createContainer(item, itemSchema);
            list.insertContainer(index, container);
            return;
        }

        // Default to simple insert
        list.insert(index, item);
    }

    /**
     * Update a specific item in a list by index
     */
    private updateListItemByIndex(
        list: LoroList,
        indexStr: string,
        value: any,
    ) {
        const index = parseInt(indexStr, 10);
        if (isNaN(index) || index < 0 || index >= list.length) {
            return;
        }

        // Replace the item with new value
        list.delete(index, 1);

        // Use the schema to determine if this should be a container
        const containerPath = this.getContainerPath(list);
        if (containerPath) {
            const schema = this.getSchemaForPath(containerPath);
            if (schema && schema.type === "loro-list") {
                const itemSchema = schema.itemSchema;
                this.insertItemIntoList(list, index, value, itemSchema);
                return;
            }
        }

        // Default to simple insert
        list.insert(index, value);
    }

    /**
     * Update a Map container
     */
    private updateMapContainer(map: LoroMap, path: string[], value: any) {
        if (path.length === 0) {
            // Replace entire map
            if (isObject(value)) {
                // Find the schema for this container path
                const containerPath = this.getContainerPath(map);
                if (!containerPath) {
                    if (this.options.debug) {
                        console.warn(
                            `No container path found for map: ${map.id}`,
                        );
                    }
                    return;
                }

                const schema = this.getSchemaForPath(containerPath);
                if (!schema || schema.type !== "loro-map") {
                    if (this.options.debug) {
                        console.warn(
                            `No valid schema found for map: ${map.id}`,
                        );
                    }
                    return;
                }

                // Get current keys
                const currentKeys = new Set(map.keys());

                // Process each field in the new value
                for (const [key, val] of Object.entries(value)) {
                    this.updateMapEntry(map, key, val, schema);
                    currentKeys.delete(key);
                }

                // Delete keys that are no longer present
                for (const key of currentKeys) {
                    map.delete(key);
                }
            }
        } else if (path.length === 1) {
            // Update a specific key
            const key = path[0];

            // Find the schema for this container path
            const containerPath = this.getContainerPath(map);
            if (!containerPath) {
                if (this.options.debug) {
                    console.warn(
                        `No container path found for map: ${map.id}`,
                    );
                }
                return;
            }

            const schema = this.getSchemaForPath(containerPath);

            // Update the map entry
            this.updateMapEntry(map, key, value, schema);
        }
    }

    /**
     * Helper to update a single entry in a map
     */
    private updateMapEntry(
        map: LoroMap,
        key: string,
        value: any,
        schema: SchemaType | null,
    ) {
        // Check if this field should be a container according to schema
        if (schema && schema.type === "loro-map" && schema.definition) {
            const fieldSchema = schema.definition[key];
            if (fieldSchema) {
                const isContainer = fieldSchema.type === "loro-map" ||
                    fieldSchema.type === "loro-list" ||
                    fieldSchema.type === "loro-text";

                if (
                    isContainer && typeof value === "object" && value !== null
                ) {
                    const container = this.createContainer(
                        value,
                        fieldSchema,
                    );
                    if (container) {
                        map.setContainer(key, container);
                    }
                }
            }
        }

        // Default to simple set
        map.set(key, value);
    }

    /**
     * Find a container for a given path string
     */
    private findContainerForPath(pathStr: string): Container | null {
        // Check all containers to find one with this path
        for (const container of this.containerRegistry.values()) {
            const containerPath = this.getContainerPath(container);
            if (containerPath && containerPath.join(".") === pathStr) {
                return container;
            }
        }
        return null;
    }

    /**
     * Get the path for a container, using cache when available
     */
    private getContainerPath(container: Container): string[] | null {
        // Check cache first
        const cachedPath = this.containerPathCache.get(container);
        if (cachedPath) {
            return cachedPath;
        }

        // Get path from doc
        const path = this.doc.getPathToContainer(container.id);
        if (path) {
            const stringPath = path.map((p) => p.toString());
            // Cache the result
            this.containerPathCache.set(container, stringPath);
            return stringPath;
        }

        if (!container.isAttached) {
            throw new Error(
                `Container ${container.id} is not attached to the document. This is likely due to a detached container.`,
            );
        }

        return null;
    }

    /**
     * Get current state
     */
    getState(): InferType<S> {
        return this.state;
    }

    /**
     * Update state and propagate changes to Loro
     */
    setState(
        updater:
            | ((state: InferType<S>) => InferType<S>)
            | Partial<InferType<S>>,
    ) {
        if (this.syncing) return; // Prevent recursive updates

        // Calculate new state
        const newState = typeof updater === "function"
            ? updater(this.state)
            : { ...this.state, ...updater };

        // Validate state if needed
        if (this.options.validateUpdates) {
            const validation = validateSchema(this.schema, newState);
            if (!validation.valid) {
                const errorMessage = `State validation failed: ${
                    validation.errors?.join(", ")
                }`;
                throw new Error(errorMessage);
            }
        }

        // Update Loro based on new state
        this.updateLoro(newState);

        // Update the in-memory state
        this.state = newState;

        // Notify subscribers
        this.notifySubscribers(SyncDirection.TO_LORO);
    }

    /**
     * Find changes between old and new state
     */
    private findChanges(
        oldState: unknown,
        newState: unknown,
        path: string[] = [],
    ): Array<
        { container: ContainerID | ""; key: string | number; value: any }
    > {
        const changes: Array<
            { container: ContainerID | ""; key: string | number; value: any }
        > = [];

        if (!isObject(oldState) || !isObject(newState)) {
            // Simple value comparison
            if (!deepEqual(oldState, newState)) {
                // For root level changes, path will be empty
                // We need to handle this case specially when applying changes
                changes.push({
                    container: "",
                    key: path.join("."),
                    value: newState,
                });
            }
            return changes;
        }

        // Find the container for this path
        const container = path.length > 0
            ? this.findContainerForPath(path.join("."))
            : null;
        const containerId = container ? container.id : "";

        // Check for removed keys
        for (const key in oldState) {
            if (!(key in newState)) {
                if (path.length === 0) {
                    // Root level property removal
                    changes.push({ container: "", key, value: undefined });
                } else {
                    // Nested property removal
                    changes.push({
                        container: containerId,
                        key,
                        value: undefined,
                    });
                }
            }
        }

        // Check for added or modified keys
        for (const key in newState) {
            if (!(key in oldState)) {
                if (path.length === 0) {
                    // Root level property addition
                    changes.push({ container: "", key, value: newState[key] });
                } else {
                    // Nested property addition
                    changes.push({
                        container: containerId,
                        key,
                        value: newState[key],
                    });
                }
            } else if (!deepEqual(oldState[key], newState[key])) {
                if (isObject(oldState[key]) && isObject(newState[key])) {
                    // Recursively find changes in nested objects
                    changes.push(
                        ...this.findChanges(oldState[key], newState[key], [
                            ...path,
                            key,
                        ]),
                    );
                } else {
                    if (path.length === 0) {
                        // Root level property modification
                        changes.push({
                            container: "",
                            key,
                            value: newState[key],
                        });
                    } else {
                        // Nested property modification
                        changes.push({
                            container: containerId,
                            key,
                            value: newState[key],
                        });
                    }
                }
            }
        }

        return changes;
    }

    /**
     * Subscribe to state changes
     */
    subscribe(callback: SubscriberCallback<InferType<S>>): () => void {
        this.subscribers.add(callback);

        // Return unsubscribe function
        return () => {
            this.subscribers.delete(callback);
        };
    }

    /**
     * Notify all subscribers of state change
     */
    private notifySubscribers(direction: SyncDirection) {
        for (const subscriber of this.subscribers) {
            subscriber(this.state, direction);
        }
    }

    /**
     * Sync application state from Loro (one way)
     */
    syncFromLoro(): InferType<S> {
        if (this.syncing) return this.state;

        this.syncing = true;
        try {
            // Get the current state from the document
            const docState = this.doc.toJSON();

            // Update the application state
            const newState = produce<InferType<S>>((draft) => {
                Object.assign(draft, docState);
            })(this.state);

            this.state = newState;

            this.notifySubscribers(SyncDirection.FROM_LORO);
        } finally {
            this.syncing = false;
        }

        return this.state;
    }

    /**
     * Sync Loro from application state (one way)
     */
    syncToLoro() {
        if (this.syncing) return;

        this.syncing = true;
        try {
            // Update Loro based on current state
            this.updateLoro(this.state);

            this.notifySubscribers(SyncDirection.TO_LORO);
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Full bidirectional sync
     */
    sync() {
        if (this.syncing) return this.state;

        // First sync from Loro to get latest state
        this.syncFromLoro();

        // Then sync back to Loro
        this.syncToLoro();

        return this.state;
    }

    /**
     * Clean up resources
     */
    dispose() {
        // Unsubscribe from all container subscriptions
        for (const [_, unsubscribe] of this.containerSubscriptions) {
            unsubscribe();
        }

        // Clear all collections
        this.containerRegistry.clear();
        this.containerPathCache = new WeakMap();
        this.containerSubscriptions.clear();
        this.subscribers.clear();
    }

    /**
     * Find or create a container for a value based on its schema
     */
    private createContainer(
        value: any,
        schema: SchemaType,
    ): Container {
        if (schema.type === "loro-map") {
            // Generate a unique ID for the map
            const map = new LoroMap();

            // Populate the map with values
            if (isObject(value)) {
                for (const [key, val] of Object.entries(value)) {
                    if (schema.definition && schema.definition[key]) {
                        const fieldSchema = schema.definition[key];
                        const isContainer = fieldSchema.type === "loro-map" ||
                            fieldSchema.type === "loro-list" ||
                            fieldSchema.type === "loro-text";

                        if (
                            isContainer && typeof val === "object" &&
                            val !== null
                        ) {
                            const container = this.createContainer(
                                val,
                                fieldSchema,
                            );
                            if (container) {
                                map.setContainer(key, container);
                            }
                        }

                        // Default to simple set
                        map.set(key, val);
                    }
                }
            }

            return map;
        } else if (schema.type === "loro-list") {
            // Generate a unique ID for the list
            const list = new LoroList();

            // Populate the list with values
            if (Array.isArray(value)) {
                const itemSchema = schema.itemSchema;
                const isContainer = itemSchema.type === "loro-map" ||
                    itemSchema.type === "loro-list" ||
                    itemSchema.type === "loro-text";

                for (let i = 0; i < value.length; i++) {
                    const item = value[i];

                    if (
                        isContainer && typeof item === "object" &&
                        item !== null
                    ) {
                        const container = this.createContainer(
                            item,
                            itemSchema,
                        );
                        if (container) {
                            list.insertContainer(i, container);
                        }
                    }

                    // Default to simple insert
                    list.insert(i, item);
                }
            }

            return list;
        } else if (schema.type === "loro-text") {
            // Generate a unique ID for the text
            const text = new LoroText();

            // Set the text content
            if (typeof value === "string") {
                text.update(value);
            }

            return text;
        } else {
            throw new Error(`Unknown schema type: ${schema.type}`);
        }
    }
}
