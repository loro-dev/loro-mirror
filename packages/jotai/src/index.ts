/**
 * Jotai integration for Loro Mirror - Atomic state management with Loro CRDT synchronization
 *
 * This package provides atom-based state management following Jotai's bottom-up approach.
 * Each piece of state is represented as an atom, enabling fine-grained reactivity and composition.
 */

import { atom } from "jotai";

// Import types only to avoid module resolution issues
import type { LoroDoc, EphemeralStore } from "loro-crdt";
import { Mirror } from "loro-mirror";
import type {
    SchemaType,
    InferType,
    InferInputType,
} from "loro-mirror";

type MirrorUpdateSource = "LORO" | "MIRROR" | "EPHEMERAL" | "INITIAL";

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

    /**
     * Optional EphemeralStore for syncing temporary state without polluting
     * LoroDoc history.
     *
     * **Setting this changes how writes work:** eligible changes (primitive
     * values on existing Map keys) are automatically routed to
     * EphemeralStore instead of LoroDoc. Use `loroMirrorAtoms` to get a
     * `finalizeAtom` for committing ephemeral values to LoroDoc.
     */
    ephemeralStore?: EphemeralStore;
}

/** Shared helper — creates the Mirror, state atom, and subscription atom. */
function createMirrorAtoms<S extends SchemaType>(
    config: LoroMirrorAtomConfig<S>,
) {
    const store = new Mirror(config);
    const stateAtom = atom(store.getState() as InferType<S>);
    const subAtom = atom(null, (_get, set, update: InferType<S>) => {
        set(stateAtom, update);
    });

    subAtom.onMount = (set) => {
        set(store.getState() as InferType<S>);
        const sub = store.subscribe((state: InferType<S>, { source }: { source: MirrorUpdateSource }) => {
            if (source === "LORO" || source === "EPHEMERAL") {
                set(state);
            }
        });
        return () => {
            sub?.();
        };
    };

    const base = atom(
        (get) => {
            get(subAtom);
            return get(stateAtom);
        },
        (_get, set, update: Partial<InferInputType<S>>) => {
            store.setState(update);
            set(stateAtom, store.getState() as InferType<S>);
        },
    );

    return { store, stateAtom, base };
}

/**
 * Creates a primary state atom that syncs with Loro.
 *
 * Returns a single read/write atom — drop-in replacement for `useAtom`.
 *
 * @example
 * ```tsx
 * const todoAtom = loroMirrorAtom({
 *   doc: new LoroDoc(),
 *   schema: todoSchema,
 *   initialState: { todos: [] },
 * });
 *
 * function TodoApp() {
 *   const [state, setState] = useAtom(todoAtom);
 * }
 * ```
 */
export function loroMirrorAtom<S extends SchemaType>(
    config: LoroMirrorAtomConfig<S>,
) {
    const { base } = createMirrorAtoms(config);
    return base;
}

/**
 * Creates a set of atoms for full Loro Mirror integration including
 * ephemeral patch support.
 *
 * @returns `{ stateAtom, finalizeAtom }`
 *   - `stateAtom` — read/write atom for the synchronized state (same as `loroMirrorAtom`).
 *     When `ephemeralStore` is configured, eligible changes are automatically routed
 *     through EphemeralStore.
 *   - `finalizeAtom` — write-only atom that commits pending ephemeral patches to LoroDoc
 *
 * @example
 * ```tsx
 * const { stateAtom, finalizeAtom } = loroMirrorAtoms({
 *   doc,
 *   schema: canvasSchema,
 *   ephemeralStore: new EphemeralStore(),
 * });
 *
 * function Canvas() {
 *   const [state, setState] = useAtom(stateAtom);
 *   const finalize = useSetAtom(finalizeAtom);
 *
 *   const onDrag = (x: number, y: number) => {
 *     setState({ x, y });
 *   };
 *
 *   const onDragEnd = () => finalize();
 * }
 * ```
 */
export function loroMirrorAtoms<S extends SchemaType>(
    config: LoroMirrorAtomConfig<S>,
) {
    const { store, base } = createMirrorAtoms(config);

    const finalizeAtom = atom(null, (_get, _set) => {
        store.finalizeEphemeralPatches();
    });

    return { stateAtom: base, finalizeAtom };
}
