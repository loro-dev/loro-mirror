/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { produce } from "immer";
import {
    Container,
    ContainerID,
    ContainerType,
    isContainer,
    LoroDoc,
    LoroEventBatch,
    LoroList,
    LoroMap,
    LoroMovableList,
    LoroText,
} from "loro-crdt";
import {
    ContainerSchemaType,
    getDefaultValue,
    InferType,
    isContainerSchema,
    isLoroListSchema,
    isLoroMapSchema,
    LoroListSchema,
    LoroMapSchema,
    LoroTextSchemaType,
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
    schema?: S;

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
    kind: "insert" | "delete" | "insert-container";
    childContainerType?: ContainerType;
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
    private schema?: S;
    private state: InferType<S>;
    private subscribers: Set<SubscriberCallback<InferType<S>>> = new Set();
    private syncing: boolean = false;
    private options: MirrorOptions<S>;

    // Unsubscribe functions for container subscriptions
    private containerSubscriptions: Map<ContainerID, () => void> = new Map();

    private containerToSchemaMap: Map<ContainerID, ContainerSchemaType> = new Map();

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
            ...(this.schema ? getDefaultValue(this.schema!) : {}),
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
        if (this.schema && this.schema.type !== "schema") {
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
        if (this.schema) {
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
                        this.registerContainer(key, fieldSchema);
                    }
                }
            }
        }
    }

    /**
     * Register a container with the Mirror
     */
    private registerContainer(name: string, schemaType: ContainerSchemaType | undefined) {
        try {
            let container: Container;

            // Get the container based on name
            if (name.includes("cid:")) {
                // Direct container ID reference
                container = this.doc.getContainerById(name as ContainerID)!;
            } else {
                // Root container by name
                const schema = this.schema?.type === "schema"
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

            if (schemaType) {
                this.registerContainerSchema(containerId, schemaType);
            }

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

        let parentSchema = this.getContainerSchema(container.id);

        try {
            const shallowValue = (container as any).getShallowValue();

            if (container.kind() === "Map") {
                // For maps, check each value
                for (const [key, value] of Object.entries(shallowValue)) {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(
                            value as ContainerID,
                        );
                        let nestedSchema: ContainerSchemaType | undefined;

                        if (parentSchema && isLoroMapSchema(parentSchema)) {
                            nestedSchema = parentSchema.definition[key] as ContainerSchemaType;
                        }

                        if (nestedContainer) {
                            this.registerContainer(value as ContainerID, nestedSchema);
                        }
                    }
                }
            } else if (container.kind() === "List") {
                // For lists, check each item
                shallowValue.forEach((value: any) => {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(
                            value as ContainerID,
                        );

                        let nestedSchema: ContainerSchemaType | undefined;

                        if (parentSchema && isLoroListSchema(parentSchema)) {
                            // For list items, we need to use the itemSchema, not the parent list schema
                            nestedSchema = parentSchema.itemSchema as ContainerSchemaType;
                        }

                        if (nestedContainer) {
                            this.registerContainer(value as ContainerID, nestedSchema);
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

            // If the event was from an import, [handleLoroEvent]
            // will handle notifying subscribers
            if (event.by !== "import") {
                // Notify subscribers
                this.notifySubscribers(SyncDirection.FROM_LORO);
            }
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
            if (this.options.debug) {
                console.log(
                    "currentDocState:",
                    JSON.stringify(currentDocState, null, 2),
                );
                console.log("newState:", JSON.stringify(newState, null, 2));
            }

            const changes = this.findChangesForContainer(
                currentDocState,
                newState,
                "",
                this.schema,
            );

            if (this.options.debug) {
                console.log("changes:", JSON.stringify(changes, null, 2));
            }

            // Apply the changes to the Loro document
            this.applyChangesToLoro(changes);

            // Log the doc state after changes
            if (this.options.debug) {
                console.log(
                    "Doc state after changes:",
                    JSON.stringify(this.doc.toJSON(), null, 2),
                );
            }
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
            Change[]
        >();

        for (const change of changes) {
            if (!changesByContainer.has(change.container)) {
                changesByContainer.set(change.container, []);
            }
            changesByContainer.get(change.container)!.push(change);
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
        changes: Change[],
    ) {
        for (const { key, value } of changes) {
            const keyStr = key.toString();

            const fieldSchema = (this.schema as RootSchemaType<any>)?.definition
                ?.[keyStr];
            const type = fieldSchema?.type || inferContainerType(value);
            let container: Container | null = null;

            // Create or get the container based on the schema type
            if (type === "loro-map") {
                container = this.doc.getMap(keyStr);
            } else if (type === "loro-list") {
                container = this.doc.getList(keyStr);
            } else if (type === "loro-text") {
                container = this.doc.getText(keyStr);
            } else {
                throw new Error();
            }

            // Apply direct changes to the container
            this.updateTopLevelContainer(container, value);
        }
    }

    /**
     * Apply multiple changes to a container
     */
    private applyContainerChanges(
        container: Container,
        changes: Change[],
    ) {
        // Apply changes in bulk by container type
        switch (container.kind()) {
            case "Map": {
                const map = container as LoroMap;

                for (
                    const { key, value, kind } of changes
                ) {
                    if (key === "") {
                        continue; // Skip empty key
                    }

                    if (kind === "insert") {
                        map.set(key as string, value);
                    } else if (kind === "insert-container") {
                        let schema = this.getSchemaForChildContainer(container.id, key);
                        this.insertContainerIntoMap(
                            map,
              							schema,
              							key as string,
              							value
                        )
                    } else if (kind === "delete") {
                        map.delete(key as string);
                    } else {
                        assertNever(kind);
                    }
                }
                break;
            }
            case "List": {
                const list = container as LoroList;
                // Process other changes (add/remove/replace)
                for (
                    const { key, value, kind } of changes
                ) {

                    if (typeof key !== "number") {
                        throw new Error(`Invalid list index: ${key}`);
                    }

                    const index = key;
                    if (index < 0) {
                        console.warn(`Invalid list index: ${index}`);
                        continue;
                    }

                    if (kind === "delete") {
                        list.delete(index, 1);
                    } else if (kind === "insert") {
                        list.insert(index, value);
                    } else if (kind === "insert-container") {
                        const schema = this.getSchemaForChildContainer(container.id, key);
            			this.insertContainerIntoList(
            				list,
            				schema,
            				index,
            				value
            			)
                    } else {
                        assertNever(kind);
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
                            key,
                            value,
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
                this.updateTextContainer(container as LoroText, value);
                break;
            case "List":
                this.updateListContainer(container as LoroList, value);
                break;
            case "Map":
                this.updateMapContainer(container as LoroMap, value);
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
    private updateTextContainer(text: LoroText, value: any) {
        if (typeof value !== "string") {
            throw new Error("Text value must be a string");
        }
        text.update(value);
    }

    /**
     * Update a List container
     */
    private updateListContainer(list: LoroList, value: any) {
        // Replace entire list
        if (Array.isArray(value)) {
            // Find the schema for this container path
            const schema = this.getContainerSchema(list.id);
            // Get the idSelector function from the schema
            const idSelector =
                (schema as LoroListSchema<SchemaType> | undefined)?.idSelector;
            const itemSchema =
                (schema as LoroListSchema<SchemaType> | undefined)?.itemSchema;

            if (this.options.debug) {
                console.log(
                    `Updating list container, idSelector: ${!!idSelector}, current length: ${list.length}`,
                );
            }

            // Clear out the list first to avoid duplicate items
            // Instead of clearing the entire list, which can leave it empty if there's an error,
            // we'll replace items one by one and only remove items that aren't in the new list
            if (idSelector) {
                // If we have an ID selector, we can use it for more intelligent updates
                this.updateListWithIdSelector(
                    list,
                    value,
                    idSelector,
                    itemSchema!,
                );
            } else {
                this.updateListByIndex(list, value, itemSchema);
            }
        } else {
            throw new Error("List value must be an array");
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

        if (this.options.debug) {
            console.log(
                `Current items by ID: ${currentItemsById.size}, New items by ID: ${newItemsById.size}`,
            );
        }

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
        itemSchema: SchemaType | undefined,
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
        itemSchema: SchemaType | undefined,
    ) {
        // Determine if the item should be a container
        let isContainer = false;
        let containerSchema: ContainerSchemaType | undefined;
        if (itemSchema && isContainerSchema(itemSchema)) {
            isContainer = true;
            containerSchema = itemSchema;
        } else {
            isContainer = tryInferContainerType(item) !== undefined;
        }

        if (isContainer && typeof item === "object" && item !== null) {
      			this.insertContainerIntoList(
      				list,
      				containerSchema,
      				index,
      				item
      			)
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
        const schema = this.getContainerSchema(list.id);
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
     * Attaches a detached container to a map
     *
     * If the schema is provided, the container will be registered with the schema
     */
    private insertContainerIntoMap(
        map: LoroMap,
        schema: ContainerSchemaType | undefined,
        key: string,
        value: any,
    ) {
        const [detachedContainer, containerType] = this.createContainerFromSchema(schema, value);
        let insertedContainer = map.setContainer(key, detachedContainer);

        if (!insertedContainer) {
            throw new Error("Failed to insert container into map");
        }

        if (schema) {
            this.registerContainer(insertedContainer.id, schema);
        }

        this.initializeContainer(insertedContainer, containerType, schema, value);
    }

    /**
     * Once a container has been created, and attached to its parent
     *
     * We initialize the inner vaues using the schema that we previously registered.
     */
    private initializeContainer(
        container: Container,
        containerType: ContainerType,
        schema: ContainerSchemaType | undefined,
        value: any
    ) {
        if (containerType === "Map") {
            let map = container as LoroMap;

            // Map has no inner values
            if (!isObject(value)) {
                return map;
            }

            // Populate the map with values
            for (const [key, val] of Object.entries(value)) {

                const fieldSchema =
                    (schema as LoroMapSchema<any> | undefined)
                        ?.definition[key];

                const isFieldContainer = isContainerSchema(fieldSchema);

                if (isFieldContainer &&
                    isValueOfContainerType(schemaToContainerType(fieldSchema), val)
                ) {
                    this.insertContainerIntoMap(
                        map,
                        fieldSchema,
                        key,
                        val,
                    );

                } else {
                    // Default to simple set
                    map.set(key, val);
                }
            }

            return map;
        } else if (containerType === "List") {
            // Generate a unique ID for the list
            const list = container as LoroList;
            if (!Array.isArray(value)) {
                return list;
            }

            const itemSchema = (schema as LoroListSchema<any> | undefined)
                ?.itemSchema;

            const isListItemContainer = isContainerSchema(itemSchema);

            for (let i = 0; i < value.length; i++) {
                const item = value[i];

                if (
                    isListItemContainer &&
                    isValueOfContainerType(schemaToContainerType(itemSchema), item)
                ) {
                    this.insertContainerIntoList(
                        list,
                        itemSchema,
                        i,
                        item,
                    );
                } else {
                    // Default to simple insert
                    list.insert(i, item);
                }
            }

            return list;
        } else if (containerType === "Text") {
            // Generate a unique ID for the text
            const text = container as LoroText;

            // Set the text content
            if (typeof value === "string") {
                text.update(value);
            }

            return text;
        } else {
            throw new Error(`Unknown schema type: ${containerType}`);
        }
    }


    /**
     * Create a new container based on a given schema.
     *
     * If the schema is undefined, we infer the container type from the value.
     */
    private createContainerFromSchema(
        schema: ContainerSchemaType | undefined,
        value: any,
    ): [Container, ContainerType] {
        const containerType = schema
            ? schemaToContainerType(schema)
            : tryInferContainerType(value);

        switch (containerType) {
            case "Map":
                return [new LoroMap(), "Map"];
            case "List":
                return [new LoroList(), "List"];
            case "MovableList":
                return [new LoroMovableList(), "MovableList"];
            case "Text":
                return [new LoroText(), "Text"];
            default:
                throw new Error(`Unknown schema type: ${containerType}`);
        }
    }

    /** 
     * Attaches a detached container to a list
     *
     * If the schema is provided, the container will be registered with the schema
     */
    private insertContainerIntoList(
        list: LoroList,
        schema: ContainerSchemaType | undefined,
        index: number,
        value: any,
    ) {
        const [detachedContainer, containerType] = this.createContainerFromSchema(schema, value);
        let insertedContainer: Container | undefined;

        if (index === undefined) {
            insertedContainer = list.pushContainer(detachedContainer);
        } else {
            insertedContainer = list.insertContainer(index, detachedContainer);
        }

        if (!insertedContainer) {
            throw new Error("Failed to insert container into list");
        }

        if (schema) {
            this.registerContainer(insertedContainer.id, schema);
        }

        this.initializeContainer(insertedContainer, containerType, schema, value);
    }

    /**
     * Find changes between old and new state
     */
    private findChangesForContainer(
        oldState: unknown,
        newState: unknown,
        containerId: ContainerID | "",
        schema: SchemaType | undefined,
    ): Change[] {
        const changes: Change[] = [];
        if (containerId.endsWith("Text")) {
            if (oldState !== newState) {
                changes.push({
                    container: containerId,
                    key: "",
                    value: newState,
                    kind: "insert",
                });
            }
            return changes;
        }

        // Handle Array (List) differently
        if (Array.isArray(oldState) && Array.isArray(newState)) {
            if (!containerId.endsWith("List")) {
                throw new Error("");
            }
            if (schema && schema.type !== "loro-list") {
                throw new Error("");
            }

            changes.push(
                ...this.findDiffInArray(
                    containerId as ContainerID,
                    oldState,
                    newState,
                    schema,
                ),
            );
            return changes;
        }

        // Handle Object (Map) changes
        return this.findChangesInLoroMap(
            oldState,
            newState,
            containerId,
            schema,
        );
    }

    private findChangesInLoroMap(
        oldState: unknown,
        newState: unknown,
        containerId: ContainerID | "",
        schema: SchemaType | undefined,
    ): Change[] {
        if (containerId) {
            if (!containerId.endsWith("Map")) {
                throw new Error();
            }
        }

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
            if (!(key in oldStateObj)) {
                const child = (schema as
                    | LoroMapSchema<Record<string, SchemaType>>
                    | undefined)
                    ?.definition?.[key];
                const t = child?.getContainerType() ??
                    tryInferContainerType(newStateObj[key]);
                if (t) {
                    changes.push({
                        container: containerId,
                        key,
                        value: newStateObj[key],
                        kind: "insert-container",
                        childContainerType: t,
                    });
                }
            } else if (oldStateObj[key] !== newStateObj[key]) {
                if (
                    (typeof oldStateObj[key] === "object") &&
                    (typeof newStateObj[key] === "object")
                ) {
                    // Get the container for the nested property if it exists
                    const childSchema: ContainerSchemaType | undefined =
                        (schema as
                            | RootSchemaType<
                                Record<string, ContainerSchemaType>
                            >
                            | undefined)?.definition?.[key];
                    const type = childSchema?.type ||
                        inferContainerType(newStateObj[key]);
                    let nestedContainerId: ContainerID;
                    if (!containerId) {
                        if (type === "loro-list") {
                            nestedContainerId = this.doc.getList(key).id;
                        } else if (type === "loro-map") {
                            nestedContainerId = this.doc.getMap(key).id;
                        } else if (type === "loro-text") {
                            nestedContainerId = this.doc.getText(key).id;
                        } else {
                            throw new Error();
                        }
                        changes.push(
                            ...this.findChangesForContainer(
                                oldStateObj[key],
                                newStateObj[key],
                                nestedContainerId,
                                childSchema,
                            ),
                        );
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
                            changes.push(insertChildToMap(
                                containerId,
                                key,
                                newStateObj[key],
                            ));
                        } else {
                            nestedContainerId = child.id;
                            changes.push(
                                ...this.findChangesForContainer(
                                    oldStateObj[key],
                                    newStateObj[key],
                                    nestedContainerId,
                                    childSchema,
                                ),
                            );
                        }
                    }
                } else {
                    changes.push(insertChildToMap(
                        containerId,
                        key,
                        newStateObj[key],
                    ));
                }
            }
        }

        return changes;
    }

    private findDiffInArray(
        containerId: ContainerID,
        oldState: any[],
        newState: any[],
        schema: LoroListSchema<SchemaType> | undefined,
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
            (schema as LoroListSchema<SchemaType> | undefined)?.idSelector;

        // Find the schema for this list
        let idSelector = listIdSelector;
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
                changes.push(tryUpdateToInsertContainer({
                    container: containerId,
                    key: i,
                    value: newState[i],
                    kind: "insert",
                }, true));
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
                            schema?.itemSchema,
                        ),
                    );
                } else if (!deepEqual(oldState[i], newState[i])) {
                    changes.push({
                        container: containerId,
                        key: i,
                        value: undefined,
                        kind: "delete",
                    });
                    changes.push(tryUpdateToInsertContainer({
                        container: containerId,
                        key: i,
                        value: newState[i],
                        kind: "insert",
                    }, true));
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
        schema: LoroListSchema<SchemaType> | undefined,
    ): Change[] | undefined {
        const changes: Change[] = [];
        if (this.options.debug) {
            console.log("Using idSelector for list diff");
        }

        const useContainer = !!(schema?.itemSchema.getContainerType() ?? true);
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

            const oldId = oldItem ? idSelector(oldItem) : null;
            const newId = newItem ? idSelector(newItem) : null;
            if (oldId === null || newId === null) {
                continue;
            }

            if (oldId === newId) {
                const item = list.get(index);
                if (isContainer(item)) {
                    changes.push(
                        ...this.findChangesForContainer(
                            oldItem,
                            newItem,
                            item.id,
                            schema?.itemSchema,
                        ),
                    );
                } else if (!deepEqual(oldItem, newItem)) {
                    changes.push({
                        container: containerId,
                        key: index + offset,
                        value: undefined,
                        kind: "delete",
                    });
                    changes.push(tryUpdateToInsertContainer({
                        container: containerId,
                        key: index + offset,
                        value: newItem,
                        kind: "insert",
                    }, useContainer));
                }
                newIndex++;
                continue;
            }

            if (newId && !oldItemsById.has(newId)) {
                changes.push(tryUpdateToInsertContainer({
                    container: containerId,
                    key: index + offset,
                    value: newItem,
                    kind: "insert",
                }, useContainer));
                index--;
                offset++;
                newIndex++;
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
        }

        for (; newIndex < newState.length; newIndex++) {
            const newItem = newState[newIndex];
            changes.push(tryUpdateToInsertContainer({
                container: containerId,
                key: index + offset,
                value: newItem,
                kind: "insert",
            }, useContainer));
            offset++;
        }

        return changes;
    }

    /**
     * Update a Map container
     */
    private updateMapContainer(map: LoroMap, value: any) {
        // Replace entire map
        if (isObject(value)) {
            // Find the schema for this container
            const schema = this.getContainerSchema(map.id);
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
        } else {
            throw new Error("Map value must be an object");
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
                    this.insertContainerIntoMap(
                        map,
                        fieldSchema,
                        key,
                        value
                    )
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
            const validation = this.schema &&
                validateSchema(this.schema, newState);
            if (validation && !validation.valid) {
                const errorMessage = `State validation failed: ${validation.errors?.join(", ")
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
     * Register a container schema
     */
    private registerContainerSchema(
        containerId: ContainerID,
        schemaType: ContainerSchemaType,
    ) {
        this.containerToSchemaMap.set(containerId, schemaType);
    }

    private getContainerSchema(containerId: ContainerID): ContainerSchemaType | undefined {
        return this.containerToSchemaMap.get(containerId);
    }

    private getSchemaForChildContainer(
        containerId: ContainerID,
        childKey: string | number,
    ): ContainerSchemaType | undefined {
        const containerSchema = this.getSchemaForChild(containerId, childKey);

        if (!containerSchema || !isContainerSchema(containerSchema)) {
            return undefined;
        }

        return containerSchema;
    }

    private getSchemaForChild(
        containerId: ContainerID,
        childKey: string | number,
    ): SchemaType | undefined {
        const containerSchema = this.getContainerSchema(containerId);

        if (!containerSchema) {
            return undefined;
        }

        if (isLoroMapSchema(containerSchema)) {
            return containerSchema.definition[childKey];
        } else if (isLoroListSchema(containerSchema)) {
            return containerSchema.itemSchema;
        }

        return undefined;
    }
}

function insertChildToMap(
    containerId: ContainerID | "",
    key: string,
    value: unknown,
): Change {
    if (isObject(value)) {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert-container",
            childContainerType: "Map",
        };
    } else if (Array.isArray(value)) {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert-container",
            childContainerType: "List",
        };
    } else {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert",
        };
    }
}

function tryUpdateToInsertContainer(change: Change, toUpdate: boolean): Change {
    if (!toUpdate) {
        return change;
    }

    if (change.kind !== "insert") {
        return change;
    }

    if (isObject(change.value)) {
        change.kind = "insert-container";
        change.childContainerType = "Map";
    } else if (Array.isArray(change.value)) {
        change.kind = "insert-container";
        change.childContainerType = "List";
    }
    return change;
}

function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${value}`);
}


function inferContainerType(
    value: unknown,
): "loro-map" | "loro-list" | "loro-text" | undefined {
    if (isObject(value)) {
        return "loro-map";
    } else if (Array.isArray(value)) {
        return "loro-list";
    } else if (typeof value === "string") {
        return "loro-text";
    } else {
        return;
    }
}

function schemaToContainerType<S extends SchemaType>(schema: S):
    S extends LoroMapSchema<any> ? "Map" :
    S extends LoroListSchema<any> ? "List" :
    S extends LoroTextSchemaType ? "Text" :
    undefined {

    const containerType = schema.getContainerType();
    return containerType as any;
}

function tryInferContainerType(value: unknown): ContainerType | undefined {
    if (isObject(value)) {
        return "Map";
    } else if (Array.isArray(value)) {
        return "List";
    } else if (typeof value === "string") {
        return "Text";
    } else {
        return;
    }
}

function isValueOfContainerType(
    containerType: ContainerType,
    value: any,
): boolean {
    switch (containerType) {
        case "List":
        case "Map":
            return typeof value === "object" && value !== null;
        case "Text":
            return typeof value === "string" && value !== null;
        default:
            return false;
    }
}
