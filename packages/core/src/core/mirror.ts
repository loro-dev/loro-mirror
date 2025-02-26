/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { produce } from "immer";
import {
    Container,
    ContainerID,
    Diff,
    isContainer,
    LoroDoc,
    LoroEvent,
    LoroEventBatch,
    LoroList,
    LoroMap,
    LoroText,
} from "loro-crdt";
import {
    ContainerSchemaType,
    getDefaultValue,
    InferType,
    LoroListSchema,
    LoroMapSchema,
    RootSchemaDefinition,
    RootSchemaType,
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

type Change = {
    container: ContainerID | "";
    key: string | number;
    value: any;
    kind: "set" | "insert" | "delete";
};

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
                    this.registerContainer(key);
                }
            }
        }
    }

    /**
     * Register a container with the Mirror
     */
    private registerContainer(name: string) {
        try {
            let container: Container;

            // Get the container based on name
            if (name.includes("cid:")) {
                // Direct container ID reference
                container = this.doc.getContainerById(name as ContainerID)!;
            } else {
                // Root container by name
                const schema = this.schema.type === "schema"
                    ? this.schema.definition[name]
                    : null;

                if (!schema) {
                    if (this.options.debug) {
                        console.warn(
                            `No schema found for container: ${name}`,
                        );
                    }
                    return;
                }

                switch (schema.type as string) {
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
                                `Unsupported container type: ${schema
                                    .type as string}`,
                            );
                        }
                        return;
                }
            }

            if (!container) {
                return;
            }

            const containerId = container.id;

            // Subscribe to container events
            const unsubscribe = container.subscribe(this.handleContainerEvent);
            this.containerSubscriptions.set(containerId, unsubscribe);

            // Register nested containers
            this.registerNestedContainers(container);
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
    private registerNestedContainers(container: Container) {
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
                            this.registerContainer(value as ContainerID);
                        }
                    }
                }
            } else if (container.kind() === "List") {
                // For lists, check each item
                const list = container as LoroList;
                shallowValue.forEach((value: any) => {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(
                            value as ContainerID,
                        );
                        if (nestedContainer) {
                            this.registerContainer(value as ContainerID);
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

            // Notify subscribers of the update
            this.notifySubscribers(SyncDirection.FROM_LORO);
        } finally {
            this.syncing = false;
        }
    };

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
            console.log(
                "currentDocState:",
                JSON.stringify(currentDocState, null, 2),
            );
            console.log("newState:", JSON.stringify(newState, null, 2));

            const changes = this.findChangesForContainer(
                currentDocState,
                newState,
                "",
                this.schema,
            );

            // Always log changes for debugging
            console.log("changes:", JSON.stringify(changes, null, 2));

            // Apply the changes to the Loro document
            this.applyChangesToLoro(changes);

            // Log the doc state after changes
            console.log(
                "Doc state after changes:",
                JSON.stringify(this.doc.toJSON(), null, 2),
            );
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Apply a set of changes to the Loro document
     */
    private applyChangesToLoro(
        changes: Change[],
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
                const container = this.doc.getContainerById(
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
     * Update root-level fields
     */
    private applyRootChanges(
        changes: Array<{ key: string | number; value: any }>,
    ) {
        for (const { key, value } of changes) {
            const keyStr = key.toString();

            // Special handling for property paths on root containers (e.g. "todos.0.completed")
            if (keyStr.includes(".")) {
                const [containerName, ...pathParts] = keyStr.split(".");

                // Get the container for this root key
                if (
                    this.schema.type === "schema" && this.schema.definition &&
                    this.schema.definition[containerName]
                ) {
                    const fieldSchema = this.schema.definition[containerName];
                    let container: Container | null = null;

                    // Create or get the container based on the schema type
                    if (fieldSchema.type === "loro-list") {
                        container = this.doc.getList(containerName);
                    } else if (fieldSchema.type === "loro-map") {
                        container = this.doc.getMap(containerName);
                    }

                    if (container) {
                        if (container.kind() === "List") {
                            const list = container as LoroList;
                            const indexStr = pathParts[0];
                            const index = parseInt(indexStr, 10);

                            if (
                                !isNaN(index) && index >= 0 &&
                                index < list.length
                            ) {
                                if (pathParts.length > 1) {
                                    // Update a nested property in a list item
                                    const propName = pathParts[1];
                                    const item = list.get(index);

                                    if (
                                        typeof item === "object" &&
                                        item !== null
                                    ) {
                                        const updatedItem = {
                                            ...(item as Record<string, any>),
                                            [propName]: value,
                                        };

                                        // Replace the item with the updated version
                                        list.delete(index, 1);
                                        list.insert(index, updatedItem);
                                    }
                                } else {
                                    // Update the entire item at index
                                    list.delete(index, 1);
                                    list.insert(index, value);
                                }
                            }
                        } else if (container.kind() === "Map") {
                            const map = container as LoroMap;
                            const propKey = pathParts[0];

                            if (propKey && propKey.length > 0) {
                                map.set(propKey, value);
                            }
                        }
                    }
                }
                continue;
            }

            // Get the appropriate container type based on schema
            if (
                this.schema.type === "schema" && this.schema.definition &&
                this.schema.definition[keyStr]
            ) {
                const fieldSchema = this.schema.definition[keyStr];
                let container: Container | null = null;

                // Create or get the container based on the schema type
                if (fieldSchema.type === "loro-map") {
                    container = this.doc.getMap(keyStr);
                } else if (fieldSchema.type === "loro-list") {
                    container = this.doc.getList(keyStr);
                } else if (fieldSchema.type === "loro-text") {
                    container = this.doc.getText(keyStr);
                }

                if (container) {
                    // Apply direct changes to the container
                    this.updateTopLevelContainer(container, value);
                } else {
                    // This may be a non-container field
                    if (this.options.debug) {
                        console.warn(
                            `No container found for root key: ${keyStr}, but it exists in schema.`,
                        );
                    }
                }
            } else {
                if (this.options.debug) {
                    console.warn(
                        `No schema definition found for root key: ${keyStr}.`,
                    );
                }
            }
        }
    }

    /**
     * Apply multiple changes to a container
     */
    private applyContainerChanges(
        container: Container,
        changes: Array<{ key: string | number; value: any }>,
    ) {
        // Apply changes in bulk by container type
        switch (container.kind()) {
            case "Map": {
                const map = container as LoroMap;

                for (const { key, value } of changes) {
                    if (key === "") {
                        continue; // Skip empty key
                    }

                    if (value === undefined) {
                        map.delete(key as string);
                    } else {
                        map.set(key as string, value);
                    }
                }
                break;
            }
            case "List": {
                const list = container as LoroList;

                // First process property path notation like "0.completed"
                const propertyChanges = new Map<
                    string,
                    { index: number; property: string; value: any }
                >();
                const otherChanges = [];

                // Split changes by type (property path vs direct index)
                for (const change of changes) {
                    const { key, value } = change;

                    if (typeof key === "string" && key.includes(".")) {
                        // Handle property path notation like "0.completed"
                        const [indexStr, ...propertyParts] = key.split(".");
                        const index = parseInt(indexStr, 10);

                        if (
                            !isNaN(index) && index >= 0 && index < list.length
                        ) {
                            const property = propertyParts.join(".");
                            propertyChanges.set(`${index}.${property}`, {
                                index,
                                property,
                                value,
                            });
                        }
                    } else {
                        // Handle direct index changes
                        otherChanges.push(change);
                    }
                }

                // Process property changes
                if (propertyChanges.size > 0) {
                    // Group by index to avoid multiple updates to the same item
                    const itemChanges = new Map<number, Map<string, any>>();

                    for (
                        const { index, property, value } of propertyChanges
                            .values()
                    ) {
                        if (!itemChanges.has(index)) {
                            itemChanges.set(index, new Map());
                        }
                        itemChanges.get(index)!.set(property, value);
                    }

                    // Apply the changes to each item
                    for (const [index, properties] of itemChanges.entries()) {
                        const item = list.get(index);

                        // Only process object items
                        if (
                            item && typeof item === "object" &&
                            !Array.isArray(item)
                        ) {
                            const newItem = { ...item } as Record<string, any>;
                            let changed = false;

                            // Apply each property change
                            for (const [prop, val] of properties.entries()) {
                                if (val === undefined) {
                                    delete newItem[prop];
                                } else {
                                    newItem[prop] = val;
                                }
                                changed = true;
                            }

                            // Only update if something actually changed
                            if (changed) {
                                list.delete(index, 1);
                                list.insert(index, newItem);
                            }
                        }
                    }
                }

                // Process other changes (add/remove/replace)
                for (const { key, value } of otherChanges) {
                    const index = typeof key === "number"
                        ? key
                        : parseInt(key as string, 10);

                    if (isNaN(index)) {
                        if (key === "length" && typeof value === "number") {
                            // Special case for length property
                            const currentLength = list.length;

                            if (value < currentLength) {
                                // Truncate the list
                                list.delete(value, currentLength - value);
                            } else if (value > currentLength) {
                                // Extend the list with undefined values
                                for (let i = currentLength; i < value; i++) {
                                    list.insert(i, undefined);
                                }
                            }
                        }
                        continue;
                    }

                    if (index < 0) {
                        console.warn(`Invalid list index: ${index}`);
                        continue;
                    }

                    if (value === undefined) {
                        // Delete item at index if in bounds
                        if (index < list.length) {
                            list.delete(index, 1);
                        }
                    } else {
                        // Insert or replace item
                        if (index < list.length) {
                            // Replace existing item
                            list.delete(index, 1);
                            list.insert(index, value);
                        } else if (index === list.length) {
                            // Append to end
                            list.insert(index, value);
                        } else {
                            // Out of bounds - warn but still attempt to insert
                            console.warn(
                                `List index out of bounds: ${index}, current length: ${list.length}`,
                            );
                            // Try to insert at the end instead
                            list.insert(list.length, value);
                        }
                    }
                }
                break;
            }
            case "Text": {
                const text = container as LoroText;

                // Text containers only support direct value updates
                for (const { key, value } of changes) {
                    if (key === "value" && typeof value === "string") {
                        text.update(value);
                    } else {
                        console.warn(
                            `Invalid Text change. Only 'value' property can be updated`,
                        );
                    }
                }
                break;
            }
            default:
                console.warn(`Unsupported container type: ${container.kind()}`);
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
                const schema = this.getSchemaForContainer(list);
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

                console.log(
                    `Updating list container, idSelector: ${!!idSelector}, current length: ${list.length}`,
                );

                // Clear out the list first to avoid duplicate items
                // Instead of clearing the entire list, which can leave it empty if there's an error,
                // we'll replace items one by one and only remove items that aren't in the new list
                if (idSelector) {
                    // If we have an ID selector, we can use it for more intelligent updates
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
     */
    private updateListWithIdSelector(
        list: LoroList,
        newItems: any[],
        idSelector: (item: any) => string | null,
        itemSchema: SchemaType,
    ) {
        // First, map current items by ID
        const currentItemsById = new Map<
            string,
            { item: any; index: number }
        >();
        const currentLength = list.length;

        for (let i = 0; i < currentLength; i++) {
            const item = list.get(i);
            try {
                if (item && typeof item === "object") {
                    const id = idSelector(item);
                    if (id) {
                        currentItemsById.set(id, { item, index: i });
                    }
                }
            } catch (e) {
                if (this.options.debug) {
                    console.warn(`Error getting ID for current list item:`, e);
                }
            }
        }

        // Then map new items by ID
        const newItemsById = new Map<string, { item: any; index: number }>();

        // Helper function to get ID from either LoroMap or plain object
        const getIdFromItem = (item: any) => {
            if (!item || typeof item !== "object") return null;

            try {
                // First try using the idSelector directly (for LoroMap objects)
                const id = idSelector(item);
                if (id) return id;
            } catch (e) {
                // If that fails, try to extract ID from plain object
                if (this.options.debug) {
                    console.warn(`Error using ID selector directly:`, e);
                }

                // If idSelector tries to call .get("id"), we can try to access .id directly
                if (typeof item.id === "string") {
                    return item.id;
                }
            }
            return null;
        };

        newItems.forEach((item, index) => {
            try {
                const id = getIdFromItem(item);
                if (id) {
                    newItemsById.set(id, { item, index });
                }
            } catch (e) {
                if (this.options.debug) {
                    console.warn(
                        `Error getting ID for new list item at index ${index}:`,
                        e,
                    );
                }
            }
        });

        console.log(
            `Current items by ID: ${currentItemsById.size}, New items by ID: ${newItemsById.size}`,
        );

        // Find items to remove (in current but not in new)
        const itemsToRemove: number[] = [];
        for (const [id, { index }] of currentItemsById.entries()) {
            if (!newItemsById.has(id)) {
                itemsToRemove.push(index);
            }
        }

        // Sort in reverse order to remove higher indices first (to avoid index shifting issues)
        itemsToRemove.sort((a, b) => b - a);

        // Remove items that aren't in the new list
        for (const index of itemsToRemove) {
            list.delete(index, 1);
        }

        // Now go through the new list and add or update items
        let currentIndex = 0;

        for (let i = 0; i < newItems.length; i++) {
            const newItem = newItems[i];
            let id: string | null = null;

            try {
                id = getIdFromItem(newItem);
            } catch (e) {
                console.warn(`Error getting ID for new item at index ${i}:`, e);
                continue;
            }

            if (!id) continue;

            const currentEntry = currentItemsById.get(id);

            if (currentEntry) {
                // Item exists, update if needed
                const currentItem = list.get(currentIndex);
                if (!deepEqual(currentItem, newItem)) {
                    // Only update if different
                    list.delete(currentIndex, 1);
                    this.insertItemIntoList(
                        list,
                        currentIndex,
                        newItem,
                        itemSchema,
                    );
                }
            } else {
                // New item, insert at current position
                this.insertItemIntoList(
                    list,
                    currentIndex,
                    newItem,
                    itemSchema,
                );
            }

            currentIndex++;
        }

        // Truncate any remaining items if the new list is shorter
        if (currentIndex < list.length) {
            list.delete(currentIndex, list.length - currentIndex);
        }
    }

    /**
     * Update a list by index (for lists without an ID selector)
     */
    private updateListByIndex(
        list: LoroList,
        newItems: any[],
        itemSchema: SchemaType,
    ) {
        // First, clear the list
        const oldLength = list.length;

        // Instead of clearing everything and re-adding, update existing items and add/remove as needed
        const maxLength = Math.max(oldLength, newItems.length);

        for (let i = 0; i < maxLength; i++) {
            if (i >= oldLength) {
                // Add new item
                this.insertItemIntoList(list, i, newItems[i], itemSchema);
            } else if (i >= newItems.length) {
                // Remove excess items, starting from the end
                list.delete(newItems.length, oldLength - newItems.length);
                break;
            } else {
                // Update existing item
                const oldItem = list.get(i);
                const newItem = newItems[i];

                if (!deepEqual(oldItem, newItem)) {
                    list.delete(i, 1);
                    this.insertItemIntoList(list, i, newItem, itemSchema);
                }
            }
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

        // Get the schema for this list
        const schema = this.getSchemaForContainer(list);
        if (schema && schema.type === "loro-list") {
            const itemSchema = schema.itemSchema;
            this.insertItemIntoList(list, index, value, itemSchema);
            return;
        }

        // Default to simple insert
        list.insert(index, value);
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

    /**
     * Get schema definition for a container
     */
    private getSchemaForContainer(container: Container): SchemaType | null {
        if (!container.isAttached) return null;

        // For root-level containers
        if (this.schema.type === "schema") {
            for (const key in this.schema.definition) {
                const fieldSchema = this.schema.definition[key];

                if (
                    fieldSchema.type === "loro-map" &&
                    this.doc.getMap(key).id === container.id
                ) {
                    return fieldSchema;
                } else if (
                    fieldSchema.type === "loro-list" &&
                    this.doc.getList(key).id === container.id
                ) {
                    return fieldSchema;
                } else if (
                    fieldSchema.type === "loro-text" &&
                    this.doc.getText(key).id === container.id
                ) {
                    return fieldSchema;
                }
            }
        }

        return null;
    }

    /**
     * Find changes between old and new state
     */
    private findChangesForContainer(
        oldState: unknown,
        newState: unknown,
        containerId: ContainerID | "",
        schema: SchemaType,
    ): Change[] {
        const changes: Change[] = [];
        if (containerId.endsWith("Text")) {
            if (oldState !== newState) {
                changes.push({
                    container: containerId,
                    key: "",
                    value: newState,
                    kind: "set",
                });
            }
            return changes;
        }

        // Handle Array (List) differently
        if (Array.isArray(oldState) && Array.isArray(newState)) {
            if (!containerId.endsWith("List")) {
                throw new Error("");
            }
            if (schema.type !== "loro-list") {
                throw new Error("");
            }

            changes.push(
                ...this.findDiffInArray(
                    containerId as ContainerID,
                    oldState,
                    newState,
                    schema as LoroListSchema<SchemaType>,
                ),
            );
            return changes;
        }

        // Handle Object (Map) changes
        const oldStateObj = oldState as Record<string, any>;
        const newStateObj = newState as Record<string, any>;

        // Check for removed keys
        for (const key in oldStateObj) {
            if (!(key in newStateObj)) {
                changes.push({
                    container: containerId,
                    key,
                    value: undefined,
                    kind: "set",
                });
            }
        }

        // Check for added or modified keys
        for (const key in newStateObj) {
            if (!(key in oldStateObj)) {
                // Key was added
                changes.push({
                    container: containerId,
                    key,
                    value: newStateObj[key],
                    kind: "set",
                });
            } else if (oldStateObj[key] !== newStateObj[key]) {
                if (
                    (typeof oldStateObj[key] === "object") &&
                    (typeof newStateObj[key] === "object")
                ) {
                    // Get the container for the nested property if it exists
                    const childSchema: ContainerSchemaType | undefined =
                        (schema as RootSchemaType<
                            Record<string, ContainerSchemaType>
                        >).definition?.[key];
                    if (!childSchema) {
                        changes.push({
                            container: containerId,
                            key,
                            value: newStateObj[key],
                            kind: "set",
                        });
                    } else {
                        let nestedContainerId: ContainerID;
                        if (!containerId) {
                            if (childSchema.type === "loro-list") {
                                nestedContainerId = this.doc.getList(key).id;
                            } else if (childSchema.type === "loro-map") {
                                nestedContainerId = this.doc.getMap(key).id;
                            } else if (childSchema.type === "loro-text") {
                                nestedContainerId = this.doc.getText(key).id;
                            } else {
                                throw new Error();
                            }
                        } else {
                            const container = this.doc.getContainerById(
                                containerId,
                            );
                            if (container?.kind() !== "Map") {
                                throw new Error();
                            }
                            const map = container as LoroMap;
                            const child = map.get(key) as Container | undefined;
                            if (!child || !isContainer(child)) {
                                throw new Error();
                            }
                            nestedContainerId = child.id;
                        }
                        changes.push(
                            ...this.findChangesForContainer(
                                oldStateObj[key],
                                newStateObj[key],
                                nestedContainerId,
                                childSchema,
                            ),
                        );
                    }
                } else {
                    // Simple value update
                    changes.push({
                        container: containerId,
                        key,
                        value: newStateObj[key],
                        kind: "set",
                    });
                }
            }
        }

        return changes;
    }

    private findDiffInArray(
        containerId: ContainerID,
        oldState: any[],
        newState: any[],
        schema: LoroListSchema<SchemaType>,
    ): Change[] {
        const changes: Change[] = [];
        if (!containerId.endsWith("List")) {
            throw new Error();
        }
        // For root level lists, we need to check if this is a container

        // This is a nested list, we already have the container ID
        const container = this.doc.getContainerById(containerId);
        const listContainer = container as LoroList;
        const listIdSelector =
            (schema as LoroListSchema<SchemaType>).idSelector;

        // Find the schema for this list
        let idSelector = listIdSelector;
        const list = container as LoroList;

        // Check if we can get the schema with idSelector for this list container
        if (!idSelector && this.schema.type === "schema") {
            for (const key in this.schema.definition) {
                const fieldSchema = this.schema.definition[key];
                if (
                    fieldSchema.type === "loro-list" &&
                    this.doc.getList(key).id === list.id
                ) {
                    idSelector = fieldSchema.idSelector;
                    console.log(
                        `Found idSelector from schema for list: ${key}, idSelector: ${!!idSelector}`,
                    );
                    break;
                }
            }
        }

        if (idSelector) {
            const ans = this.findDiffInArrayWithIdSelector(
                oldState,
                newState,
                idSelector,
                containerId,
                schema,
            );
            if (ans) {
                return ans;
            }
        }

        // Fallback to index-based comparison for arrays without idSelector
        const maxLength = Math.max(oldState.length, newState.length);
        for (let i = 0; i < maxLength; i++) {
            if (i >= oldState.length) {
                // New item added
                changes.push({
                    container: containerId,
                    key: i,
                    value: newState[i],
                    kind: "insert",
                });
            } else if (i >= newState.length) {
                // Item removed
                changes.push({
                    container: containerId,
                    key: i,
                    value: undefined,
                    kind: "delete",
                });
            } else if (oldState[i] !== newState[i]) {
                // Get the container for the nested item if it exists
                const itemOnLoro = listContainer.get(i);
                if (isContainer(itemOnLoro)) {
                    changes.push(
                        ...this.findChangesForContainer(
                            oldState[i],
                            newState[i],
                            itemOnLoro.id,
                            schema.itemSchema,
                        ),
                    );
                } else if (!deepEqual(oldState[i], newState[i])) {
                    changes.push({
                        container: containerId,
                        key: i,
                        value: undefined,
                        kind: "delete",
                    });
                    changes.push({
                        container: containerId,
                        key: i,
                        value: newState[i],
                        kind: "insert",
                    });
                }
            }
        }

        return changes;
    }

    private findDiffInArrayWithIdSelector(
        oldState: any[],
        newState: any[],
        idSelector: (item: any) => string,
        containerId: ContainerID,
        schema: LoroListSchema<SchemaType>,
    ): Change[] | undefined {
        const changes: Change[] = [];
        console.log("Using idSelector for list diff");
        // Compare arrays using the idSelector for identity
        const oldItemsById = new Map();
        const newItemsById = new Map();

        // Map items by ID
        oldState.forEach((item: any, index: number) => {
            const id = idSelector(item);
            if (id) {
                oldItemsById.set(id, { item, index });
            } else {
                console.warn(
                    `No ID found for item at index ${index}`,
                );
            }
        });

        newState.forEach((item: any, index: number) => {
            const id = idSelector(item);
            if (id) {
                newItemsById.set(id, { item, index });
            } else {
                console.warn(
                    `No ID found for item at index ${index}`,
                );
            }
        });

        const list = this.doc.getList(containerId);
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

            const oldId = idSelector(oldItem);
            const newId = idSelector(newItem);
            if (oldId === newId) {
                const item = list.get(index);
                if (isContainer(item)) {
                    changes.push(
                        ...this.findChangesForContainer(
                            oldItem,
                            newItem,
                            item.id,
                            schema.itemSchema,
                        ),
                    );
                } else {
                    changes.push({
                        container: containerId,
                        key: index + offset,
                        value: undefined,
                        kind: "delete",
                    });
                    changes.push({
                        container: containerId,
                        key: index + offset,
                        value: newItem,
                        kind: "insert",
                    });
                }
                newIndex++;
                continue;
            }

            if (!oldItemsById.has(newId)) {
                changes.push({
                    container: containerId,
                    key: index + offset,
                    value: newItem,
                    kind: "insert",
                });
                offset++;
                newIndex++;
                continue;
            }

            if (!newItemsById.has(oldId)) {
                changes.push({
                    container: containerId,
                    key: index + offset,
                    value: undefined,
                    kind: "delete",
                });
                offset--;
                continue;
            }

            changes.push(
                {
                    container: containerId,
                    key: index + offset,
                    value: undefined,
                    kind: "delete",
                },
            );
            offset--;
            continue;
        }

        for (; newIndex < newState.length; newIndex++) {
            const newItem = newState[newIndex];
            changes.push({
                container: containerId,
                key: index + offset + newIndex,
                value: newItem,
                kind: "insert",
            });
        }

        return changes;
    }

    /**
     * Update a Map container
     */
    private updateMapContainer(map: LoroMap, path: string[], value: any) {
        if (path.length === 0) {
            // Replace entire map
            if (isObject(value)) {
                // Find the schema for this container
                const schema = this.getSchemaForContainer(map);
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

            // Find the schema for this container
            const schema = this.getSchemaForContainer(map);

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
                        return;
                    }
                }
            }
        }

        // Default to simple set
        map.set(key, value);
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
}
