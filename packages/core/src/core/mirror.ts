/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { produce } from "immer";
import type { Container, LoroDoc, LoroList, LoroMap, LoroText, ContainerID, LoroEventBatch, LoroEvent, Diff } from "loro-crdt";
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
export interface MirrorOptions<S extends SchemaType<any>> {
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
export class Mirror<S extends SchemaType<any>> {
    private doc: LoroDoc;
    private schema: S;
    private state: InferType<S>;
    private subscribers: Set<SubscriberCallback<InferType<S>>> = new Set();
    private syncing: boolean = false;
    private options: Required<MirrorOptions<S>>;
    
    // Map of container IDs to their containers
    private containerRegistry: Map<ContainerID, Container> = new Map();
    
    // Map of container IDs to their paths in the state
    private containerPaths: Map<ContainerID, string[]> = new Map();
    
    // Map of state paths to container IDs
    private pathToContainerId: Map<string, ContainerID> = new Map();
    
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
            if (Object.prototype.hasOwnProperty.call(this.schema.definition, key)) {
                const fieldSchema = this.schema.definition[key];
                
                if (["loro-map", "loro-list", "loro-text"].includes(fieldSchema.type)) {
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
                        console.warn(`No schema found for path: ${path.join('.')}`);
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
                            console.warn(`Unsupported container type: ${schema.type}`);
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
            
            // Map container ID to path
            this.containerPaths.set(containerId, path);
            
            // Map path to container ID
            this.pathToContainerId.set(path.join('.'), containerId);
            
            // Subscribe to container updates
            const unsubscribe = container.subscribe(this.handleContainerEvent);
            this.containerSubscriptions.set(containerId, unsubscribe);
            
            // For Map and List containers, check for nested containers and register them
            if ("getShallowValue" in container) {
                this.registerNestedContainers(container, path);
            }
        } catch (error) {
            if (this.options.debug) {
                console.error(`Error registering container ${name}:`, error);
            }
        }
    }
    
    /**
     * Register nested containers within a container
     */
    private registerNestedContainers(container: Container, parentPath: string[]) {
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
                        const nestedContainer = this.doc.getContainerById(value as ContainerID);
                        if (nestedContainer) {
                            const nestedPath = [...parentPath, key];
                            this.registerContainer(value as ContainerID, nestedPath);
                        }
                    }
                }
            } else if (container.kind() === "List") {
                // For lists, check each item
                const list = container as LoroList;
                shallowValue.forEach((value: any, index: number) => {
                    if (typeof value === "string" && value.startsWith("cid:")) {
                        // This is a container reference
                        const nestedContainer = this.doc.getContainerById(value as ContainerID);
                        if (nestedContainer) {
                            const nestedPath = [...parentPath, index.toString()];
                            this.registerContainer(value as ContainerID, nestedPath);
                        }
                    }
                });
            }
        } catch (error) {
            if (this.options.debug) {
                console.error(`Error registering nested containers for ${container.id}:`, error);
            }
        }
    }

    /**
     * Get schema definition for a specific path
     */
    private getSchemaForPath(path: string[]): SchemaType<any> | null {
        let currentSchema: SchemaType<any> = this.schema;
        
        for (let i = 0; i < path.length; i++) {
            const part = path[i];
            
            if (currentSchema.type === "schema" || currentSchema.type === "loro-map") {
                if (!currentSchema.definition || !currentSchema.definition[part]) {
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
                    const container = this.doc.getContainerById(loroEvent.target);
                    if (container) {
                        // Try to determine the path for this container
                        const path = this.doc.getPathToContainer(loroEvent.target);
                        if (path) {
                            this.registerContainer(loroEvent.target, path.map(p => p.toString()));
                        }
                    }
                } catch (error) {
                    if (this.options.debug) {
                        console.error(`Error processing event for container ${loroEvent.target}:`, error);
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
                        const container = this.doc.getContainerById(loroEvent.target);
                        if (container) {
                            // Try to determine the path for this container
                            const path = this.doc.getPathToContainer(loroEvent.target);
                            if (path) {
                                this.registerContainer(loroEvent.target, path.map(p => p.toString()));
                            }
                        }
                    } catch (error) {
                        if (this.options.debug) {
                            console.error(`Error processing container event:`, error);
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
            const currentDocState = this.doc.toJSON();
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
    private applyChangesToLoro(changes: Array<{path: string[], value: any}>) {
        // Transaction to batch updates
        for (const {path, value} of changes) {
            if (path.length === 0) {
                // Root-level changes are handled differently
                this.applyRootChanges(value);
                continue;
            }
            
            // Find the container responsible for this path
            const containerPath = this.findContainerPath(path);
            if (!containerPath) {
                if (this.options.debug) {
                    console.warn(`No container found for path: ${path.join('.')}`);
                }
                continue;
            }
            
            // Get the container ID
            const containerPathStr = containerPath.join('.');
            const containerId = this.pathToContainerId.get(containerPathStr);
            if (!containerId) {
                if (this.options.debug) {
                    console.warn(`No container ID found for path: ${containerPathStr}`);
                }
                continue;
            }
            
            // Get the container
            const container = this.containerRegistry.get(containerId);
            if (!container) {
                if (this.options.debug) {
                    console.warn(`Container not found for ID: ${containerId}`);
                }
                continue;
            }
            
            // Calculate relative path from container
            const relPath = path.slice(containerPath.length);
            
            // Apply the change based on container type
            this.applyChangeToContainer(container, relPath, value);
        }
    }
    
    /**
     * Apply changes to the root-level fields
     */
    private applyRootChanges(value: Record<string, any>) {
        // For each root field, find the appropriate container and update
        for (const [key, fieldValue] of Object.entries(value)) {
            const containerId = this.pathToContainerId.get(key);
            if (containerId) {
                const container = this.containerRegistry.get(containerId);
                if (container) {
                    // Apply the change to the container
                    this.applyChangeToContainer(container, [], fieldValue);
                }
            }
        }
    }
    
    /**
     * Apply a change to a specific container
     */
    private applyChangeToContainer(container: Container, path: string[], value: any) {
        try {
            const kind = container.kind();
            
            if (kind === "Text") {
                const text = container as LoroText;
                if (path.length === 0) {
                    // Update entire text content
                    const newText = String(value || "");
                    text.update(newText);
                }
            } else if (kind === "List") {
                const list = container as LoroList;
                if (path.length === 0) {
                    // Replace entire list
                    if (Array.isArray(value)) {
                        // Clear the list and add new items
                        list.clear();
                        for (let i = 0; i < value.length; i++) {
                            // Check if the value is a container
                            if (typeof value[i] === "object" && value[i] !== null && 
                                !Array.isArray(value[i]) && typeof value[i].kind === "function") {
                                list.insertContainer(i, value[i]);
                            } else {
                                list.insert(i, value[i]);
                            }
                        }
                    }
                } else if (path.length === 1) {
                    // Update a specific index
                    const index = parseInt(path[0], 10);
                    if (!isNaN(index)) {
                        if (value === undefined) {
                            // Delete the item
                            list.delete(index, 1);
                        } else {
                            // Replace the item
                            list.delete(index, 1);
                            // Check if the value is a container
                            if (typeof value === "object" && value !== null && 
                                !Array.isArray(value) && typeof value.kind === "function") {
                                list.insertContainer(index, value);
                            } else {
                                list.insert(index, value);
                            }
                        }
                    }
                }
            } else if (kind === "Map") {
                const map = container as LoroMap;
                if (path.length === 0) {
                    // Replace entire map
                    if (isObject(value)) {
                        // Clear existing entries
                        for (const [key] of map.entries()) {
                            map.delete(key);
                        }
                        
                        // Add new entries
                        for (const [key, val] of Object.entries(value)) {
                            // Check if the value is a container
                            if (typeof val === "object" && val !== null && 
                                !Array.isArray(val) && typeof val.kind === "function") {
                                map.setContainer(key, val);
                            } else {
                                map.set(key, val);
                            }
                        }
                    }
                } else if (path.length === 1) {
                    // Update a specific key
                    const key = path[0];
                    if (value === undefined) {
                        // Delete the key
                        map.delete(key);
                    } else {
                        // Set the key
                        // Check if the value is a container
                        if (typeof value === "object" && value !== null && 
                            !Array.isArray(value) && typeof value.kind === "function") {
                            map.setContainer(key, value);
                        } else {
                            map.set(key, value);
                        }
                    }
                }
            }
        } catch (error) {
            if (this.options.debug) {
                console.error(`Error applying change to container ${container.id}:`, error);
            }
        }
    }
    
    /**
     * Find the closest container path for a given path
     */
    private findContainerPath(path: string[]): string[] | null {
        // Try exact path first
        const exactPath = path.join('.');
        if (this.pathToContainerId.has(exactPath)) {
            return path;
        }
        
        // Try parent paths
        for (let i = path.length - 1; i >= 0; i--) {
            const parentPath = path.slice(0, i);
            const parentPathStr = parentPath.join('.');
            if (this.pathToContainerId.has(parentPathStr)) {
                return parentPath;
            }
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
                if (this.options.throwOnValidationError) {
                    throw new Error(errorMessage);
                }
                if (this.options.debug) {
                    console.error(errorMessage);
                }
                return;
            }
        }

        // Update the in-memory state
        this.state = newState;

        // Update Loro based on new state
        this.updateLoro(newState);

        // Notify subscribers
        this.notifySubscribers(SyncDirection.TO_LORO);
    }

    /**
     * Find changes between old and new state
     */
    private findChanges(
        oldState: any,
        newState: any,
        path: string[] = [],
    ): Array<{ path: string[]; value: any }> {
        const changes: Array<{ path: string[]; value: any }> = [];

        if (!isObject(oldState) || !isObject(newState)) {
            // Simple value comparison
            if (!deepEqual(oldState, newState)) {
                changes.push({ path, value: newState });
            }
            return changes;
        }

        // Check for removed keys
        for (const key in oldState) {
            if (!(key in newState)) {
                changes.push({ path: [...path, key], value: undefined });
            }
        }

        // Check for added or modified keys
        for (const key in newState) {
            if (!(key in oldState)) {
                changes.push({ path: [...path, key], value: newState[key] });
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
                    changes.push({
                        path: [...path, key],
                        value: newState[key],
                    });
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
        this.containerPaths.clear();
        this.pathToContainerId.clear();
        this.containerSubscriptions.clear();
        this.subscribers.clear();
    }
}

