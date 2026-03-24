export type NormalizedTreeNode<TData extends Record<string, unknown>> = {
    id: string;
    data: TData;
    children: Array<NormalizedTreeNode<TData>>;
};

type TreeNormalizationOptions<TData extends Record<string, unknown>> = {
    isTreeData: (value: unknown) => value is TData;
    createEmptyData: () => TData;
};

type RawTreeNodeKey = "id" | "meta" | "children";

export function normalizeTreeJson<TData extends Record<string, unknown>>(
    input: unknown,
    options: TreeNormalizationOptions<TData>,
): Array<NormalizedTreeNode<TData>> {
    if (!Array.isArray(input)) return [];
    return input.map((node) => normalizeTreeNode(node, options));
}

function normalizeTreeNode<TData extends Record<string, unknown>>(
    node: unknown,
    options: TreeNormalizationOptions<TData>,
): NormalizedTreeNode<TData> {
    const rawId = getRawTreeNodeField(node, "id");
    const rawMeta = getRawTreeNodeField(node, "meta");
    const rawChildren = getRawTreeNodeField(node, "children");

    return {
        id: typeof rawId === "string" ? rawId : "",
        data: options.isTreeData(rawMeta)
            ? rawMeta
            : options.createEmptyData(),
        children: Array.isArray(rawChildren)
            ? rawChildren.map((child) => normalizeTreeNode(child, options))
            : [],
    };
}

function getRawTreeNodeField(node: unknown, key: RawTreeNodeKey): unknown {
    if (!isPlainRecord(node)) return undefined;
    return node[key];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
