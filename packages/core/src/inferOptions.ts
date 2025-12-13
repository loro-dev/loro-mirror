export type InferContainerOptions = {
    /**
     * When true, string values are inferred as `LoroText` containers instead of primitive strings.
     */
    defaultLoroText?: boolean;
    /**
     * When true, array values are inferred as `LoroMovableList` containers instead of `LoroList`.
     *
     * Note: if a MovableList is created/inferred without an `idSelector` schema, diffs fall back
     * to index-based updates and do not emit `move` operations.
     */
    defaultMovableList?: boolean;
};
