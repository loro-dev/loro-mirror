/**
 * Core mirroring functionality for syncing application state with Loro CRDT
 */

export { Mirror, SyncDirection, toNormalizedJson } from "./mirror";
export type {
    InferContainerOptions,
    MirrorOptions,
    SetStateOptions,
    SubscriberCallback,
    UpdateMetadata,
} from "./mirror";
