/**
 * React hooks for Loro Mirror
 */
import React, {
    createContext,
    PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { InferType, InferInputType, SchemaType, Mirror } from "loro-mirror";
import type { LoroDoc } from "loro-crdt";
// (No external state helper needed; Mirror handles Immer internally)

/**
 * Context options for creating a Loro Mirror store
 */
export interface UseLoroStoreOptions<S extends SchemaType> {
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
 * Hook to create and use a Loro Mirror store
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
 * function TodoApp() {
 *   const doc = useMemo(() => new LoroDoc(), []);
 *   const { state, setState } = useLoroStore({
 *     doc,
 *     schema: todoSchema,
 *     initialState: { todos: [] },
 *   });
 *
 *   // Use state and setState to interact with the store
 * }
 * ```
 */
export function useLoroStore<S extends SchemaType>(
    options: UseLoroStoreOptions<S>,
) {
    // Create a stable reference to the store
    const storeRef = useRef<Mirror<S> | null>(null);

    // Initialize the store and get initial state
    const getStore = useCallback((): Mirror<S> => {
        let store = storeRef.current;
        if (!store) {
            store = new Mirror(options);
            storeRef.current = store;
        }
        return store;
    }, [options]);

    // Get the current state
    const [state, setLocalState] = useState<InferType<S>>(() => {
        return getStore().getState();
    });

    // Subscribe to state changes
    useEffect(() => {
        const store = getStore();

        // Update local state when the store changes
        const unsubscribe = store.subscribe((newState: InferType<S>) => {
            setLocalState(newState);
        });

        return unsubscribe;
    }, [getStore]);

    // Create a stable setState function
    type SetStateFn = {
        (
            updater: (state: Readonly<InferInputType<S>>) => InferInputType<S>,
        ): Promise<void>;
        (updater: (state: InferType<S>) => void): Promise<void>;
        (updater: Partial<InferInputType<S>>): Promise<void>;
    };
    const setState: SetStateFn = useCallback(
        (updater: unknown) => {
            // Return the underlying promise so callers can await/catch
            return getStore().setState(updater as never);
        },
        [getStore],
    ) as unknown as SetStateFn;

    return {
        state,
        setState,
        store: getStore(),
    };
}

/**
 * Hook to subscribe to a specific value from a Loro Mirror store
 *
 * @example
 * ```tsx
 * function TodoList({ store }) {
 *   // Subscribe only to the todos array
 *   const todos = useLoroValue(store, state => state.todos);
 *
 *   return (
 *     <ul>
 *       {todos.map(todo => (
 *         <li key={todo.id}>{todo.text}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useLoroValue<S extends SchemaType, R>(
    store: Mirror<S>,
    selector: (state: InferType<S>) => R,
): R {
    // Get the initial value
    const [value, setValue] = useState<R>(() => selector(store.getState()));

    // Subscribe to changes
    useEffect(() => {
        const unsubscribe = store.subscribe((state: InferType<S>) => {
            const newValue = selector(state);
            setValue(newValue);
        });

        return unsubscribe;
    }, [store, selector]);

    return value;
}

/**
 * Hook to create a callback that updates a Loro Mirror store
 *
 * @example
 * ```tsx
 * function AddTodo({ store }) {
 *   const [text, setText] = useState('');
 *
 *   const addTodo = useLoroCallback(
 *     store,
 *     (state) => {
 *       state.todos.push({
 *         id: Date.now().toString(),
 *         text,
 *         completed: false,
 *       });
 *     },
 *     [text]
 *   );
 *
 *   return (
 *     <form onSubmit={(e) => {
 *       e.preventDefault();
 *       addTodo();
 *       setText('');
 *     }}>
 *       <input value={text} onChange={e => setText(e.target.value)} />
 *       <button type="submit">Add</button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useLoroCallback<S extends SchemaType, Args extends unknown[]>(
    store: Mirror<S>,
    updater:
        | ((
              state: InferType<S>,
              ...args: Args
          ) => void | InferType<S> | InferInputType<S>)
        | ((
              state: Readonly<InferInputType<S>>,
              ...args: Args
          ) => InferInputType<S>),
    deps: React.DependencyList = [],
): (...args: Args) => void {
    return useCallback(
        (...args: Args) => {
            // Delegate to store.setState using an unknown-typed adapter to avoid `any`
            const adapter = (s: unknown) =>
                (updater as (state: unknown, ...a: Args) => unknown)(
                    s,
                    ...args,
                );
            return store.setState(adapter as never);
        },
        [store, updater, ...deps],
    );
}

/**
 * Hook to create a Loro Mirror context provider and hooks
 *
 * @example
 * ```tsx
 * // In a shared file:
 * const todoSchema = schema({
 *   todos: schema.LoroList(schema.LoroMap({
 *     id: schema.String({ required: true }),
 *     text: schema.String({ required: true }),
 *     completed: schema.Boolean({ defaultValue: false }),
 *   })),
 * });
 *
 * export const {
 *   LoroProvider,
 *   useLoroContext,
 *   useLoroState,
 *   useLoroSelector,
 *   useLoroAction,
 * } = createLoroContext(todoSchema);
 *
 * // In your app:
 * function App() {
 *   const doc = useMemo(() => new LoroDoc(), []);
 *
 *   return (
 *     <LoroProvider doc={doc} initialState={{ todos: [] }}>
 *       <TodoList />
 *       <AddTodo />
 *     </LoroProvider>
 *   );
 * }
 * ```
 */
export function createLoroContext<S extends SchemaType>(schema: S) {
    // Create a React context
    const LoroContext = createContext<Mirror<S> | null>(null);

    // Create a provider component
    function LoroProvider({
        children,
        doc,
        initialState,
        validateUpdates,
        throwOnValidationError,
        debug,
    }: PropsWithChildren<Omit<UseLoroStoreOptions<S>, "schema">>) {
        const { store } = useLoroStore({
            doc,
            schema,
            initialState,
            validateUpdates,
            throwOnValidationError,
            debug,
        });

        return (
            <LoroContext.Provider value={store}>
                {children}
            </LoroContext.Provider>
        );
    }

    // Hook to access the context
    function useLoroContext() {
        const context = useContext(LoroContext);
        if (!context) {
            throw new Error(
                "useLoroContext must be used within a LoroProvider",
            );
        }
        return context;
    }

    // Hook to access the full state
    function useLoroState() {
        const store = useLoroContext();
        const [state, setState] = useState(store.getState());

        useEffect(() => {
            const unsubscribe = store.subscribe((newState: InferType<S>) => {
                setState(newState);
            });

            return unsubscribe;
        }, [store]);

        type UpdateStateFn = {
            (
                updater: (
                    state: Readonly<InferInputType<S>>,
                ) => InferInputType<S>,
            ): Promise<void>;
            (updater: (state: InferType<S>) => void): Promise<void>;
            (updater: Partial<InferInputType<S>>): Promise<void>;
        };
        const updateState: UpdateStateFn = useCallback(
            (updater: unknown) => {
                return store.setState(updater as never);
            },
            [store],
        ) as unknown as UpdateStateFn;

        return [state, updateState] as const;
    }

    // Hook to select a specific value from the state
    function useLoroSelector<R>(selector: (state: InferType<S>) => R): R {
        const store = useLoroContext();
        return useLoroValue(store, selector);
    }

    // Hook to create an action that updates the state
    function useLoroAction<Args extends unknown[]>(
        updater: (state: InferType<S>, ...args: Args) => void,
        deps: React.DependencyList = [],
    ): (...args: Args) => void {
        const store = useLoroContext();
        return useLoroCallback(store, updater, deps);
    }

    return {
        LoroContext,
        LoroProvider,
        useLoroContext,
        useLoroState,
        useLoroSelector,
        useLoroAction,
    };
}
