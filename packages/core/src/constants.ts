export const CID_KEY = "$cid";

/**
 * Brand marker present on every `LazyList` instance.
 *
 * `Symbol.for` (global registry) so the check keeps working when the host app
 * bundles its own copy of loro-mirror.
 */
export const LAZY_LIST_BRAND = Symbol.for("loro-mirror.lazyList");
