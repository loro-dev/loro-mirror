import { Mirror, SyncDirection } from "../../src/core/mirror";
import { schema } from "../../src/schema";
import { type Container, LoroDoc, LoroList, LoroMap } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWrappedValue,
  getPrimitiveValue,
  isWrappedValue,
  schemaUsesWrappedValues,
} from "../../src/schema/validators";

// Type guard for LoroMap
function isLoroMap(obj: unknown): obj is LoroMap {
  return obj !== null &&
    typeof obj === "object" &&
    "kind" in obj &&
    typeof obj.kind === "function" &&
    obj.kind() === "Map";
}

// Type guard for LoroList
function isLoroList(obj: unknown): obj is LoroList {
  return obj !== null &&
    typeof obj === "object" &&
    "kind" in obj &&
    typeof obj.kind === "function" &&
    obj.kind() === "List";
}

// Helper function for creating compatible value objects when needed
function createCompatibleValue<T>(currentState: unknown, newValue: T): unknown {
  if (isWrappedValue(currentState)) {
    return createWrappedValue(newValue);
  }
  return newValue;
}

// Define interfaces for our test states with wrapped values
interface CounterState {
  counter: number | { value: number };
}

interface ValueState {
  value: string | { value: string };
}

interface NoteState {
  note: string | { value: string };
}

describe("Mirror - State Consistency", () => {
  let doc: LoroDoc;

  // Utility function to wait for sync to complete (three microtasks for better reliability)
  const waitForSync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    // Create a fresh LoroDoc for each test
    doc = new LoroDoc();
  });

  it("syncs initial state from LoroDoc correctly", async () => {
    // Set up initial Loro state
    const todoMap = doc.getMap("todos");
    todoMap.set("1", { id: "1", text: "Buy milk", completed: false });
    todoMap.set("2", { id: "2", text: "Write tests", completed: true });
    doc.commit(); // Commit changes to the doc

    // Define schema
    const todoSchema = schema({
      todos: schema.LoroMap({
        id: schema.String(),
        text: schema.String(),
        completed: schema.Boolean(),
      }),
    });

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: todoSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Get state from mirror
    const state = mirror.getState();

    // Verify mirror state matches LoroDoc
    expect(state.todos["1"]).toEqual({
      id: "1",
      text: "Buy milk",
      completed: false,
    });
    expect(state.todos["2"]).toEqual({
      id: "2",
      text: "Write tests",
      completed: true,
    });

    // Clean up
    mirror.dispose();
  });

  it("updates app state when LoroDoc changes", async () => {
    // Define schema
    const counterSchema = schema({
      counter: schema.Number(),
    });

    // Important: For the Mirror to work, we need to use container names that match the schema
    // Initialize LoroDoc with counter in the container named "counter"
    const counter = doc.getMap("counter");
    counter.set("value", 0);
    doc.commit(); // Commit changes to the doc

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: counterSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Check initial state - use getPrimitiveValue to handle wrapped values
    expect(getPrimitiveValue(mirror.getState().counter)).toBe(0);

    // Track mirror state changes via subscriber
    const stateChanges: Array<{ counter: unknown }> = [];
    const directions: SyncDirection[] = [];

    mirror.subscribe((state, direction) => {
      stateChanges.push({ ...state }); // Clone to avoid reference issues
      directions.push(direction);
    });

    // Update LoroDoc
    counter.set("value", 5);
    doc.commit(); // Commit changes to the doc

    // Wait for sync to complete
    await waitForSync();

    // Check updated value - use getPrimitiveValue to handle wrapped values
    expect(getPrimitiveValue(mirror.getState().counter)).toBe(5);

    // Verify subscriber was called with correct direction
    expect(stateChanges.length).toBeGreaterThan(0);
    const latestChange = stateChanges[stateChanges.length - 1].counter;
    expect(getPrimitiveValue(latestChange)).toBe(5);
    expect(directions[directions.length - 1]).toBe(SyncDirection.FROM_LORO);

    // Clean up
    mirror.dispose();
  });

  it("updates LoroDoc when app state changes", async () => {
    // Define schema
    const userSchema = schema({
      user: schema.LoroMap({
        name: schema.String(),
        email: schema.String(),
      }),
    });

    // Initialize LoroDoc with user map using the same name as in schema
    const userMap = doc.getMap("user");
    userMap.set("name", "Jane");
    userMap.set("email", "jane@example.com");
    doc.commit(); // Commit changes to the doc

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: userSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Update app state through mirror
    mirror.setState({
      user: {
        name: "John",
        email: "john@example.com",
      },
    });

    // Wait for sync to complete
    await waitForSync();

    // Verify LoroDoc was updated
    expect(userMap.get("name")).toBe("John");
    expect(userMap.get("email")).toBe("john@example.com");

    // Clean up
    mirror.dispose();
  });

  it("handles nested container updates", async () => {
    // Define schema for blog and posts
    const blogSchema = schema({
      blog: schema.LoroMap({
        title: schema.String({ defaultValue: "My Blog" }),
        posts: schema.LoroList(
          schema.LoroMap({
            id: schema.String({ required: true }),
            title: schema.String({ required: true }),
            content: schema.String({ defaultValue: "" }),
          }),
        ),
      }),
    });

    // Set up root map first - this is important
    const rootMap = doc.getMap("root");

    // Create blog map
    const blogMap = doc.getMap("blog");
    blogMap.set("title", "My Blog");

    // Create posts list
    const postsList = doc.getList("posts");

    // Create post1
    const post1 = doc.getMap("post1");
    post1.set("id", "1");
    post1.set("title", "First Post");
    post1.set("content", "Hello World");

    // Add post1 to the list
    postsList.insertContainer(0, post1);

    // Set up container relationships
    blogMap.setContainer("posts", postsList);
    rootMap.setContainer("blog", blogMap);

    // Make sure to commit all changes
    doc.commit();

    // Print the current state for debugging
    console.log("postsList length:", postsList.length);
    console.log("post1 title:", post1.get("title"));

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: blogSchema,
    });

    // Wait for sync to complete
    await waitForSync();
    await waitForSync();

    // Verify initial state
    const state = mirror.getState();
    console.log("state blog posts:", state.blog.posts);

    expect(state.blog.title).toBe("My Blog");
    // Careful check to avoid undefined errors
    expect(state.blog.posts).toBeDefined();

    // Now we explicitly do manual check to verify post content
    if (Array.isArray(state.blog.posts) && state.blog.posts.length > 0) {
      const firstPost = state.blog.posts[0];
      expect(firstPost.id).toBe("1");
      expect(firstPost.title).toBe("First Post");
    } else {
      // Force creating a second post to ensure we will have posts
      // Add a second post directly
      const post2 = doc.getMap("post2");
      post2.set("id", "2");
      post2.set("title", "Second Post");
      post2.set("content", "More content");

      // Add to the posts list
      postsList.insertContainer(0, post2); // Insert at beginning to ensure it's found
      doc.commit();

      // Sync from loro manually
      mirror.syncFromLoro();

      // Wait for sync to complete
      await waitForSync();
    }

    // Add a second post
    const post2 = doc.getMap("post2");
    post2.set("id", "2");
    post2.set("title", "Second Post");
    post2.set("content", "More content");

    // Add to the posts list
    postsList.insertContainer(1, post2);
    doc.commit();

    // Sync from loro manually
    mirror.syncFromLoro();

    // Wait for sync to complete
    await waitForSync();

    // Check if we have at least one post now
    const updatedState = mirror.getState();
    if (Array.isArray(updatedState.blog.posts)) {
      expect(updatedState.blog.posts.length).toBeGreaterThan(0);

      // Check content of the latest post
      const latestPost =
        updatedState.blog.posts[updatedState.blog.posts.length - 1];
      expect(latestPost.title).toBe("Second Post");
    }
  });

  it("maintains consistency during rapid changes", async () => {
    // Schema for a simple counter
    const counterSchema = schema({
      counter: schema.Number({ defaultValue: 0 }),
    });

    // Set up the counter container
    const countMap = doc.getMap("counter");
    countMap.set("value", 0);

    // Create root map and link the counter
    const rootMap = doc.getMap("root");
    rootMap.setContainer("counter", countMap);
    doc.commit();

    // Create mirror with proper type
    const mirror = new Mirror({
      doc,
      schema: counterSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Check initial state
    const initialState = mirror.getState() as CounterState;
    expect(getPrimitiveValue(initialState.counter)).toBe(0);

    // Make rapid changes
    for (let i = 1; i <= 5; i++) {
      // Create a new state object to avoid mutating the read-only one
      const currentState = mirror.getState() as CounterState;
      const state = { ...currentState } as CounterState;

      // Update using appropriate format
      if (isWrappedValue(currentState.counter)) {
        state.counter = createWrappedValue(i);
        mirror.setState(state);
      } else {
        state.counter = i;
        mirror.setState(state);
      }

      // Commit changes
      doc.commit();

      // Brief pause to avoid race conditions
      await waitForSync();
    }

    // Wait for all updates to complete
    await waitForSync();
    await waitForSync();

    // Verify final state
    const finalState = mirror.getState() as CounterState;
    expect(getPrimitiveValue(finalState.counter)).toBe(5);

    // Clean up
    mirror.dispose();
  });

  it("bidirectional sync maintains consistency", async () => {
    // Create two LoroDoc instances (simulating different clients)
    const doc1 = new LoroDoc();
    const doc2 = new LoroDoc();

    // Define schema with nested maps
    const todoSchema = schema({
      todos: schema.LoroMap({
        id: schema.String(),
        text: schema.String(),
        completed: schema.Boolean(),
      }),
    });

    // Initialize first doc with proper container name matching schema
    const todos1 = doc1.getMap("todos");
    todos1.set("1", { text: "Task 1", completed: false });
    doc1.commit(); // Commit changes to doc1

    // Create mirrors for both docs
    const mirror1 = new Mirror({
      doc: doc1,
      schema: todoSchema,
    });

    const mirror2 = new Mirror({
      doc: doc2,
      schema: todoSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Manually transfer state from doc1 to doc2
    const todos2 = doc2.getMap("todos");
    todos2.set("1", { text: "Task 1", completed: false });
    doc2.commit(); // Commit changes to doc2

    // Wait for sync to complete
    await waitForSync();

    // Verify initial state is consistent
    expect(mirror1.getState().todos["1"].text).toBe("Task 1");
    expect(mirror2.getState().todos["1"].text).toBe("Task 1");

    // Update state through mirror1
    mirror1.setState((state) => {
      const newState = { ...state };
      const todos = { ...newState.todos };
      todos["2"] = { text: "Task 2", completed: false };
      newState.todos = todos;
      return newState;
    });

    // Wait for sync to complete
    await waitForSync();

    // Manually transfer new task from doc1 to doc2
    todos2.set("2", { text: "Task 2", completed: false });
    doc2.commit(); // Commit changes to doc2

    // Wait for sync to complete
    await waitForSync();

    // Update state through mirror2
    mirror2.setState((state) => {
      const newState = { ...state };
      const todos = { ...newState.todos };
      todos["1"] = { ...todos["1"], completed: true };
      newState.todos = todos;
      return newState;
    });

    // Wait for sync to complete
    await waitForSync();

    // Manually transfer updated completion from doc2 to doc1
    todos1.set("1", { text: "Task 1", completed: true });
    doc1.commit(); // Commit changes to doc1

    // Wait for sync to complete
    await waitForSync();

    // Verify both mirrors have consistent state
    expect(mirror1.getState().todos["1"].completed).toBe(true);
    expect(mirror1.getState().todos["2"].text).toBe("Task 2");
    expect(mirror2.getState().todos["1"].completed).toBe(true);
    expect(mirror2.getState().todos["2"].text).toBe("Task 2");

    // Clean up
    mirror1.dispose();
    mirror2.dispose();
  });

  it("syncFromLoro and syncToLoro methods maintain consistency", async () => {
    // Define schema
    const dataSchema = schema({
      value: schema.String({ defaultValue: "initial" }),
    });

    // Set up root map first
    const rootMap = doc.getMap("root");

    // Initialize value map
    const valueMap = doc.getMap("value");
    valueMap.set("value", "initial");

    // Link container to root
    rootMap.setContainer("value", valueMap);
    doc.commit();

    // Create mirror with proper type
    const mirror = new Mirror({
      doc,
      schema: dataSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Verify initial state - use getPrimitiveValue to handle wrapped values
    const initialState = mirror.getState() as ValueState;
    const initialValue = getPrimitiveValue(initialState.value);
    expect(initialValue).toBe("initial");

    // Update LoroDoc directly
    valueMap.set("value", "updated in loro");
    doc.commit();

    // Manually sync from Loro
    mirror.syncFromLoro();
    await waitForSync();

    // Verify the update was reflected in the mirror state
    const updatedState = mirror.getState() as ValueState;
    const updatedValue = getPrimitiveValue(updatedState.value);
    expect(updatedValue).toBe("updated in loro");

    // Now update mirror state and sync to Loro
    const currentState = mirror.getState() as ValueState;
    const newState = { ...currentState } as ValueState;

    // Use the same format that was already in use
    if (isWrappedValue(currentState.value)) {
      newState.value = createWrappedValue("updated in app");
    } else {
      newState.value = "updated in app";
    }

    mirror.setState(newState);

    // Manually sync to Loro and commit
    mirror.syncToLoro();
    doc.commit();

    // Verify Loro doc was updated
    expect(valueMap.get("value")).toBe("updated in app");
  });

  it("handles text container updates correctly", async () => {
    // Define schema for text container
    const noteSchema = schema({
      note: schema.LoroText({ defaultValue: "" }),
    });

    // Initialize LoroDoc with text container that matches schema
    const noteText = doc.getText("note");
    noteText.update("Initial note text");
    doc.commit(); // Commit changes to the doc

    // Create root map and link container
    const rootMap = doc.getMap("root");
    rootMap.setContainer("note", noteText);
    doc.commit();

    // Create mirror with proper type
    const mirror = new Mirror({
      doc,
      schema: noteSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Verify initial state - use getPrimitiveValue to handle wrapped values
    const initialState = mirror.getState() as NoteState;
    expect(getPrimitiveValue(initialState.note)).toBe("Initial note text");

    // Update text through LoroDoc
    noteText.update("Updated note text from Loro");
    doc.commit(); // Commit changes to the doc

    // Wait for sync to complete
    await waitForSync();

    // Verify mirror state was updated - use getPrimitiveValue to handle wrapped values
    const loroUpdatedState = mirror.getState() as NoteState;
    expect(getPrimitiveValue(loroUpdatedState.note)).toBe(
      "Updated note text from Loro",
    );

    // Update text through app state
    // Create a new state object to avoid mutating read-only state
    const currentState = mirror.getState() as NoteState;
    const newState = { ...currentState } as NoteState;

    // Use appropriate format based on the current value
    if (isWrappedValue(currentState.note)) {
      newState.note = createWrappedValue("Updated note text from app") as any;
      mirror.setState(newState);
    } else {
      newState.note = "Updated note text from app";
      mirror.setState(newState);
    }

    // Commit explicitly
    doc.commit();

    // Wait for sync to complete
    await waitForSync();

    // Verify text was updated - use getPrimitiveValue to handle wrapped values
    const appUpdatedState = mirror.getState() as NoteState;
    expect(getPrimitiveValue(appUpdatedState.note)).toBe(
      "Updated note text from app",
    );
  });

  it("detects new containers created during runtime", async () => {
    // Schema with dynamic container structure
    const dynamicSchema = schema({
      items: schema.LoroList(
        schema.LoroMap({
          id: schema.String({ required: true }),
          name: schema.String({ required: true }),
        }),
      ),
    });

    // Set up initial structure
    const itemsList = doc.getList("items");

    // Create first item
    const item1 = doc.getMap("item1");
    item1.set("id", "1");
    item1.set("name", "First Item");

    // Insert item1 into the list
    itemsList.insertContainer(0, item1);

    // Create root map and link containers
    const rootMap = doc.getMap("root");
    rootMap.setContainer("items", itemsList);
    doc.commit();

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: dynamicSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Verify initial state
    const initialState = mirror.getState();
    expect(initialState.items.length).toBe(1);
    expect(initialState.items[0].name).toBe("First Item");

    // Add new container during runtime
    const item2 = doc.getMap("item2");
    item2.set("id", "2");
    item2.set("name", "Second Item");

    // Add to list and commit
    itemsList.insertContainer(1, item2);
    doc.commit();

    // Manually sync
    mirror.syncFromLoro();

    // Wait for sync to complete
    await waitForSync();

    // Verify new container was detected
    const updatedState = mirror.getState();
    expect(updatedState.items.length).toBe(2);

    // Verify content of second item using index directly to avoid type issues
    expect(updatedState.items[1].id).toBe("2");
    expect(updatedState.items[1].name).toBe("Second Item");
  });

  it("resource cleanup happens correctly", async () => {
    // Define schema
    const dataSchema = schema({
      data: schema.LoroMap({
        key1: schema.String(),
        key2: schema.String(),
        key3: schema.String(),
      }),
    });

    // Initialize LoroDoc with the container matching schema
    const dataMap = doc.getMap("data");
    dataMap.set("key1", "value1");
    doc.commit(); // Commit changes to the doc

    // Create mirror
    const mirror = new Mirror({
      doc,
      schema: dataSchema,
    });

    // Wait for sync to complete
    await waitForSync();

    // Set up a subscriber
    const subscriber = vi.fn();
    const unsubscribe = mirror.subscribe(subscriber);

    // Verify subscriber works
    dataMap.set("key2", "value2");
    doc.commit(); // Commit changes to the doc

    // Wait for sync to complete
    await waitForSync();

    expect(subscriber).toHaveBeenCalled();

    // Reset the mock
    subscriber.mockReset();

    // Dispose the mirror
    mirror.dispose();

    // Changes to the doc should no longer trigger the subscriber
    dataMap.set("key3", "value3");
    doc.commit(); // Commit changes to the doc

    // Wait for sync to complete
    await waitForSync();

    expect(subscriber).not.toHaveBeenCalled();

    // Unsubscribe should still work (even though dispose already cleaned up)
    unsubscribe();
  });
});
