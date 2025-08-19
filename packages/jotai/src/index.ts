/**
 * Jotai integration for Loro Mirror - Atomic state management with Loro CRDT synchronization
 * 
 * This package provides atom-based state management following Jotai's bottom-up approach.
 * Each piece of state is represented as an atom, enabling fine-grained reactivity and composition.
 */

import { atom, WritableAtom } from 'jotai';

// Import types only to avoid module resolution issues
import type { LoroDoc } from "loro-crdt";
import { createStore, SchemaType, Store } from "@loro-mirror/core";

/**
 * Configuration for creating a Loro Mirror atom
 */
export interface LoroAtomConfig<T = any> {
    /**
     * The Loro document to sync with
     */
    doc: LoroDoc;

    /**
     * The schema definition for the state
     */
    schema: any;

    /**
     * Unique key for this atom (used for persistence and identification)
     */
    key: string;

    /**
     * Initial state (optional)
     */
    initialState?: Partial<T>;

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
 * Internal store cache to avoid recreating stores
 */
const storeCache = new Map<string, Store<any>>();

/**
 * Creates a store instance with lazy initialization
 */
function createLoroStore<T extends SchemaType>(config: LoroAtomConfig<T>): Store<T> {
    const key = config.key;

    if (storeCache.has(key)) {
        return storeCache.get(key) as Store<T>;
    }

    const store = createStore(config);
    storeCache.set(key, store);
    return store;
}

/**
 * Creates a primary state atom that syncs with Loro
 * 
 * This is the main atom that holds the synchronized state.
 * It automatically syncs with the Loro document and notifies subscribers.
 * 
 * @example
 * ```tsx
 * const todoSchema = schema({
 *   todos: schema.LoroList(schema.LoroMap({
 *     id: schema.String({ required: true }),
 *     text: schema.String({ required: true }),
 *     completed: schema.Boolean({ defaultValue: false }),
 *   })),
 * });
 * 
 * const todoAtom = loroAtom({
 *   doc: new LoroDoc(),
 *   schema: todoSchema,
 *   initialState: { todos: [] },
 *   key: 'todos'
 * });
 * 
 * function TodoApp() {
 *   const [state, setState] = useAtom(todoAtom);
 *   // Use state and setState...
 * }
 * ```
 */
export function loroAtom<T = any>(
    config: LoroAtomConfig<T>
): WritableAtom<T, [T | ((prev: T) => T)], void> {
    const store = createLoroStore(config);
    store.sync();
    const stateAtom = atom(store.getState());

    const base = atom(
        // Read function - get current state from store
        (get) => {
            return get(stateAtom);
        },
        // Write function - update state and sync to Loro
        (get, set, update) => {
            const currentState = get(stateAtom);
            if (typeof update === 'function') {
                const newState = (update as (prev: T) => T)(currentState);
                store.setState(newState as Partial<T>);
                set(stateAtom, newState);
            } else {
                store.setState(update as Partial<T>);
                set(stateAtom, update);
            }
        }
    );
    return base;
}

/**
 * Hook to get the underlying Mirror instance from a config
 * 
 * Provides access to advanced Mirror functionality for power users.
 * 
 * @example
 * ```tsx
 * function AdvancedMirrorControls() {
 *   const mirror = useLoroMirror(todoConfig);
 *   
 *   const getContainerIds = () => {
 *     return mirror?.getContainerIds() || [];
 *   };
 * }
 * ```
 */
export function useLoroMirror<T>(
    config: LoroAtomConfig<T>
) {
    const store = createLoroStore(config);
    return store ? store.getMirror() : null;
}
