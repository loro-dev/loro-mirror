/**
 * Jotai integration for Loro Mirror - Atomic state management with Loro CRDT synchronization
 * 
 * This package provides atom-based state management following Jotai's bottom-up approach.
 * Each piece of state is represented as an atom, enabling fine-grained reactivity and composition.
 */

import { atom, WritableAtom } from 'jotai';

// Import types only to avoid module resolution issues
import type { LoroDoc } from "loro-crdt";
import { createStore } from "loro-mirror";

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
    const store = createStore(config);
    const stateAtom = atom(store.getState());
    const subAtom = atom(null, (_get, set, update) => {
        set(stateAtom, update);
    });

    subAtom.onMount = (set) => {
        const sub = store.subscribe((state) => {
            set(state);
        });
        return () => {
            sub?.();
        }
    }

    const base = atom(
        (get) => {
            get(subAtom);
            return get(stateAtom);
        },
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
