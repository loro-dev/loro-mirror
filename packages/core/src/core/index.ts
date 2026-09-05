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
    RootInitialValue,
    LazyListWriter,
} from "./mirror.js";
export { LazyListImpl, LazyListWriteError, isLazyList } from "./lazy-list.js";
