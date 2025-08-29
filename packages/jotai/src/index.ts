/**
 * Jotai integration for Loro Mirror - Atomic state management with Loro CRDT synchronization
 * 
 * This package provides atom-based state management following Jotai's bottom-up approach.
 * Each piece of state is represented as an atom, enabling fine-grained reactivity and composition.
 */

import { atom, WritableAtom } from 'jotai';

// Import types only to avoid module resolution issues
import type { LoroDoc } from "loro-crdt";
import { createStore, SchemaType, Store } from "loro-mirror";

/**
 * Configuration for creating a Loro Mirror atom
 */
export interface LoroMirrorAtomConfig<T = any> {
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
function createLoroMirrorStore<T extends SchemaType>(config: LoroMirrorAtomConfig<T>): Store<T> {
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
 *     id: schema.String(),
 *     text: schema.String(),
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
export function loroMirrorAtom<T = any>(
    config: LoroMirrorAtomConfig<T>
): WritableAtom<T, [T | ((prev: T) => T)], void> {
    const store = createLoroMirrorStore(config);
    const stateAtom = atom(store.getState());
    let sub: () => void | undefined;
    const initAtom = atom(null, async (_get, set, action: "init" | "destroy") => {
        if (action === "init") {
            sub = store.subscribe((state) => {
                set(stateAtom, state);
            });
        } else {
            sub?.()
            storeCache.delete(config.key);
        }
    })

    initAtom.onMount = (action) => {
        action("init");
        return () => {
            action("destroy");
        }
    }

    const base = atom(
        (get) => {
            get(initAtom)
            return get(stateAtom);
        },
        (get, _set, update) => {
            const currentState = get(stateAtom);
            if (typeof update === 'function') {
                const newState = (update as (prev: T) => T)(currentState);
                store.setState(newState as Partial<T>);
            } else {
                store.setState(update as Partial<T>);
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
    config: LoroMirrorAtomConfig<T>
) {
    const store = createLoroMirrorStore(config);
    return store ? store.getMirror() : null;
}
