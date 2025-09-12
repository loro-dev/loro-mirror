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
import type { SchemaType, InferType, InferInputType } from "loro-mirror";

/**
 * Configuration for creating a Loro Mirror atom
 */
export interface LoroMirrorAtomConfig<S extends SchemaType> {
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
export function loroMirrorAtom<S extends SchemaType>(
    config: LoroMirrorAtomConfig<S>
): WritableAtom<
    InferType<S>,
    [InferInputType<S> | ((prev: InferType<S>) => InferInputType<S>)],
    void
> {
    const store = createStore(config);
    const stateAtom = atom<InferType<S>>(store.getState() as InferType<S>);
    const subAtom = atom<null, [InferType<S>], void>(null, (_get, set, update) => {
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

    const base = atom<
        InferType<S>,
        [InferInputType<S> | ((prev: InferType<S>) => InferInputType<S>)],
        void
    >(
        (get) => {
            get(subAtom);
            return get(stateAtom);
        },
        (get, set, update) => {
            const currentState = get(stateAtom) as InferType<S>;
            if (typeof update === 'function') {
                const nextInput = (update as (prev: InferType<S>) => InferInputType<S>)(currentState);
                // Fire-and-forget: Mirror.setState is async
                void store.setState(nextInput as Partial<InferInputType<S>>);
            } else {
                // Fire-and-forget: Mirror.setState is async
                void store.setState(update as Partial<InferInputType<S>>);
            }
            // Reflect latest state from Mirror after any stamping like $cid
            set(stateAtom, store.getState() as InferType<S>);
        }
    );
    return base;
}
