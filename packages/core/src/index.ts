/**
 * Loro Mirror Core
 * A TypeScript state management library that automatically syncs application state with loro-crdt
 */

// Re-export all public APIs
export * from "./schema/index.js";
export {
    Mirror,
    toNormalizedJson,
    type MirrorOptions,
    type SetStateOptions,
    type UpdateMetadata,
    type SubscriberCallback,
    type InferContainerOptions,
    SyncDirection,
} from "./core/index.js";

// Default export
import * as schema from "./schema/index.js";
import * as core from "./core/index.js";

type Combined = typeof schema & typeof core;
const loroMirror: Combined = Object.assign({}, schema, core);

export default loroMirror;
