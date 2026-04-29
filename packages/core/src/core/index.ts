/**
 * Core mirroring functionality for syncing application state with Loro CRDT
 */

export { Mirror, UpdateSource, toNormalizedJson } from "./mirror.js";
export type {
    MirrorOptions,
    SetStateOptions,
    SubscriberCallback,
    UpdateMetadata,
    InferContainerOptions,
    RootInitialValue
} from "./mirror.js";
