import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReducer, createStore, Store } from "../../src/core/state";
import { schema } from "../../src/schema";
import { SyncDirection } from "../../src/core/mirror";
import { LoroDoc, LoroMap, LoroList } from "loro-crdt";
import { 
  createWrappedValue,
  getPrimitiveValue, 
  isWrappedValue, 
  WrappedValue 
} from "../../src/schema/validators";

// Type guard for LoroMap
function isLoroMap(obj: unknown): obj is LoroMap {
  return obj !== null &&
    typeof obj === "object" &&
    "kind" in obj &&
    typeof obj.kind === "function" &&
    obj.kind() === "Map";
}

// Utility to wait for sync to complete (three microtasks for reliable sync)
const waitForSync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// Helper function to handle primitive or wrapped values consistently
function getPrimitiveOrWrapped<T>(value: T, needsWrapping: boolean): T | WrappedValue<T> {
  return needsWrapping ? createWrappedValue(value) : value;
}

// Define a type for the state shape with proper wrapped values
interface TestState {
  name: string | WrappedValue<string>;
  count: number | WrappedValue<number>;
  isActive: boolean | WrappedValue<boolean>;
  tags: string[];
  profile: {
    bio: string;
    avatar?: string;
  };
  notes: string;
}

describe("Core State Management", () => {
  let doc: LoroDoc;
  let testSchema: ReturnType<typeof schema>;

  beforeEach(() => {
    // Create a fresh LoroDoc for each test
    doc = new LoroDoc();

    // Define schema for test
    testSchema = schema({
      name: schema.String({ defaultValue: "Default Name" }),
      count: schema.Number({ defaultValue: 0 }),
      isActive: schema.Boolean({ defaultValue: false }),
      tags: schema.LoroList(schema.String()),
      profile: schema.LoroMap({
        bio: schema.String({ defaultValue: "" }),
        avatar: schema.String(),
      }),
      notes: schema.LoroText({ defaultValue: "" }),
    });

    // Initialize containers with the same names as in schema definition
    // This ensures container names match what Mirror expects
    const rootMap = doc.getMap("root");
    
    const nameMap = doc.getMap("name");
    nameMap.set("value", "Default Name");
    rootMap.setContainer("name", nameMap);
    
    const countMap = doc.getMap("count");
    countMap.set("value", 0);
    rootMap.setContainer("count", countMap);
    
    const isActiveMap = doc.getMap("isActive");
    isActiveMap.set("value", false);
    rootMap.setContainer("isActive", isActiveMap);
    
    const tagsList = doc.getList("tags");
    rootMap.setContainer("tags", tagsList);
    
    const profileMap = doc.getMap("profile");
    profileMap.set("bio", "");
    rootMap.setContainer("profile", profileMap);
    
    const notesText = doc.getText("notes");
    notesText.update("");
    rootMap.setContainer("notes", notesText);
    
    // Commit all changes
    doc.commit();
  });

  describe("createStore", () => {
    it("should create a store with default values", async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;

      // Check individual properties - use getPrimitiveValue for all checks
      expect(getPrimitiveValue(state.name)).toBe("Default Name");
      expect(getPrimitiveValue(state.count)).toBe(0);
      expect(getPrimitiveValue(state.isActive)).toBe(false);
      expect(state.profile.bio).toBe("");

      // Verify tags list is initialized
      expect(Array.isArray(state.tags)).toBe(true);
      expect(state.tags.length).toBe(0);
    });

    it("should create a store with initial values", async () => {
      // Update the initial values in the Loro document
      const nameMap = doc.getMap("name");
      nameMap.set("value", "Initial Name");
      
      const countMap = doc.getMap("count");
      countMap.set("value", 10);
      
      // Initialize profile map with avatar value
      const profileMap = doc.getMap("profile");
      profileMap.set("bio", ""); // Ensure bio exists
      profileMap.set("avatar", "avatar.jpg");
      
      // Initialize tags list with values
      const tagsList = doc.getList("tags");
      tagsList.insert(0, "tag1");
      tagsList.insert(1, "tag2");
      
      // Commit changes
      doc.commit();

      const store = createStore({
        doc,
        schema: testSchema,
        initialState: {
          name: "Initial Name",
          count: 10,
          tags: ["tag1", "tag2"],
          profile: {
            avatar: "avatar.jpg",
            bio: "", // Include bio to match schema
          },
        },
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;

      // Check individual properties - use getPrimitiveValue for primitive types
      expect(getPrimitiveValue(state.name)).toBe("Initial Name");
      expect(getPrimitiveValue(state.count)).toBe(10);
      expect(getPrimitiveValue(state.isActive)).toBe(false);
      expect(state.profile.avatar).toBe("avatar.jpg");
      expect(state.profile.bio).toBe("");

      // Verify tags list
      expect(Array.isArray(state.tags)).toBe(true);
      expect(state.tags).toContain("tag1");
      expect(state.tags).toContain("tag2");
    });

    it("should update state with setState", async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();

      // Get the current state to check format
      const currentState = store.getState() as TestState;
      const needsValueWrapping = isWrappedValue(currentState.name);

      // Update state with proper format handling
      if (needsValueWrapping) {
        store.setState({
          name: createWrappedValue("Updated Name"),
          count: createWrappedValue(5),
        });
      } else {
        store.setState({
          name: "Updated Name",
          count: 5,
        });
      }

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;
      expect(getPrimitiveValue(state.name)).toBe("Updated Name");
      expect(getPrimitiveValue(state.count)).toBe(5);
      expect(getPrimitiveValue(state.isActive)).toBe(false); // Unchanged
    });

    it("should update state with setState using a function", async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();

      // Get the current state to check format
      const currentState = store.getState() as TestState;
      const needsValueWrapping = isWrappedValue(currentState.count);

      // Update state with a function, handling both object and primitive formats
      store.setState((state: TestState) => {
        const newState = { ...state };
        
        // Handle count increment
        const countValue = getPrimitiveValue<number>(newState.count);
        const activeValue = getPrimitiveValue<boolean>(newState.isActive);
        
        if (needsValueWrapping) {
          newState.count = createWrappedValue(countValue + 1);
          newState.isActive = createWrappedValue(!activeValue);
        } else {
          newState.count = countValue + 1;
          newState.isActive = !activeValue;
        }
        
        return newState as TestState;
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;
      expect(getPrimitiveValue(state.count)).toBe(1);
      expect(getPrimitiveValue(state.isActive)).toBe(true);
    });

    it("should subscribe to state changes", async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();

      const subscriber = vi.fn();
      const unsubscribe = store.subscribe(subscriber);

      // Get the current state to check format
      const currentState = store.getState() as TestState;
      const needsValueWrapping = isWrappedValue(currentState.name);

      // Update state using proper format
      if (needsValueWrapping) {
        store.setState({ name: createWrappedValue("New Name") });
      } else {
        store.setState({ name: "New Name" });
      }
      
      // Wait for sync to complete - add extra microtasks to ensure subscriber is called
      await waitForSync();
      await waitForSync();

      expect(subscriber).toHaveBeenCalledWith(
        expect.any(Object),
        SyncDirection.TO_LORO,
      );

      // Verify name was updated in the callback state
      const callbackState = subscriber.mock.calls[0][0] as TestState;
      expect(getPrimitiveValue(callbackState.name)).toBe("New Name");

      unsubscribe();

      // Update after unsubscribe using proper format
      if (needsValueWrapping) {
        store.setState({ name: createWrappedValue("Another Name") });
      } else {
        store.setState({ name: "Another Name" });
      }

      // Wait for sync to complete
      await waitForSync();

      // Called exactly once - not called again after unsubscribe
      expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it("should sync state bidirectionally", async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();
      
      // Get the current state to check format
      const currentState = store.getState() as TestState;
      const needsValueWrapping = isWrappedValue(currentState.name);
      
      // First manually update the loro document directly
      const nameMap = doc.getMap("name");
      nameMap.set("value", "Test Name");
      
      const countMap = doc.getMap("count");
      countMap.set("value", 42);
      
      // Commit changes to ensure they're saved
      doc.commit();
      
      // Important: Wait for sync to complete
      await waitForSync();
      
      // Verify changes are reflected in the state
      const updatedState = store.getState() as TestState;
      expect(getPrimitiveValue(updatedState.name)).toBe("Test Name");
      expect(getPrimitiveValue(updatedState.count)).toBe(42);
      
      // Now update the state through the store
      if (needsValueWrapping) {
        store.setState({
          name: createWrappedValue("Test Name"),
          count: createWrappedValue(42),
        });
      } else {
        store.setState({
          name: "Test Name",
          count: 42,
        });
      }
      
      // Wait for sync to propagate changes
      await waitForSync();
      
      // Now simulate a change directly to Loro document
      const profileMap = doc.getMap("profile");
      profileMap.set("bio", "Updated from Loro");
      doc.commit(); // Important: Commit changes to the doc
      
      // Wait for sync to complete
      await waitForSync();
      await waitForSync(); // Extra wait to ensure changes propagate
      
      // Sync should update the state
      const syncedState = store.sync() as TestState;
      
      // Wait for sync to process
      await waitForSync();
      
      // Verify the bio was updated from Loro
      expect(syncedState.profile.bio).toBe("Updated from Loro");
      
      // These should match what we set earlier
      expect(getPrimitiveValue(syncedState.name)).toBe("Test Name");
      expect(getPrimitiveValue(syncedState.count)).toBe(42);
    });
  });

  describe("createReducer", () => {
    let doc: LoroDoc;
    let testSchema: ReturnType<typeof schema>;
    let store: Store<ReturnType<typeof schema>>;

    // Define a type for reducer state
    interface ReducerState {
      count: number | WrappedValue<number>;
      text: string | WrappedValue<string>;
      todos: TodoItem[];
    }

    // Define type for todo item
    interface TodoItem {
      id: string;
      text: string;
      completed: boolean;
    }

    beforeEach(async () => {
      // Create a fresh LoroDoc for each test
      doc = new LoroDoc();

      testSchema = schema({
        count: schema.Number({ defaultValue: 0 }),
        text: schema.String({ defaultValue: "" }),
        todos: schema.LoroList(schema.LoroMap({
          id: schema.String({ required: true }),
          text: schema.String({ required: true }),
          completed: schema.Boolean({ defaultValue: false }),
        })),
      });

      // Initialize containers with the same names as in schema
      const rootMap = doc.getMap("root");
      
      const countMap = doc.getMap("count");
      countMap.set("value", 0);
      rootMap.setContainer("count", countMap);

      const textMap = doc.getMap("text");
      textMap.set("value", "");
      rootMap.setContainer("text", textMap);

      // Initialize todos list
      const todosList = doc.getList("todos");
      rootMap.setContainer("todos", todosList);

      // Commit all changes
      doc.commit();

      store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();
    });

    it("should create a reducer with action handlers", async () => {
      const actions = {
        increment: (state: ReducerState, amount = 1) => {
          // Handle both object and primitive formats
          if (isWrappedValue(state.count)) {
            state.count.value += amount;
          } else {
            state.count += amount;
          }
        },
        setText: (state: ReducerState, text: string) => {
          // Handle both object and primitive formats
          if (isWrappedValue(state.text)) {
            state.text.value = text;
          } else {
            state.text = text;
          }
        },
        addTodo: (state: ReducerState, todo: { id: string; text: string; completed?: boolean }) => {
          // Ensure completed has a default value if not provided
          const newTodo: TodoItem = {
            id: todo.id,
            text: todo.text,
            completed: todo.completed ?? false
          };
          state.todos.push(newTodo);
        },
        toggleTodo: (state: ReducerState, id: string) => {
          // Use type assertion to properly type the array elements
          const todoItems = state.todos as TodoItem[];
          const todo = todoItems.find(t => t.id === id);
          if (todo) {
            todo.completed = !todo.completed;
          }
        },
      };

      const dispatch = createReducer(actions)(store);

      // Test increment action
      dispatch("increment", 5);
      await waitForSync();
      expect(getPrimitiveValue(store.getState().count)).toBe(5);

      // Test setText action
      dispatch("setText", "Hello World");
      await waitForSync();
      expect(getPrimitiveValue(store.getState().text)).toBe("Hello World");

      // Test addTodo action
      dispatch("addTodo", { id: "1", text: "Buy milk" });
      await waitForSync();

      // Properly type the state and todo items
      const state = store.getState() as ReducerState;
      const todoItems = state.todos as TodoItem[];
      
      expect(todoItems.length).toBe(1);
      expect(todoItems[0].text).toBe("Buy milk");

      // Test toggleTodo action
      dispatch("toggleTodo", "1");
      await waitForSync();
      
      // Get updated state and properly type it
      const updatedState = store.getState() as ReducerState;
      const updatedTodoItems = updatedState.todos as TodoItem[];
      expect(updatedTodoItems[0].completed).toBe(true);
    });

    it("should throw an error for unknown action types", () => {
      const actions = {
        increment: (state: ReducerState) => {
          if (isWrappedValue(state.count)) {
            state.count.value += 1;
          } else {
            state.count += 1;
          }
        },
      };

      const dispatch = createReducer(actions)(store);

      expect(() => {
        // Use a properly typed unknown action
        dispatch("unknown" as keyof typeof actions, null);
      }).toThrow("Unknown action type: unknown");
    });
  });
});
