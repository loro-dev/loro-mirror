/**
 * Core mirroring functionality for syncing application state with Loro CRDT
 */

export { Mirror, SyncDirection, toNormalizedJson } from "./mirror.js";
export type {
    MirrorOptions,
    SetStateOptions,
    SubscriberCallback,
    UpdateMetadata,
    InferContainerOptions
} from "./mirror.js";
