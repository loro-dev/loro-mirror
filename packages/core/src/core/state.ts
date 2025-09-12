/**
 * State management functionality for Loro Mirror
 */
import { produce } from "immer";
import type { LoroDoc } from "loro-crdt";
import { Mirror, UpdateMetadata } from "./mirror";
import { InferType, InferInputType, SchemaType } from "../schema";

/**
 * Options for creating a store
 */
export interface CreateStoreOptions<S extends SchemaType> {
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
    initialState?: Partial<InferInputType<S>>;

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

    checkStateConsistency?: boolean;
}

/**
 * Store API returned by createStore
 */
export interface Store<S extends SchemaType> {
    /**
     * Get current state
     */
    getState: () => InferType<S>;

    /**
     * Update state and sync to Loro
     */
    setState: {
        (
            updater: (state: Readonly<InferInputType<S>>) => InferInputType<S>,
        ): Promise<void>;
        (updater: (state: InferType<S>) => void): Promise<void>;
        (updater: Partial<InferInputType<S>>): Promise<void>;
    };

    /**
     * Subscribe to state changes
     */
    subscribe: (
        callback: (state: InferType<S>, metadata: UpdateMetadata) => void,
    ) => () => void;

    /**
     * Get the underlying Mirror instance
     */
    getMirror: () => Mirror<S>;
    getLoro: () => LoroDoc;
}

/**
 * Create a store that syncs state with Loro
 */
export function createStore<S extends SchemaType>(
    options: CreateStoreOptions<S>,
): Store<S> {
    const mirror = new Mirror<S>({
        doc: options.doc,
        schema: options.schema,
        initialState: options.initialState,
        validateUpdates: options.validateUpdates,
        throwOnValidationError: options.throwOnValidationError ?? true,
        debug: options.debug,
        checkStateConsistency: options.checkStateConsistency,
    });

    const setStateImpl = async (updater: unknown) => {
        // Delegate to mirror; overload resolution occurs there
        await mirror.setState(updater as never);
    };

    return {
        getState: () => mirror.getState(),
        setState: setStateImpl as unknown as {
            (updater: (state: InferType<S>) => void): Promise<void>;
            (
                updater: (
                    state: Readonly<InferInputType<S>>,
                ) => InferInputType<S>,
            ): Promise<void>;
            (updater: Partial<InferInputType<S>>): Promise<void>;
        },
        subscribe: (callback) => mirror.subscribe(callback),
        getMirror: () => mirror,
        getLoro: () => options.doc,
    };
}

/**
 * Create an immer-based reducer function for a store
 */
export function createReducer<S extends SchemaType, A>(actionHandlers: {
    [K in keyof A]: (state: unknown, payload: A[K]) => void;
}) {
    return (store: Store<S>) => {
        // Return a dispatch function that takes an action and payload
        return <K extends keyof A>(actionType: K, payload: A[K]) => {
            const handler = actionHandlers[actionType] as unknown as (
                state: import("immer").Draft<InferType<S>>,
                payload: A[K],
            ) => void;
            if (!handler) {
                throw new Error(`Unknown action type: ${String(actionType)}`);
            }

            void store.setState(
                (state) =>
                    produce<InferType<S>>(
                        state as unknown as InferType<S>,
                        (draft: import("immer").Draft<InferType<S>>) => {
                            handler(draft, payload);
                        },
                    ) as unknown as InferInputType<S>,
            );
        };
    };
}
