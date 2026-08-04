import { Immer } from "immer";

/**
 * Private Immer instance used for every `produce` call inside loro-mirror.
 *
 * Mirror stamps a non-enumerable `$cid` descriptor onto every mirrored `LoroMap`
 * (see {@link defineCidProperty}). Immer's default `shallowCopy` is `{ ...base }`,
 * which copies enumerable own properties only, so any object Immer touches during a
 * draft mutation silently loses its `$cid`.
 *
 * That is a correctness problem, not just a perf one: a list item whose `$cid`
 * vanished no longer matches the `(item) => item.$cid` idSelector, so `diffMovableList`
 * emits `delete` + `insert` instead of a key update on the existing Map container. If a
 * remote peer concurrently deletes the original container, the re-inserted one survives
 * the merge and the logically-removed item comes back.
 *
 * `useStrictShallowCopy` makes Immer copy full property descriptors, which preserves
 * `$cid` (and keeps it non-enumerable). We use a dedicated instance rather than the
 * global `setUseStrictShallowCopy` so we never change copy semantics for the host
 * application's own Immer usage.
 */
export const mirrorImmer = new Immer({
    autoFreeze: false,
    useStrictShallowCopy: true,
});

// Immer does not export the `IProduce` interface, so name the type structurally to keep
// declaration emit happy.
export const produce: InstanceType<typeof Immer>["produce"] =
    mirrorImmer.produce;
