/**
 * Loro Mirror Core
 * A TypeScript state management library that automatically syncs application state with loro-crdt
 */

// Re-export all public APIs
export * from "./schema";
export * from "./core";
export * from "./constants";

// Default export
import * as schema from "./schema";
import * as core from "./core";

type Combined = typeof schema & typeof core;
const loroMirror: Combined = Object.assign({}, schema, core);

export default loroMirror;
