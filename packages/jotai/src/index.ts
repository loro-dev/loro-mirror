/**
 * Jotai integration for Loro Mirror - Atomic state management with Loro CRDT synchronization
 * 
 * This package provides atom-based state management following Jotai's bottom-up approach.
 * Each piece of state is represented as an atom, enabling fine-grained reactivity and composition.
 */

import { atom, WritableAtom, Atom } from 'jotai';
import { atomWithStorage, createJSONStorage, atomFamily, selectAtom } from 'jotai/utils';

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

    /**
     * Unique key for this atom (used for persistence and identification)
     */
    key?: string;
}

/**
 * Internal store cache to avoid recreating stores
 */
const storeCache = new Map<string, Store<any>>();

/**
 * Creates a store instance with lazy initialization
 */
function createLoroStore<T extends SchemaType>(config: LoroAtomConfig<T>): Store<T> {
    const key = config.key || `store-${Date.now()}-${Math.random()}`;

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
    const stateAtom = atom(store.getState());

    const base = atom(
        // Read function - get current state from store
        (get) => {
            return get(stateAtom);
        },
        // Write function - update state and sync to Loro
        (get, set, update) => {
            if (typeof update === 'function') {
                const currentState = store.getState();
                const newState = (update as (prev: T) => T)(currentState);
                store.setState(newState as Partial<T>);
            } else {
                store.setState(update as Partial<T>);
            }
        }
    );
    stateAtom.onMount = (set) => {
        const sub = store.subscribe((newState: T) => {
            set(newState);
        });
        store.sync();
        return sub;
    }

    return base;
}

/**
 * Creates a derived atom that selects a specific piece of state
 * 
 * This follows Jotai's philosophy of creating focused, granular atoms
 * for specific pieces of state to minimize re-renders.
 * 
 * @example
 * ```tsx
 * const todosAtom = loroSelect(todoAtom, (state) => state.todos);
 * const filterAtom = loroSelect(todoAtom, (state) => state.filter);
 * 
 * function TodoList() {
 *   const todos = useAtomValue(todosAtom); // Only re-renders when todos change
 *   // ...
 * }
 * ```
 */
export function loroSelect<T, R>(
    baseAtom: Atom<T>,
    selector: (state: T) => R
): Atom<R> {
    return selectAtom(baseAtom, selector);
}

/**
 * Creates a focused atom for a specific path in the state
 * 
 * Creates a derived atom that focuses on a specific path in the state tree.
 * This is perfect for editing specific items in lists or nested objects.
 * 
 * @example
 * ```tsx
 * const todoItemAtom = loroFocus(
 *   todoAtom, 
 *   (state) => state.todos[0],
 *   (state, newValue) => {
 *     const newState = { ...state };
 *     newState.todos[0] = newValue;
 *     return newState;
 *   }
 * );
 * 
 * function TodoItem() {
 *   const [todo, setTodo] = useAtom(todoItemAtom);
 *   // Direct editing of the focused todo item
 * }
 * ```
 */
export function loroFocus<T, R>(
    baseAtom: WritableAtom<T, any, any>,
    getter: (state: T) => R,
    setter: (state: T, newValue: R) => T
): WritableAtom<R, [R], void> {
    return atom(
        (get) => {
            const state = get(baseAtom);
            return getter(state);
        },
        (get, set, newValue: R) => {
            const currentState = get(baseAtom);
            const newState = setter(currentState, newValue);
            set(baseAtom, newState);
        }
    );
}

/**
 * Creates an action atom for performing complex state updates
 * 
 * Action atoms encapsulate business logic and provide a clean API
 * for performing complex state transformations.
 * 
 * @example
 * ```tsx
 * const addTodoAtom = loroAction(todoAtom, (get, set, text: string) => {
 *   const currentState = get(todoAtom);
 *   set(todoAtom, (state) => {
 *     state.todos.push({
 *       id: Date.now().toString(),
 *       text,
 *       completed: false,
 *     });
 *     return state;
 *   });
 * });
 * 
 * function AddTodo() {
 *   const addTodo = useSetAtom(addTodoAtom);
 *   // Use addTodo(text) to add todos
 * }
 * ```
 */
export function loroAction<T, Args extends any[], Result = void>(
    baseAtom: WritableAtom<T, any, any>,
    actionFn: (
        get: <Value>(atom: Atom<Value>) => Value,
        set: <Value, Args extends any[], Result>(
            atom: WritableAtom<Value, Args, Result>,
            ...args: Args
        ) => Result,
        ...args: Args
    ) => Result
): WritableAtom<null, Args, Result> {
    return atom(
        null,
        (get, set, ...args) => actionFn(get, set, ...args)
    );
}

/**
 * Creates a family of atoms for managing collections
 * 
 * Atom families are perfect for managing dynamic collections where
 * each item needs its own atom for optimal performance.
 * 
 * @example
 * ```tsx
 * const todoItemFamily = loroAtomFamily((id: string) => 
 *   loroSelect(todoAtom, (state) => 
 *     state.todos.find(todo => todo.id === id)
 *   )
 * );
 * 
 * function TodoItem({ id }: { id: string }) {
 *   const todo = useAtomValue(todoItemFamily(id));
 *   // Each todo item has its own atom
 * }
 * ```
 */
export function loroAtomFamily<Param, T>(
    atomCreator: (param: Param) => WritableAtom<T, any, any>
) {
    return atomFamily(atomCreator);
}

/**
 * Creates a sync atom for manual synchronization operations
 * 
 * This atom provides control over when synchronization happens,
 * useful for optimizing performance in complex applications.
 * 
 * @example
 * ```tsx
 * const syncAtom = loroSync(todoConfig);
 * 
 * function SyncControls() {
 *   const sync = useSetAtom(syncAtom);
 *   
 *   return (
 *     <div>
 *       <button onClick={() => sync('fromLoro')}>Sync from Loro</button>
 *       <button onClick={() => sync('toLoro')}>Sync to Loro</button>
 *       <button onClick={() => sync('bidirectional')}>Full Sync</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function loroSync<T>(
    config: LoroAtomConfig<T>
): WritableAtom<null, ['fromLoro' | 'toLoro' | 'bidirectional'], T> {
    const store = createLoroStore(config);

    return atom(
        null,
        (get, set, syncType: 'fromLoro' | 'toLoro' | 'bidirectional') => {
            switch (syncType) {
                case 'fromLoro':
                    return store.syncFromLoro();
                case 'toLoro':
                    store.syncToLoro();
                    return store.getState();
                case 'bidirectional':
                    return store.sync();
                default:
                    return store.getState();
            }
        }
    );
}

/**
 * Creates a persistent atom that saves state to storage
 * 
 * Combines Loro's CRDT synchronization with local persistence
 * for offline-first applications.
 * 
 * @example
 * ```tsx
 * const persistentTodoAtom = loroPersistent({
 *   doc: new LoroDoc(),
 *   schema: todoSchema,
 *   key: 'todos',
 *   storage: localStorage, // or any Storage-like interface
 * });
 * ```
 */
export function loroPersistent<T>(
    config: LoroAtomConfig<T> & {
        storage?: Storage;
        serialize?: (state: T) => string;
        deserialize?: (str: string) => T;
    }
): WritableAtom<T, [T | ((prev: T) => T)], void> {
    const key = config.key || 'loro-mirror-state';
    const storage = config.storage || (typeof window !== 'undefined' ? localStorage : undefined);

    if (!storage) {
        // Fallback to regular atom if no storage available
        return loroAtom(config);
    }

    const storageAtom = atomWithStorage<T>(
        key,
        config.initialState as T || ({} as T),
        createJSONStorage(() => storage),
        {
            getOnInit: true,
        }
    );

    const loroStateAtom = loroAtom(config);

    // Sync between storage and Loro state
    return atom(
        (get) => {
            const loroState = get(loroStateAtom);
            const storageState = get(storageAtom);

            // Prefer Loro state if it exists, otherwise use storage
            return loroState || storageState;
        },
        (get, set, update) => {
            // Update both Loro and storage
            set(loroStateAtom, update);
            if (typeof update === 'function') {
                const currentStorage = get(storageAtom);
                const newValue = (update as (prev: T) => T)(currentStorage);
                set(storageAtom, newValue);
            } else {
                set(storageAtom, update);
            }
        }
    );
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
