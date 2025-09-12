/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { produce, setAutoFreeze } from "immer";
setAutoFreeze(false);
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
    LoroTree,
    TreeID,
} from "loro-crdt";

import { applyEventBatchToState } from "./loroEventApply";
import {
    ContainerSchemaType,
    getDefaultValue,
    InferInputType,
    InferType,
    isContainerSchema,
    isListLikeSchema,
    isLoroListSchema,
    isLoroMapSchema,
    isLoroMovableListSchema,
    isLoroTreeSchema,
    LoroListSchema,
    LoroMapSchema,
    RootSchemaType,
    SchemaType,
    validateSchema,
} from "../schema";
import {
    deepEqual,
    inferContainerTypeFromValue,
    isObject,
    isValueOfContainerType,
    schemaToContainerType,
    tryInferContainerType,
    getRootContainerByType,
} from "./utils";
import { diffContainer, diffTree } from "./diff";
import { CID_KEY } from "../constants";

// Plain JSON-like value used for state snapshots
type JSONPrimitive = string | number | boolean | null | undefined;
type JSONValue = JSONPrimitive | JSONObject | JSONValue[];
interface JSONObject {
    [k: string]: JSONValue;
}

function hasKeyProp(c: Change): c is Extract<Change, { key: string | number }> {
    return (c as { key?: unknown }).key !== undefined;
}

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
    initialState?: Partial<import("../schema").InferInputType<S>>;

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

    /**
     * When enabled, performs an internal consistency check after setState
     * to ensure in-memory state equals the normalized LoroDoc JSON.
     * This throws on divergence but does not emit the verbose debug logs.
     * @default false
     */
    checkStateConsistency?: boolean;

    /**
     * Default values for new containers
     */
    inferOptions?: InferContainerOptions;
}

export type InferContainerOptions = {
    defaultLoroText?: boolean;
    defaultMovableList?: boolean;
};

export type ChangeKinds = {
    set: {
        container: ContainerID | "";
        key: string | number;
        value: unknown;
        kind: "set";
        childContainerType?: ContainerType;
    };
    setContainer: {
        container: ContainerID | "";
        key: string | number;
        value: unknown;
        kind: "set-container";
        childContainerType?: ContainerType;
    };
    insert: {
        container: ContainerID | "";
        key: string | number;
        value: unknown;
        kind: "insert";
    };
    insertContainer: {
        container: ContainerID | "";
        key: string | number;
        value: unknown;
        kind: "insert-container";
        childContainerType?: ContainerType;
    };
    delete: {
        container: ContainerID | "";
        key: string | number;
        value: unknown;
        kind: "delete";
    };
    move: {
        container: ContainerID;
        key: number;
        value: unknown;
        kind: "move";
        fromIndex: number;
        toIndex: number;
        childContainerType?: ContainerType;
    };
    treeCreate: {
        container: ContainerID;
        kind: "tree-create";
        parent?: TreeID;
        index: number;
        value?: unknown; // initial node.data
        // Called immediately after the node is created in Loro so we can:
        // 1) write the assigned TreeID back onto the newState node (users cannot know it ahead of time), and
        // 2) patch any queued child `tree-create` ops to point to this node as their `parent`.
        //
        // Note: this implies an ordering requirement when applying changes — tree creates must be
        // applied one-by-one and `onCreate` invoked right away to ensure children have the correct parent.
        onCreate(id: TreeID): void;
    };
    treeMove: {
        container: ContainerID;
        kind: "tree-move";
        target: TreeID;
        parent?: TreeID;
        index: number;
    };
    treeDelete: {
        container: ContainerID;
        kind: "tree-delete";
        target: TreeID;
    };
};

export type Change = ChangeKinds[keyof ChangeKinds];
export type MapChangeKinds =
    | ChangeKinds["insert"]
    | ChangeKinds["insertContainer"]
    | ChangeKinds["delete"];
export type ListChangeKinds =
    | ChangeKinds["insert"]
    | ChangeKinds["insertContainer"]
    | ChangeKinds["delete"];
export type MovableListChangeKinds =
    | ChangeKinds["insert"]
    | ChangeKinds["insertContainer"]
    | ChangeKinds["delete"]
    | ChangeKinds["move"]
    | ChangeKinds["set"]
    | ChangeKinds["setContainer"];
export type TreeChangeKinds =
    | ChangeKinds["treeCreate"]
    | ChangeKinds["treeMove"]
    | ChangeKinds["treeDelete"];
export type TextChangeKinds = ChangeKinds["insert"] | ChangeKinds["delete"];

/**
 * Options for setState and sync operations
 */
export interface SetStateOptions {
    /**
     * Tags to attach to this state update
     * Tags can be used for tracking the source of changes or grouping related changes
     */
    tags?: string[] | string;
}

type ContainerRegistry = Map<
    ContainerID,
    {
        schema: ContainerSchemaType | undefined;
        registered: boolean;
    }
>;

/**
 * Additional metadata for state updates
 */
export interface UpdateMetadata {
    /**
     * Direction of the sync operation
     */
    direction: SyncDirection;

    /**
     * Tags associated with this update, if any
     */
    tags?: string[];
}

/**
 * Callback type for subscribers
 */
export type SubscriberCallback<T> = (
    state: T,
    metadata: UpdateMetadata,
) => void;

/**
 * Mirror class that provides bidirectional sync between application state and Loro
 */
export class Mirror<S extends SchemaType> {
    private doc: LoroDoc;
    private schema?: S;
    private state: InferType<S>;
    private subscribers: Set<SubscriberCallback<InferType<S>>> = new Set();
    private syncing = false;
    private options: MirrorOptions<S>;
    private containerRegistry: ContainerRegistry = new Map();
    private subscriptions: (() => void)[] = [];
    // Canonical root path (e.g., ["profile"]) per root container id
    private rootPathById: Map<ContainerID, string[]> = new Map();

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
            checkStateConsistency: options.checkStateConsistency || false,
            inferOptions: options.inferOptions || {},
        };

        // Pre-create root containers hinted by initialState (no-op in Loro for roots)
        // so that doc.toJSON() reflects empty shapes and matches normalized state.
        this.ensureRootContainersFromInitialState();

        // Initialize in-memory state without writing to LoroDoc:
        // 1) Start from schema defaults (if any)
        // 2) Overlay current LoroDoc snapshot (normalized)
        // 3) Fill any missing top-level keys hinted by initialState with a normalized empty shape
        //    (arrays -> [], strings -> '', objects -> {}), but do NOT override existing values
        //    from the doc/defaults. This keeps doc pristine while providing a predictable state shape.
        const baseState: Record<string, unknown> = {};
        const defaults = (
            this.schema ? getDefaultValue(this.schema) : undefined
        ) as Record<string, unknown> | undefined;
        if (defaults && typeof defaults === "object") {
            Object.assign(baseState, defaults);
        }

        // Overlay the current doc snapshot so real data takes precedence over defaults
        const docSnapshot = this.buildRootStateSnapshot();
        if (docSnapshot && typeof docSnapshot === "object") {
            Object.assign(baseState, docSnapshot);
        }

        // Merge initialState with awareness of schema:
        // - Respect Ignore fields by keeping their values in memory only
        // - For container fields, fill missing base keys with normalized empties ([], "", {})
        // - For primitives, use provided initial values if doc/defaults do not provide them
        const initForMerge = (this.options.initialState || {}) as Record<
            string,
            unknown
        >;
        if (this.schema && this.schema.type === "schema") {
            mergeInitialIntoBaseWithSchema(
                baseState,
                initForMerge,
                this.schema as RootSchemaType<
                    Record<string, ContainerSchemaType>
                >,
            );
        } else {
            const hinted = normalizeInitialShapeShallow(initForMerge);
            for (const [k, v] of Object.entries(hinted)) {
                if (!(k in baseState)) baseState[k] = v;
            }
        }

        this.state = baseState as InferType<S>;

        // Initialize Loro containers and setup subscriptions
        this.initializeContainers();

        // Subscribe to the root doc for global updates
        this.subscriptions.push(this.doc.subscribe(this.handleLoroEvent));
    }

    /**
     * Ensure root containers exist for keys hinted by initialState.
     * Creating root containers is a no-op in Loro (no operations are recorded),
     * but it makes them visible in doc JSON, staying consistent with Mirror state.
     */
    private ensureRootContainersFromInitialState() {
        const init = (this.options?.initialState || {}) as Record<
            string,
            unknown
        >;
        for (const [key, value] of Object.entries(init)) {
            let container: Container | null = null;
            if (Array.isArray(value)) {
                container = this.doc.getList(key);
            } else if (typeof value === "string") {
                container = this.doc.getText(key);
            } else if (isObject(value)) {
                container = this.doc.getMap(key);
            }
            if (container) {
                this.rootPathById.set(container.id, [key]);
                this.registerContainerWithRegistry(container.id, undefined);
            }
        }
    }

    /**
     * Initialize containers based on schema
     */
    private initializeContainers() {
        if (this.schema && this.schema.type !== "schema") {
            throw new Error('Root schema must be of type "schema"');
        }

        // Register root containers first so registry is ready
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
                        [
                            "loro-map",
                            "loro-list",
                            "loro-text",
                            "loro-movable-list",
                            "loro-tree",
                        ].includes(fieldSchema.type)
                    ) {
                        const containerType =
                            schemaToContainerType(fieldSchema);
                        if (!containerType) {
                            continue;
                        }
                        const container = getRootContainerByType(
                            this.doc,
                            key,
                            containerType,
                        );
                        // Record canonical root path for this root container id
                        this.rootPathById.set(container.id, [key]);
                        this.registerContainer(container.id, fieldSchema);
                    }
                }
            }
        }

        // Build initial state snapshot from the current document
        const currentDocState = this.buildRootStateSnapshot();
        const newState = produce<InferType<S>>((draft) => {
            Object.assign(draft, currentDocState);
        })(this.state);

        this.state = newState;
    }

    /**
     * Register a container with the Mirror
     */
    private registerContainer(
        containerID: ContainerID,
        schemaType: ContainerSchemaType | undefined,
    ) {
        try {
            const container = this.doc.getContainerById(containerID);

            if (!container) {
                if (this.options.debug) {
                    console.warn(
                        `registerContainer: container not found for id ${containerID}`,
                    );
                }
                return;
            }

            const containerId = container.id;

            // If already registered, optionally upgrade schema, then skip deep re-scan
            const existing = this.containerRegistry.get(containerId);
            if (existing) {
                if (!existing.schema && schemaType) {
                    existing.schema = schemaType;
                }
                return;
            }

            this.registerContainerWithRegistry(containerId, schemaType);

            // Register nested containers
            this.registerNestedContainers(container);
        } catch (error) {
            if (this.options.debug) {
                console.error(
                    `Error registering container: ${containerID}`,
                    error,
                );
            }
        }
    }

    /**
     * Register nested containers within a container
     */
    private registerNestedContainers(container: Container) {
        if (!container.isAttached) return;

        const parentSchema = this.getContainerSchema(container.id);

        try {
            if (container.kind() === "Map") {
                const map = container as LoroMap;
                for (const key of map.keys()) {
                    const value = map.get(key);
                    if (isContainer(value)) {
                        let nestedSchema: ContainerSchemaType | undefined;
                        if (parentSchema && isLoroMapSchema(parentSchema)) {
                            nestedSchema = parentSchema.definition[
                                key
                            ] as ContainerSchemaType;
                        }
                        this.registerContainer(value.id, nestedSchema);
                    }
                }
            } else if (
                container.kind() === "List" ||
                container.kind() === "MovableList"
            ) {
                const list = container as LoroList | LoroMovableList;
                const len = list.length;
                for (let i = 0; i < len; i++) {
                    const value = list.get(i);
                    if (isContainer(value)) {
                        let nestedSchema: ContainerSchemaType | undefined;
                        if (
                            parentSchema &&
                            (isLoroListSchema(parentSchema) ||
                                isLoroMovableListSchema(parentSchema))
                        ) {
                            nestedSchema =
                                parentSchema.itemSchema as ContainerSchemaType;
                        }
                        if (nestedSchema) {
                            this.registerContainer(value.id, nestedSchema);
                        }
                    }
                }
            } else if (container.kind() === "Tree") {
                const tree = container as LoroTree;
                let nodeSchema: ContainerSchemaType | undefined;
                if (parentSchema && isLoroTreeSchema(parentSchema)) {
                    nodeSchema = parentSchema.nodeSchema as ContainerSchemaType;
                }
                if (nodeSchema) {
                    const nodes = tree.getNodes();
                    for (const node of nodes) {
                        // Register the node.data map and its nested containers
                        this.registerContainer(node.data.id, nodeSchema);
                    }
                }
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
        if (event.origin === "to-loro") return;
        this.syncing = true;
        try {
            // Pre-register any containers referenced in this batch
            this.registerContainersFromLoroEvent(event);
            // no-op debug hook removed
            // Normalize event paths to canonical root paths when applicable
            const normalized = {
                ...event,
                events: event.events.map((e) => {
                    const canon = this.rootPathById.get(e.target);
                    if (
                        canon &&
                        (!Array.isArray(e.path) || e.path[0] !== canon[0])
                    ) {
                        return { ...e, path: canon } as typeof e;
                    }
                    return e;
                }),
            } as LoroEventBatch;
            // Incrementally update state using event deltas
            this.state = applyEventBatchToState(this.state, normalized, {
                getContainerById: (id) => this.doc.getContainerById(id),
                containerToJson: (c) => this.containerToStateJson(c),
                nodeDataWithCid: (treeId) => {
                    const s = this.getContainerSchema(treeId);
                    return !!(s && isLoroTreeSchema(s));
                },
                getNodeDataCid: (treeId, nodeId) => {
                    try {
                        const node = this.doc
                            .getTree(treeId)
                            .getNodeByID(nodeId);
                        return node ? node.data.id : undefined;
                    } catch {
                        return undefined;
                    }
                },
            });
            // With canonicalized paths, applyEventBatchToState updates roots precisely.
            // No additional root refresh is required here.
            // Notify subscribers of the update
            this.notifySubscribers(SyncDirection.FROM_LORO);
        } finally {
            this.registerContainersFromLoroEvent(event);
            this.syncing = false;
        }
    };

    /**
     * Processes container additions/removals from the LoroDoc
     * and ensures the containers are reflected in the container registry.
     *
     * TODO: need to handle removing containers from the registry on import
     * right now the Diff Delta only returns the number of items removed
     * not the container IDs , of those that were removed.
     */
    private registerContainersFromLoroEvent(batch: LoroEventBatch) {
        for (const event of batch.events) {
            if (event.diff.type === "list") {
                const diff = event.diff.diff;

                const schema = this.getContainerSchema(event.target);

                for (const change of diff) {
                    if (!change.insert) continue;
                    for (const item of change.insert) {
                        if (isContainer(item)) {
                            const container = item;

                            let containerSchema:
                                | ContainerSchemaType
                                | undefined;

                            if (schema && isListLikeSchema(schema)) {
                                containerSchema =
                                    schema.itemSchema as ContainerSchemaType;
                            }

                            this.registerContainer(
                                container.id,
                                containerSchema,
                            );

                            if (!containerSchema) {
                                console.warn(
                                    `Container schema not found for key  in list ${event.target}`,
                                );
                            }
                        }
                    }
                }
            } else if (event.diff.type === "map") {
                const diff = event.diff.updated;

                for (const [key, change] of Object.entries(diff)) {
                    const schema = this.getSchemaForChild(event.target, key);
                    if (isContainer(change)) {
                        const containerSchema = isContainerSchema(schema)
                            ? schema
                            : undefined;
                        this.registerContainer(change.id, containerSchema);

                        if (!containerSchema) {
                            console.warn(
                                `Container schema not found for key ${key} in map ${event.target}`,
                            );
                        }
                    }
                }
            } else if (event.diff.type === "tree") {
                const tree = this.doc.getTree(event.target);
                const schema = this.getContainerSchema(event.target);
                let nodeSchema: ContainerSchemaType | undefined;
                if (schema && isLoroTreeSchema(schema)) {
                    nodeSchema = schema.nodeSchema as ContainerSchemaType;
                }
                if (!nodeSchema) continue;

                for (const item of event.diff.diff) {
                    if (item.action === "create") {
                        const node = tree.getNodeByID(item.target);
                        if (node) {
                            this.registerContainer(node.data.id, nodeSchema);
                        }
                    }
                }
            }
        }
    }

    // Tree node $cid injection happens during event application

    /**
     * Update Loro based on state changes
     */
    private updateLoro(newState: InferType<S>) {
        if (this.syncing) return;

        this.syncing = true;
        try {
            // Find the differences between current Loro state and new state
            const currentDocState = this.state;

            const changes = diffContainer(
                this.doc,
                currentDocState,
                newState,
                "",
                this.schema,
                this.options?.inferOptions,
            );
            // Apply the changes to the Loro document (and stamp any pending-state metadata like $cid)
            this.applyChangesToLoro(changes, newState);
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Apply a set of changes to the Loro document
     */
    private applyChangesToLoro(changes: Change[], pendingState?: InferType<S>) {
        // Group changes by container for batch processing
        const changesByContainer = new Map<ContainerID | "", Change[]>();

        for (const change of changes) {
            if (!changesByContainer.has(change.container)) {
                changesByContainer.set(change.container, []);
            }
            changesByContainer.get(change.container)!.push(change);
        }

        // Process changes by container
        for (const [
            containerId,
            containerChanges,
        ] of changesByContainer.entries()) {
            if (containerId === "") {
                // Handle root level changes
                this.applyRootChanges(containerChanges, pendingState);
            } else {
                // Handle container-specific changes
                const container = this.doc.getContainerById(containerId);
                if (container) {
                    this.applyContainerChanges(
                        container,
                        containerChanges,
                        pendingState,
                    );
                } else {
                    throw new Error(
                        `Container not found for ID: ${containerId}.
                        This is likely due to a stale reference or a synchronization issue.`,
                    );
                }
            }
        }
        // Only commit if we actually applied any changes
        if (changes.length > 0) {
            this.doc.commit({ origin: "to-loro" });
        }
    }

    /**
     * Update root-level fields
     */
    private applyRootChanges(changes: Change[], pendingState?: InferType<S>) {
        for (const change of changes) {
            if (!hasKeyProp(change)) continue;
            const { key, value } = change;
            const keyStr = key.toString();

            const fieldSchema = (
                this.schema as RootSchemaType<
                    Record<string, ContainerSchemaType>
                >
            )?.definition?.[keyStr];
            const type =
                fieldSchema?.type ||
                inferContainerTypeFromValue(value, this.options?.inferOptions);
            let container: Container | null = null;

            // Create or get the container based on the schema type
            if (type === "loro-map") {
                container = this.doc.getMap(keyStr);
            } else if (type === "loro-list") {
                container = this.doc.getList(keyStr);
            } else if (type === "loro-text") {
                container = this.doc.getText(keyStr);
            } else if (type === "loro-movable-list") {
                container = this.doc.getMovableList(keyStr);
            } else if (type === "loro-tree") {
                container = this.doc.getTree(keyStr);
            } else {
                throw new Error();
            }

            this.registerContainerWithRegistry(container.id, fieldSchema);

            // Inject $cid for root maps into pending state immediately
            if (fieldSchema && isLoroMapSchema(fieldSchema) && pendingState) {
                const rootObj = pendingState as Record<string, unknown>;
                const child = rootObj[keyStr];
                if (isObject(child)) {
                    (child as Record<string, unknown>)[CID_KEY] = container.id;
                }
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
        _pendingState?: InferType<S>,
    ) {
        // Apply changes in bulk by container type
        switch (container.kind()) {
            case "Map": {
                const map = container as LoroMap;

                for (const change of changes) {
                    const { key, value, kind } = change as MapChangeKinds;
                    if (key === "") {
                        continue; // Skip empty key
                    }
                    // If schema marks this key as Ignore, skip writing to Loro
                    const fieldSchema = this.getSchemaForChild(
                        container.id,
                        key,
                    );
                    if (fieldSchema && fieldSchema.type === "ignore") {
                        continue;
                    }
                    if (kind === "insert") {
                        map.set(key as string, value);
                    } else if (kind === "insert-container") {
                        const schema = this.getSchemaForChildContainer(
                            container.id,
                            key,
                        );
                        const inserted = this.insertContainerIntoMap(
                            map,
                            schema,
                            key as string,
                            value,
                        );
                        // Stamp $cid into the pendingState value for child maps
                        if (
                            schema &&
                            isLoroMapSchema(schema) &&
                            isObject(value)
                        ) {
                            value[CID_KEY] = inserted.id;
                        }
                    } else if (kind === "delete") {
                        map.delete(key as string);
                    } else {
                        throw new Error("Unsupported change kind for map");
                    }
                }
                break;
            }
            case "List": {
                const list = container as LoroList;
                // Process other changes (add/remove/replace)
                for (const change of changes) {
                    const { key, value, kind } = change as ListChangeKinds;
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
                        const schema = this.getSchemaForChildContainer(
                            container.id,
                            key,
                        );
                        this.insertContainerIntoList(
                            list,
                            schema,
                            index,
                            value,
                        );
                    } else {
                        throw new Error("Unsupported change kind for list");
                    }
                }
                break;
            }
            case "MovableList": {
                const list = container as LoroMovableList;

                for (const change of changes) {
                    const { key, value, kind } =
                        change as MovableListChangeKinds;
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
                        const schema = this.getSchemaForChildContainer(
                            container.id,
                            key,
                        );
                        this.insertContainerIntoList(
                            list,
                            schema,
                            index,
                            value,
                        );
                    } else if (kind === "move") {
                        const c = change as ChangeKinds["move"];
                        const fromIndex = c.fromIndex;
                        const toIndex = c.toIndex;
                        list.move(fromIndex, toIndex);
                    } else if (kind === "set") {
                        list.set(index, value);
                    } else if (kind === "set-container") {
                        const schema = this.getSchemaForChildContainer(
                            container.id,
                            key,
                        );
                        const [detachedContainer, _containerType] =
                            this.createContainerFromSchema(schema, value);
                        const newContainer = list.setContainer(
                            index,
                            detachedContainer,
                        );

                        this.registerContainer(newContainer.id, schema);
                        this.initializeContainer(newContainer, schema, value);
                        // Stamp $cid into pending state when replacing with a map container
                        if (schema && isLoroMapSchema(schema) && isObject(value)) {
                            value[CID_KEY] = newContainer.id;
                        }
                    } else {
                        throw new Error();
                    }
                }

                break;
            }
            case "Text": {
                const text = container as LoroText;
                // Text containers only support direct value updates
                for (const change of changes) {
                    if (!("value" in change)) continue;
                    const v = (change as TextChangeKinds).value;
                    if (typeof v === "string") {
                        text.update(v);
                    } else {
                        // ignore
                    }
                }
                break;
            }
            case "Tree": {
                const tree = container as LoroTree;
                // Determine node schema for initializing new nodes
                let nodeSchema: ContainerSchemaType | undefined;
                const parentSchema = this.getContainerSchema(tree.id);
                if (parentSchema && isLoroTreeSchema(parentSchema)) {
                    nodeSchema = parentSchema.nodeSchema as ContainerSchemaType;
                }

                for (const change of changes) {
                    if (change.kind === "tree-create") {
                        const newNode = tree.createNode(
                            change.parent,
                            change.index,
                        );
                        // Propagate the concrete TreeID back into the in-memory newState and
                        // fix up any pending child creates that depend on this parent's ID.
                        change.onCreate(newNode.id);
                        if (nodeSchema) {
                            this.registerContainer(newNode.data.id, nodeSchema);
                            this.initializeContainer(
                                newNode.data,
                                nodeSchema,
                                change.value,
                            );
                            // Stamp $cid into node.data in pending state
                            if (
                                isLoroMapSchema(nodeSchema) &&
                                isObject(change.value)
                            ) {
                                change.value[CID_KEY] = newNode.data.id;
                            }
                        }
                    } else if (change.kind === "tree-move") {
                        tree.move(change.target, change.parent, change.index);
                    } else if (change.kind === "tree-delete") {
                        tree.delete(change.target);
                    } else {
                        // ignore non-tree changes for tree container
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
    private updateTopLevelContainer(container: Container, value: unknown) {
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
            case "MovableList":
                this.updateListContainer(container as LoroMovableList, value);
                break;
            case "Tree":
                this.updateTreeContainer(container as LoroTree, value);
                break;
            default:
                throw new Error(
                    `Unknown container kind for top-level update: ${kind}.
                    This is likely a programming error or unsupported container type.`,
                );
        }
    }

    /**
     * Update a Text container
     */
    private updateTextContainer(text: LoroText, value: unknown) {
        if (typeof value !== "string") {
            throw new Error("Text value must be a string");
        }
        text.update(value);
    }

    /**
     * Update a List container
     */
    private updateListContainer(
        list: LoroList | LoroMovableList,
        value: unknown,
    ) {
        // Replace entire list
        if (Array.isArray(value)) {
            // Find the schema for this container path
            const schema = this.getContainerSchema(list.id);

            if (
                schema &&
                !isLoroListSchema(schema) &&
                !isLoroMovableListSchema(schema)
            ) {
                throw new Error(
                    `Invalid schema for list: ${schema.type}. Expected LoroListSchema`,
                );
            }

            // Get the idSelector function from the schema
            const idSelector = schema?.idSelector;
            const itemSchema = schema?.itemSchema;

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
        list: LoroList | LoroMovableList,
        newItems: unknown[],
        idSelector: (item: unknown) => string | null,
        itemSchema: SchemaType,
    ) {
        // First, map current items by ID
        const currentItemsById = new Map<
            string,
            { item: unknown; index: number }
        >();
        const currentLength = list.length;

        for (let i = 0; i < currentLength; i++) {
            const item = list.get(i);
            try {
                if (item) {
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
        const newItemsById = new Map<
            string,
            { item: unknown; index: number }
        >();

        // Helper function to get ID from either LoroMap or plain object
        const getIdFromItem = (item: unknown) => {
            if (!item) return null;

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
                const idProp = (item as { id?: unknown }).id;
                if (typeof idProp === "string") {
                    return idProp;
                }
            }
            return null;
        };

        newItems.forEach((item, index) => {
            try {
                const id = getIdFromItem(item);
                if (id) {
                    newItemsById.set(id, { item, index });
                } else {
                    throw new Error(`Item at index ${index} has no ID`);
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
        list: LoroList | LoroMovableList,
        newItems: unknown[],
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
        list: LoroList | LoroMovableList,
        index: number,
        item: unknown,
        itemSchema: SchemaType | undefined,
    ) {
        // Determine if the item should be a container
        let isContainer = false;
        let containerSchema: ContainerSchemaType | undefined;
        if (itemSchema && isContainerSchema(itemSchema)) {
            isContainer = true;
            containerSchema = itemSchema;
        } else {
            isContainer =
                tryInferContainerType(item, this.options?.inferOptions) !==
                undefined;
        }

        if (isContainer && typeof item === "object" && item !== null) {
            this.insertContainerIntoList(list, containerSchema, index, item);
            return;
        }

        // Default to simple insert
        list.insert(index, item);
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
     * @param direction The direction of the sync operation
     * @param tags Optional tags associated with this update
     */
    private notifySubscribers(direction: SyncDirection, tags?: string[]) {
        const metadata: UpdateMetadata = {
            direction,
            tags,
        };

        for (const subscriber of this.subscribers) {
            subscriber(this.state, metadata);
        }
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.subscribers.clear();
        this.subscriptions.forEach((x) => {
            x();
        });
        this.subscriptions.length = 0;
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
        value: unknown,
    ) {
        const [detachedContainer, _containerType] =
            this.createContainerFromSchema(schema, value);
        const insertedContainer = map.setContainer(key, detachedContainer);

        if (!insertedContainer) {
            throw new Error("Failed to insert container into map");
        }

        this.registerContainer(insertedContainer.id, schema);

        this.initializeContainer(insertedContainer, schema, value);
        // Stamp $cid for child maps directly on the provided value (pending state)
        if (schema && isLoroMapSchema(schema) && isObject(value)) {
            value[CID_KEY] = insertedContainer.id;
        }
        return insertedContainer;
    }

    /**
     * Once a container has been created, and attached to its parent
     *
     * We initialize the inner values using the schema that we previously registered.
     */
    private initializeContainer(
        container: Container,
        schema: ContainerSchemaType | undefined,
        value: unknown,
    ) {
        const kind = container.kind();
        if (kind === "Map") {
            const map = container as LoroMap;
            if (!isObject(value)) {
                return;
            }
            for (const [key, val] of Object.entries(value)) {
                // Skip injected CID field
                if (key === CID_KEY) continue;
                const fieldSchema = (
                    schema as
                        | LoroMapSchema<Record<string, SchemaType>>
                        | undefined
                )?.definition[key];

                if (isContainerSchema(fieldSchema)) {
                    const ct = schemaToContainerType(fieldSchema);
                    if (ct && isValueOfContainerType(ct, val)) {
                        this.insertContainerIntoMap(map, fieldSchema, key, val);
                    } else {
                        map.set(key, val);
                    }
                } else {
                    map.set(key, val);
                }
            }
        } else if (kind === "List" || kind === "MovableList") {
            const list = container as LoroList | LoroMovableList;
            if (!Array.isArray(value)) {
                return;
            }

            const itemSchema = (
                schema as LoroListSchema<SchemaType> | undefined
            )?.itemSchema;

            const isListItemContainer = isContainerSchema(itemSchema);

            for (let i = 0; i < value.length; i++) {
                const item = value[i];

                if (isListItemContainer) {
                    const ct = schemaToContainerType(itemSchema);
                    if (ct && isValueOfContainerType(ct, item)) {
                        this.insertContainerIntoList(list, itemSchema, i, item);
                    } else {
                        list.insert(i, item);
                    }
                } else {
                    list.insert(i, item);
                }
            }
        } else if (kind === "Text") {
            const text = container as LoroText;
            if (typeof value === "string") {
                text.update(value);
            }
        } else if (kind === "Tree") {
            const tree = container as LoroTree;
            this.updateTreeContainer(tree, value);
        } else {
            throw new Error(`Unknown container kind: ${kind}`);
        }
    }

    /**
     * Create a new container based on a given schema.
     *
     * If the schema is undefined, we infer the container type from the value.
     */
    private createContainerFromSchema(
        schema: ContainerSchemaType | undefined,
        value: unknown,
    ): [Container, ContainerType] {
        const containerType = schema
            ? schemaToContainerType(schema)
            : tryInferContainerType(value, this.options?.inferOptions);

        switch (containerType) {
            case "Map":
                return [new LoroMap(), "Map"];
            case "List":
                return [new LoroList(), "List"];
            case "MovableList":
                return [new LoroMovableList(), "MovableList"];
            case "Text":
                return [new LoroText(), "Text"];
            case "Tree":
                return [new LoroTree(), "Tree"];
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
        list: LoroList | LoroMovableList,
        schema: ContainerSchemaType | undefined,
        index: number,
        value: unknown,
    ) {
        const [detachedContainer, _containerType] =
            this.createContainerFromSchema(schema, value);
        let insertedContainer: Container | undefined;

        if (index === undefined) {
            insertedContainer = list.pushContainer(detachedContainer);
        } else {
            insertedContainer = list.insertContainer(index, detachedContainer);
        }

        if (!insertedContainer) {
            throw new Error("Failed to insert container into list");
        }

        this.registerContainer(insertedContainer.id, schema);

        this.initializeContainer(insertedContainer, schema, value);
        // Stamp $cid for list item maps directly on the provided value (pending state)
        if (schema && isLoroMapSchema(schema) && isObject(value)) {
            value[CID_KEY] = insertedContainer.id;
        }
        return insertedContainer;
    }

    /**
     * Update a Tree container using existing tree diff to generate precise create/move/delete
     * and nested node.data changes, then apply via container change appliers.
     */
    private updateTreeContainer(tree: LoroTree, value: unknown) {
        if (!Array.isArray(value)) {
            throw new Error("Tree value must be an array of nodes");
        }

        // Normalize current tree JSON from Loro to Mirror node shape
        const current: unknown[] = normalizeTreeNodes(tree.toJSON());
        const next: unknown[] = value as unknown[];

        // Optional schema to enable nested node.data diffs
        const parentSchema = this.getContainerSchema(tree.id);
        const treeSchema =
            parentSchema && isLoroTreeSchema(parentSchema)
                ? parentSchema
                : undefined;

        // Compute changes
        const changes = diffTree(
            this.doc,
            current,
            next,
            tree.id,
            treeSchema,
            this.options?.inferOptions,
        );

        if (changes.length === 0) return;

        // Group changes by container; apply tree ops first, then nested containers.
        // The order here matters for trees: child creates may depend on a parent's freshly
        // assigned ID (filled via `onCreate`), so we must apply creates in order.
        const grouped = new Map<ContainerID | "", Change[]>();
        for (const ch of changes) {
            const cid = ch.container;
            const arr = grouped.get(cid);
            if (arr) arr.push(ch);
            else grouped.set(cid, [ch]);
        }

        // Apply structural tree changes on the target tree first
        const treeGroup = grouped.get(tree.id);
        if (treeGroup && treeGroup.length) {
            this.applyContainerChanges(tree, treeGroup);
            grouped.delete(tree.id);
        }

        // Apply nested container changes (e.g., node.data maps)
        for (const [cid, group] of grouped) {
            if (cid === "") continue;
            const container = this.doc.getContainerById(cid);
            if (!container || group.length === 0) continue;
            this.applyContainerChanges(container, group);
        }
    }

    /**
     * Update a Map container
     */
    private updateMapContainer(map: LoroMap, value: unknown) {
        // Replace entire map
        if (!isObject(value)) {
            throw new Error("Map value must be an object");
        }

        // Schema for this container (optional)
        const schema = this.getContainerSchema(map.id);

        // Stamp $cid on the pending value
        if (schema && isObject(value)) {
            (value as Record<string, unknown>)[CID_KEY] = map.id;
        }

        // Get current keys
        const currentKeys = new Set(map.keys());

        // Process each field in the new value
        for (const [key, val] of Object.entries(value)) {
            if (key === CID_KEY) continue; // Skip CID
            // If we have a loro-map schema, use it; otherwise, infer
            if (schema && schema.type === "loro-map") {
                this.updateMapEntry(map, key, val, schema);
            } else {
                // Infer whether this is a container
                const ct = tryInferContainerType(
                    val,
                    this.options?.inferOptions,
                );
                if (ct && isValueOfContainerType(ct, val)) {
                    // No child schema; insert with inferred container type
                    this.insertContainerIntoMap(map, undefined, key, val);
                } else {
                    map.set(key, val);
                }
            }
            currentKeys.delete(key);
        }

        // Delete keys that are no longer present
        for (const key of currentKeys) {
            map.delete(key);
        }
    }

    /**
     * Helper to update a single entry in a map
     */
    private updateMapEntry(
        map: LoroMap,
        key: string,
        value: unknown,
        schema: SchemaType | null,
    ) {
        if (key === CID_KEY) return; // Ignore CID in writes
        // Check if this field should be a container according to schema
        if (schema && schema.type === "loro-map" && schema.definition) {
            const fieldSchema = schema.definition[key];
            if (fieldSchema && fieldSchema.type === "ignore") {
                // Skip ignore fields: they live only in mirrored state
                return;
            }
            if (fieldSchema && isContainerSchema(fieldSchema)) {
                const ct = schemaToContainerType(fieldSchema);
                if (ct && isValueOfContainerType(ct, value)) {
                    this.insertContainerIntoMap(map, fieldSchema, key, value);
                    return; // Avoid overwriting the inserted container
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
     *
     * - If `updater` is an object, it will shallow-merge into the current state.
     * - If `updater` is a function, it may EITHER:
     *   - mutate a draft (Immer-style), OR
     *   - return a brand new immutable state object.
     *
     * This supports both immutable and mutative update styles without surprises.
     */
    setState(
        updater: (state: Readonly<InferInputType<S>>) => InferInputType<S>,
        options?: SetStateOptions,
    ): void;
    setState(
        updater: (state: InferType<S>) => void,
        options?: SetStateOptions,
    ): void;
    setState(
        updater: Partial<InferInputType<S>>,
        options?: SetStateOptions,
    ): void;
    setState(
        updater:
            | ((state: InferType<S>) => InferType<S> | InferInputType<S> | void)
            | ((state: Readonly<InferInputType<S>>) => InferInputType<S>)
            | Partial<InferInputType<S>>,
        options?: SetStateOptions,
    ) {
        if (this.syncing) return; // Prevent recursive updates

        // Calculate new state; support mutative or return-based updater via Immer
        const newState =
            typeof updater === "function"
                ? produce<InferType<S>>(this.state, (draft) => {
                      // Allow updater to either mutate draft or return a new state
                      const maybeResult = updater(draft as InferType<S>);
                      if (maybeResult && maybeResult !== draft) {
                          // Replace if updater returned a new state object
                          // Immer interprets a return value as replacement
                          return maybeResult;
                      }
                  })
                : { ...this.state, ...updater };

        // Validate state if needed
        // TODO: REVIEW We don't need to validate the state that are already reviewed
        if (this.options.validateUpdates) {
            const validation =
                this.schema && validateSchema(this.schema, newState);
            if (validation && !validation.valid) {
                const errorMessage = `State validation failed: ${validation.errors?.join(
                    ", ",
                )}`;
                throw new Error(errorMessage);
            }
        }

        // Extract tags for this update
        const tags = options?.tags
            ? Array.isArray(options.tags)
                ? options.tags
                : [options.tags]
            : undefined;

        // Update Loro based on new state
        // Refresh in-memory state from Doc to capture assigned IDs (e.g., TreeIDs)
        // and any canonical normalization (like Tree meta->data mapping).
        this.updateLoro(newState);
        this.state = newState;
        const shouldCheck = this.options.checkStateConsistency;
        if (shouldCheck) {
            this.checkStateConsistency();
        }

        // Notify subscribers
        this.notifySubscribers(SyncDirection.TO_LORO, tags);
    }

    checkStateConsistency() {
        const state = this.state;
        if (!deepEqual(state, this.buildRootStateSnapshot())) {
            console.error(
                "State diverged",
                JSON.stringify(state, null, 2),
                JSON.stringify(this.buildRootStateSnapshot(), null, 2),
            );
            throw new Error("[InternalError] State diverged");
        }
    }

    // Plain JSON-like types for state snapshot generation
    private containerToStateJson(c: Container): JSONValue {
        const kind = c.kind();
        if (kind === "Map") {
            const m = c as LoroMap;
            const obj: JSONObject = {};
            for (const k of m.keys()) {
                const v = m.get(k);
                obj[k] = isContainer(v)
                    ? this.containerToStateJson(v)
                    : (v as JSONValue);
            }
            const schema = this.getContainerSchema(c.id);
            if (schema && isLoroMapSchema(schema)) {
                obj[CID_KEY] = c.id;
            }
            return obj;
        } else if (kind === "List" || kind === "MovableList") {
            const arr: JSONValue[] = [];
            const l = c as unknown as LoroList | LoroMovableList;
            const len = l.length;
            for (let i = 0; i < len; i++) {
                const v = l.get(i);
                arr.push(
                    isContainer(v)
                        ? this.containerToStateJson(v)
                        : (v as JSONValue),
                );
            }
            return arr;
        } else if (kind === "Text") {
            // LoroText toJSON returns a string
            return (c as LoroText).toJSON();
        } else if (kind === "Tree") {
            const t = c as LoroTree;
            // Normalize via toJSON first
            const normalized = normalizeTreeNodes(t.toJSON());
            // Optionally inject $cid per node.data using an id->cid map from live nodes
            const schema = this.getContainerSchema(t.id);
            const withCid = schema && isLoroTreeSchema(schema);
            if (withCid) {
                const idToCid = new Map<string, string>();
                // Best-effort: collect from runtime nodes if API available
                const tMaybe = t as unknown as { getNodes?: () => unknown[] };
                const nodes: unknown[] = tMaybe.getNodes?.() ?? [];
                for (const raw of nodes) {
                    try {
                        const n = raw as { id?: unknown; data?: unknown };
                        const id = typeof n.id === "string" ? n.id : undefined;
                        let dataId: string | undefined;
                        if (n.data && typeof n.data === "object") {
                            const d = n.data as { id?: unknown };
                            dataId =
                                typeof d.id === "string" ? d.id : undefined;
                        }
                        if (id && dataId) idToCid.set(id, dataId);
                    } catch {
                        // ignore
                    }
                }
                const stamp = (arr: unknown[]) => {
                    for (const node of arr) {
                        const n = node as {
                            id: unknown;
                            data?: unknown;
                            children?: unknown;
                        };
                        const cid =
                            typeof n.id === "string"
                                ? idToCid.get(n.id)
                                : undefined;
                        if (cid) {
                            if (!n.data || typeof n.data !== "object") {
                                (n as { data: Record<string, unknown> }).data =
                                    {};
                            }
                            (n.data as Record<string, unknown>)[CID_KEY] = cid;
                        }
                        if (Array.isArray(n.children))
                            stamp(n.children as unknown[]);
                    }
                };
                stamp(normalized);
            }
            return normalized as unknown as JSONValue;
        }
        // Fallback
        return c.toJSON();
    }

    private buildRootStateSnapshot(): Record<string, unknown> {
        if (!this.schema || this.schema.type !== "schema") {
            // Fallback to previous normalization if no schema
            return toNormalizedJson(this.doc) as Record<string, unknown>;
        }

        const root: Record<string, unknown> = {};
        const rootSchema = this.schema as RootSchemaType<
            Record<string, ContainerSchemaType>
        >;
        for (const key in rootSchema.definition) {
            const fieldSchema = rootSchema.definition[key];
            const containerType = schemaToContainerType(fieldSchema);
            if (!containerType) continue;
            const container = getRootContainerByType(
                this.doc,
                key,
                containerType,
            );
            // Always include maps to expose $cid for stable identity
            if (containerType === "Map") {
                root[key] = this.containerToStateJson(container);
            } else if (
                containerType === "List" ||
                containerType === "MovableList"
            ) {
                // Always include lists, even if empty, to match Mirror's state shape
                root[key] = this.containerToStateJson(container);
            } else if (containerType === "Text") {
                // Always include text, even if empty, to match Mirror's state shape
                root[key] = this.containerToStateJson(container);
            } else if (containerType === "Tree") {
                const arr = this.containerToStateJson(container) as unknown[];
                if (!Array.isArray(arr) || arr.length === 0) continue;
                root[key] = arr;
            } else {
                root[key] = this.containerToStateJson(container);
            }
        }
        return root;
    }

    /**
     * Register a container schema
     */
    private registerContainerWithRegistry(
        containerId: ContainerID,
        schemaType: ContainerSchemaType | undefined,
    ) {
        this.containerRegistry.set(containerId, {
            schema: schemaType,
            registered: true,
        });
    }

    private getContainerSchema(
        containerId: ContainerID,
    ): ContainerSchemaType | undefined {
        return this.containerRegistry.get(containerId)?.schema;
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
        } else if (
            isLoroListSchema(containerSchema) ||
            isLoroMovableListSchema(containerSchema)
        ) {
            return containerSchema.itemSchema;
        } else if (isLoroTreeSchema(containerSchema)) {
            // Tree nodes' data map schema
            return containerSchema.nodeSchema;
        }

        return undefined;
    }
}

/**
 * Export the json of the doc with LoroTree containers normalized
 * @param doc
 * @returns
 */
export function toNormalizedJson(doc: LoroDoc) {
    return doc.toJsonWithReplacer((_k, v) => {
        if (isContainer(v) && v.kind() === "Tree") {
            return normalizeTreeNodes(v.toJSON()) as unknown as typeof v;
        }

        return v;
    });
}

// Normalize a shallow object shape from provided initialState by converting
// container-like primitives to empty shapes without carrying data:
// - arrays -> []
// - strings -> ''
// - plain objects -> {}
// Other primitive types are passed through (number, boolean, null/undefined).
function normalizeInitialShapeShallow(
    input: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (Array.isArray(value)) {
            out[key] = [];
        } else if (typeof value === "string") {
            out[key] = "";
        } else if (isObject(value)) {
            out[key] = {};
        } else {
            out[key] = value;
        }
    }
    return out;
}

// Normalize LoroTree JSON (with `meta`) to Mirror tree node shape `{ id, data, children }`.
function normalizeTreeNodes(
    input: unknown[],
): Array<{ id: string; data: Record<string, unknown>; children: unknown[] }> {
    if (!Array.isArray(input)) return [];
    return input.map(mapRawTreeNodeToMirror);
}

function mapRawTreeNodeToMirror(n: unknown): {
    id: string;
    data: Record<string, unknown>;
    children: unknown[];
} {
    const rawId = (n as { id?: unknown })?.id;
    const id = typeof rawId === "string" ? rawId : "";
    const meta = (n as { meta?: unknown })?.meta;
    const data: Record<string, unknown> =
        typeof meta === "object" && meta != null && !Array.isArray(meta)
            ? (meta as Record<string, unknown>)
            : {};
    const rawChildren = (n as { children?: unknown })?.children;
    const children: unknown[] = Array.isArray(rawChildren)
        ? rawChildren.map(mapRawTreeNodeToMirror)
        : [];
    return { id, data, children };
}

// Deep merge initialState into a base state with awareness of the provided root schema.
// - Does not override values already present in base (doc/defaults take precedence)
// - For Ignore fields, copies values verbatim into in-memory state only
// - For container fields, fills missing keys with normalized empty shape when initialState hints at presence
// - For primitive fields, uses initial values if base lacks them
function mergeInitialIntoBaseWithSchema(
    base: Record<string, unknown>,
    init: Record<string, unknown>,
    rootSchema: RootSchemaType<Record<string, ContainerSchemaType>>,
) {
    for (const [k, initVal] of Object.entries(init)) {
        const fieldSchema = rootSchema.definition[k];
        if (!fieldSchema) {
            // Unknown field at root: hint shape only
            if (!(k in base)) {
                if (Array.isArray(initVal)) base[k] = [];
                else if (typeof initVal === "string") base[k] = "";
                else if (isObject(initVal)) base[k] = {};
            }
            continue;
        }

        const t = fieldSchema.type as string;
        if (t === "ignore") {
            base[k] = initVal;
            continue;
        }
        if (t === "loro-map") {
            // Ensure object
            if (!(k in base) || !isObject(base[k])) base[k] = {};
            const nestedBase = base[k] as Record<string, unknown>;
            const nestedInit = isObject(initVal)
                ? (initVal as Record<string, unknown>)
                : {};
            const nestedSchema = fieldSchema as unknown as LoroMapSchema<
                Record<string, SchemaType>
            >; // actual types are not used at runtime
            // Recurse
            mergeInitialIntoBaseWithSchema(nestedBase, nestedInit, {
                type: "schema",
                definition: nestedSchema.definition as Record<
                    string,
                    ContainerSchemaType
                >,
                options: {},
                getContainerType() {
                    return "Map";
                },
            } as unknown as RootSchemaType<
                Record<string, ContainerSchemaType>
            >);
            continue;
        }
        if (t === "loro-list" || t === "loro-movable-list") {
            if (!(k in base)) base[k] = [];
            continue;
        }
        if (t === "loro-text") {
            if (!(k in base)) base[k] = "";
            continue;
        }
        if (t === "string" || t === "number" || t === "boolean") {
            if (!(k in base)) base[k] = initVal;
            continue;
        }
    }
}
