/**
 * Parity fuzz: the bulk `doc.getDeepValueWithID()` snapshot path must produce
 * exactly the same result as the legacy per-container traversal — state,
 * `$cid` markers, container registry, and per-container infer options.
 *
 * The legacy path is exercised by shadowing `getDeepValueWithID` with
 * `undefined` on a cloned doc (an own property on the wasm object shadows the
 * prototype method), which routes `buildRootStateSnapshot` to the fallback.
 */
import { describe, expect, it } from "vitest";
import {
    ContainerID,
    LoroDoc,
    LoroList,
    LoroMap,
    LoroMovableList,
    LoroText,
    LoroTree,
    TreeID,
} from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import {
    ContainerSchemaType,
    SchemaType,
    schema,
} from "../src/schema/index.js";
import type { InferContainerOptions } from "../src/schema/types.js";
import { cidsEqual, deepEqual } from "../src/core/utils.js";

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Random document + schema generation
// ---------------------------------------------------------------------------

type ValueSpec =
    | { kind: "prim"; value: string | number | boolean | null }
    | { kind: "embedded"; value: Record<string, unknown> | unknown[] }
    | { kind: "map"; fields: [string, ValueSpec][] }
    | { kind: "list"; items: ValueSpec[] }
    | { kind: "movable"; items: ValueSpec[] }
    | { kind: "text"; text: string };

type TreeNodeSpec = {
    fields: [string, ValueSpec][];
    children: TreeNodeSpec[];
};

type RootSpec =
    | { kind: "map"; name: string; fields: [string, ValueSpec][] }
    | { kind: "list"; name: string; items: ValueSpec[] }
    | { kind: "movable"; name: string; items: ValueSpec[] }
    | { kind: "text"; name: string; text: string }
    | { kind: "tree"; name: string; nodes: TreeNodeSpec[] }
    | { kind: "ignore"; name: string };

type FieldCoverage =
    | { declared: true; fieldSchema: SchemaType }
    | { declared: false };

type Generated = {
    roots: RootSpec[];
    definition: Record<string, SchemaType>;
    /** Declared root maps with a plain (untransformed) string field, for updates. */
    updatableStringFields: { root: string; key: string }[];
};

function randInt(rng: () => number, maxExclusive: number): number {
    return Math.floor(rng() * maxExclusive);
}

function genPrimValue(rng: () => number): string | number | boolean | null {
    switch (randInt(rng, 5)) {
        case 0:
            return `s${randInt(rng, 1000)}`;
        case 1:
            return randInt(rng, 1000);
        case 2:
            return rng() < 0.5;
        case 3:
            return null;
        default:
            return `text-${randInt(rng, 100)}`;
    }
}

function genEmbeddedValue(
    rng: () => number,
): Record<string, unknown> | unknown[] {
    if (rng() < 0.5) {
        const out: Record<string, unknown> = {};
        const keys = randInt(rng, 3);
        for (let i = 0; i < keys; i++) {
            out[`ek${i}`] = rng() < 0.5 ? genPrimValue(rng) : [1, "x"];
        }
        return out;
    }
    const out: unknown[] = [];
    const len = randInt(rng, 3);
    for (let i = 0; i < len; i++) {
        out.push(rng() < 0.5 ? genPrimValue(rng) : { nested: true });
    }
    return out;
}

function genValueSpec(rng: () => number, depth: number): ValueSpec {
    const containerKinds = depth < 3 ? 9 : 4;
    const r = randInt(rng, containerKinds);
    switch (r) {
        case 0:
        case 1:
            return { kind: "prim", value: genPrimValue(rng) };
        case 2:
            return { kind: "embedded", value: genEmbeddedValue(rng) };
        case 3:
            // Empty container (bare in the deep value on loro-crdt 1.13.3).
            return rng() < 0.5
                ? { kind: "map", fields: [] }
                : { kind: "list", items: [] };
        case 4: {
            const fields: [string, ValueSpec][] = [];
            const count = randInt(rng, 5);
            for (let i = 0; i < count; i++) {
                fields.push([`f${i}`, genValueSpec(rng, depth + 1)]);
            }
            return { kind: "map", fields };
        }
        case 5:
        case 6: {
            const items: ValueSpec[] = [];
            const count = randInt(rng, 5);
            for (let i = 0; i < count; i++) {
                items.push(genValueSpec(rng, depth + 1));
            }
            return r === 5
                ? { kind: "list", items }
                : { kind: "movable", items };
        }
        default:
            return { kind: "text", text: `t${randInt(rng, 500)}` };
    }
}

function genTreeNodeSpec(rng: () => number, depth: number): TreeNodeSpec {
    const fields: [string, ValueSpec][] = [];
    const fieldCount = 1 + randInt(rng, 3);
    for (let i = 0; i < fieldCount; i++) {
        fields.push([`nf${i}`, genValueSpec(rng, depth + 1)]);
    }
    const children: TreeNodeSpec[] = [];
    if (depth < 3) {
        const childCount = randInt(rng, 3);
        for (let i = 0; i < childCount; i++) {
            children.push(genTreeNodeSpec(rng, depth + 1));
        }
    }
    return { fields, children };
}

function genRootSpecs(rng: () => number): RootSpec[] {
    const roots: RootSpec[] = [];
    const rootCount = 2 + randInt(rng, 4);
    for (let i = 0; i < rootCount; i++) {
        const name = `root${i}`;
        switch (randInt(rng, 8)) {
            case 0:
            case 1:
            case 2: {
                const fields: [string, ValueSpec][] = [];
                const count = randInt(rng, 6);
                for (let j = 0; j < count; j++) {
                    fields.push([`f${j}`, genValueSpec(rng, 1)]);
                }
                roots.push({ kind: "map", name, fields });
                break;
            }
            case 3: {
                const items: ValueSpec[] = [];
                const count = randInt(rng, 5);
                for (let j = 0; j < count; j++) {
                    items.push(genValueSpec(rng, 0));
                }
                roots.push({ kind: "list", name, items });
                break;
            }
            case 4: {
                const items: ValueSpec[] = [];
                const count = randInt(rng, 4);
                for (let j = 0; j < count; j++) {
                    items.push(genValueSpec(rng, 0));
                }
                roots.push({ kind: "movable", name, items });
                break;
            }
            case 5:
                roots.push({ kind: "text", name, text: `root-text-${i}` });
                break;
            case 6: {
                const nodes: TreeNodeSpec[] = [];
                const count = randInt(rng, 3);
                for (let j = 0; j < count; j++) {
                    nodes.push(genTreeNodeSpec(rng, 0));
                }
                roots.push({ kind: "tree", name, nodes });
                break;
            }
            default:
                roots.push({ kind: "ignore", name });
                break;
        }
    }
    return roots;
}

// ---------------------------------------------------------------------------
// Doc writing
// ---------------------------------------------------------------------------

function writeSpecToMap(m: LoroMap, key: string, spec: ValueSpec) {
    switch (spec.kind) {
        case "prim":
            m.set(key, spec.value);
            break;
        case "embedded":
            m.set(key, spec.value as never);
            break;
        case "map": {
            const child = m.setContainer(key, new LoroMap());
            for (const [k, v] of spec.fields) writeSpecToMap(child, k, v);
            break;
        }
        case "list": {
            const child = m.setContainer(key, new LoroList());
            for (const item of spec.items) writeSpecToList(child, item);
            break;
        }
        case "movable": {
            const child = m.setContainer(key, new LoroMovableList());
            for (const item of spec.items) writeSpecToList(child, item);
            break;
        }
        case "text": {
            const child = m.setContainer(key, new LoroText());
            child.insert(0, spec.text);
            break;
        }
    }
}

function writeSpecToList(l: LoroList | LoroMovableList, spec: ValueSpec) {
    switch (spec.kind) {
        case "prim":
            l.push(spec.value);
            break;
        case "embedded":
            l.push(spec.value as never);
            break;
        case "map": {
            const child = l.pushContainer(new LoroMap());
            for (const [k, v] of spec.fields) writeSpecToMap(child, k, v);
            break;
        }
        case "list": {
            const child = l.pushContainer(new LoroList());
            for (const item of spec.items) writeSpecToList(child, item);
            break;
        }
        case "movable": {
            const child = l.pushContainer(new LoroMovableList());
            for (const item of spec.items) writeSpecToList(child, item);
            break;
        }
        case "text": {
            const child = l.pushContainer(new LoroText());
            child.insert(0, spec.text);
            break;
        }
    }
}

function writeTreeNodes(
    tree: LoroTree,
    parent: TreeID | undefined,
    nodes: TreeNodeSpec[],
) {
    nodes.forEach((nodeSpec, index) => {
        const node = tree.createNode(parent, index);
        for (const [k, v] of nodeSpec.fields) {
            writeSpecToMap(node.data, k, v);
        }
        writeTreeNodes(tree, node.id, nodeSpec.children);
    });
}

function writeRootSpec(doc: LoroDoc, root: RootSpec) {
    switch (root.kind) {
        case "map": {
            const m = doc.getMap(root.name);
            for (const [k, v] of root.fields) writeSpecToMap(m, k, v);
            break;
        }
        case "list": {
            const l = doc.getList(root.name);
            for (const item of root.items) writeSpecToList(l, item);
            break;
        }
        case "movable": {
            const l = doc.getMovableList(root.name);
            for (const item of root.items) writeSpecToList(l, item);
            break;
        }
        case "text":
            doc.getText(root.name).insert(0, root.text);
            break;
        case "tree":
            writeTreeNodes(doc.getTree(root.name), undefined, root.nodes);
            break;
        case "ignore":
            // Ignore roots are memory-only; nothing is written to the doc.
            break;
    }
}

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

const PREFIX_TRANSFORM = {
    decode: (v: string) => `dec:${v}`,
    encode: (v: string) => (v.startsWith("dec:") ? v.slice(4) : v),
};

// The fuzz never moves movable-list items, so a best-effort selector is fine.
function safeIdSelector(item: unknown): string {
    if (item !== null && typeof item === "object" && "id" in item) {
        return String((item as { id: unknown }).id);
    }
    return "";
}

function genAnySchema(rng: () => number) {
    const r = rng();
    if (r < 0.5) return schema.Any();
    return schema.Any({
        defaultLoroText: rng() < 0.5,
        defaultMovableList: rng() < 0.5,
    });
}

function genSchemaForValue(
    rng: () => number,
    spec: ValueSpec,
    updatable: { root: string; key: string }[],
    path: string[],
): FieldCoverage {
    const r = rng();
    if (r < 0.2) return { declared: false };
    if (r < 0.35) return { declared: true, fieldSchema: genAnySchema(rng) };

    switch (spec.kind) {
        case "prim": {
            if (typeof spec.value === "string") {
                if (rng() < 0.25) {
                    return {
                        declared: true,
                        fieldSchema: schema
                            .String()
                            .transform(PREFIX_TRANSFORM),
                    };
                }
                // Only direct children of a declared root map are safe
                // setState targets.
                if (path.length === 2) {
                    updatable.push({
                        root: path[0],
                        key: path[path.length - 1],
                    });
                }
                return { declared: true, fieldSchema: schema.String() };
            }
            if (typeof spec.value === "number") {
                return { declared: true, fieldSchema: schema.Number() };
            }
            if (typeof spec.value === "boolean") {
                return { declared: true, fieldSchema: schema.Boolean() };
            }
            return { declared: true, fieldSchema: genAnySchema(rng) };
        }
        case "embedded":
            return { declared: true, fieldSchema: genAnySchema(rng) };
        case "map": {
            const definition: Record<string, SchemaType> = {};
            for (const [k, v] of spec.fields) {
                const cov = genSchemaForValue(rng, v, updatable, [...path, k]);
                if (cov.declared) definition[k] = cov.fieldSchema;
            }
            return { declared: true, fieldSchema: schema.LoroMap(definition) };
        }
        case "list":
        case "movable": {
            // List schemas have a single itemSchema; derive it from the first
            // container item when possible, otherwise use Any.
            const containerItem = spec.items.find(
                (item) =>
                    item.kind === "map" ||
                    item.kind === "list" ||
                    item.kind === "movable" ||
                    item.kind === "text",
            );
            let itemSchema: SchemaType;
            if (!containerItem || rng() < 0.3) {
                itemSchema = genAnySchema(rng);
            } else {
                const cov = genSchemaForValue(rng, containerItem, updatable, [
                    ...path,
                    "0",
                ]);
                itemSchema = cov.declared ? cov.fieldSchema : genAnySchema(rng);
            }
            return {
                declared: true,
                fieldSchema:
                    spec.kind === "list"
                        ? schema.LoroList(itemSchema)
                        : schema.LoroMovableList(itemSchema, safeIdSelector),
            };
        }
        case "text":
            return { declared: true, fieldSchema: schema.LoroText() };
    }
}

function genTreeNodeSchemaDef(
    rng: () => number,
    nodes: TreeNodeSpec[],
    updatable: { root: string; key: string }[],
    rootName: string,
): Record<string, SchemaType> {
    // Union of all node data fields (first spec wins per key).
    const byKey = new Map<string, ValueSpec>();
    const collect = (list: TreeNodeSpec[]) => {
        for (const node of list) {
            for (const [k, v] of node.fields) {
                if (!byKey.has(k)) byKey.set(k, v);
            }
            collect(node.children);
        }
    };
    collect(nodes);
    const definition: Record<string, SchemaType> = {};
    for (const [k, v] of byKey) {
        // Path depth 3 keeps tree node fields out of the setState targets
        // (tree root state is an array, not a map).
        const cov = genSchemaForValue(rng, v, updatable, [rootName, "0", k]);
        if (cov.declared) definition[k] = cov.fieldSchema;
    }
    return definition;
}

function generate(rng: () => number): Generated {
    const roots = genRootSpecs(rng);
    const definition: Record<string, SchemaType> = {};
    const updatableStringFields: { root: string; key: string }[] = [];

    for (const root of roots) {
        switch (root.kind) {
            case "ignore":
                definition[root.name] = schema.Ignore();
                break;
            case "tree":
                // Undeclared trees are still mirrored under
                // ignoreUnknownProperties.
                if (rng() < 0.7) {
                    definition[root.name] = schema.LoroTree(
                        schema.LoroMap(
                            genTreeNodeSchemaDef(
                                rng,
                                root.nodes,
                                updatableStringFields,
                                root.name,
                            ),
                        ),
                    );
                }
                break;
            default: {
                // Other roots: mostly declared; sometimes left undeclared.
                if (rng() < 0.2) break;
                const spec: ValueSpec =
                    root.kind === "map"
                        ? { kind: "map", fields: root.fields }
                        : root.kind === "list"
                          ? { kind: "list", items: root.items }
                          : root.kind === "movable"
                            ? { kind: "movable", items: root.items }
                            : { kind: "text", text: root.text };
                const cov = genSchemaForValue(
                    rng,
                    spec,
                    updatableStringFields,
                    [root.name],
                );
                if (cov.declared) definition[root.name] = cov.fieldSchema;
                break;
            }
        }
    }

    return { roots, definition, updatableStringFields };
}

// ---------------------------------------------------------------------------
// Mirror construction + comparison
// ---------------------------------------------------------------------------

function cloneDoc(doc: LoroDoc): LoroDoc {
    const clone = new LoroDoc();
    clone.import(doc.export({ mode: "snapshot" }));
    return clone;
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

type RegistryEntry = { schema: unknown; registered: boolean };

type MirrorInternals = {
    containerRegistry: Map<ContainerID, RegistryEntry>;
    inferOptionsByContainerId: Map<ContainerID, InferContainerOptions>;
    buildRootStateSnapshot: (
        prevState?: Record<string, unknown>,
    ) => Record<string, unknown>;
};

function expectMirrorsEqual(
    bulk: Mirror<never>,
    legacy: Mirror<never>,
    label: string,
) {
    const bulkState = bulk.getState();
    const legacyState = legacy.getState();
    expect(deepEqual(bulkState, legacyState), `${label}: state`).toBe(true);
    expect(cidsEqual(bulkState, legacyState), `${label}: $cid markers`).toBe(
        true,
    );
    expect(
        [...bulk.getContainerIds()].sort(compareStrings),
        `${label}: getContainerIds`,
    ).toEqual([...legacy.getContainerIds()].sort(compareStrings));

    const bulkInternals = bulk as unknown as MirrorInternals;
    const legacyInternals = legacy as unknown as MirrorInternals;

    const regA = bulkInternals.containerRegistry;
    const regB = legacyInternals.containerRegistry;
    expect(regA.size, `${label}: registry size`).toBe(regB.size);
    for (const [id, entry] of regA) {
        const other = regB.get(id);
        expect(other, `${label}: registry has ${id}`).toBeDefined();
        expect(other?.registered, `${label}: registry flag ${id}`).toBe(
            entry.registered,
        );
        // Both mirrors share the same schema object, so identity holds.
        expect(
            other?.schema === entry.schema,
            `${label}: registry schema ${id}`,
        ).toBe(true);
    }

    const infA = bulkInternals.inferOptionsByContainerId;
    const infB = legacyInternals.inferOptionsByContainerId;
    expect(infA.size, `${label}: infer options size`).toBe(infB.size);
    for (const [id, options] of infA) {
        expect(
            infB.has(id) && deepEqual(options, infB.get(id)),
            `${label}: infer options ${id}`,
        ).toBe(true);
    }
}

const ITERATIONS = Number(process.env.BULK_INIT_FUZZ_ITERATIONS ?? 300);
const BASE_SEED = 0x5eed0001;

describe("bulk init snapshot parity fuzz", () => {
    it("matches the legacy traversal on random docs and schemas", () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const seed = BASE_SEED + i;
            const rng = mulberry32(seed);
            const { roots, definition, updatableStringFields } = generate(rng);

            const doc = new LoroDoc();
            for (const root of roots) writeRootSpec(doc, root);
            doc.commit();

            const rootSchema = schema(
                definition as unknown as Record<string, ContainerSchemaType>,
            );
            const ignoreUnknownProperties = rng() < 0.5;
            const checkStateConsistency = i % 4 === 0;
            const options = {
                schema: rootSchema,
                ignoreUnknownProperties,
                checkStateConsistency,
                // The fuzz generates schemas that are not necessarily
                // consistent with every value in the doc (shared list item
                // schemas, union tree node schemas). Update validation is
                // orthogonal to snapshot parity; keep it off so the setState
                // round trips below stay focused on the snapshot paths.
                validateUpdates: false,
            };

            const bulkDoc = cloneDoc(doc);
            const legacyDoc = cloneDoc(doc);
            // Own-property shadowing routes the second mirror to the legacy
            // per-container traversal.
            (
                legacyDoc as unknown as { getDeepValueWithID?: unknown }
            ).getDeepValueWithID = undefined;

            (legacyDoc as LoroDoc & { readState?: unknown }).readState =
                undefined;

            const label = `seed=${seed}`;
            const bulk = new Mirror({ doc: bulkDoc, ...options });
            const legacy = new Mirror({ doc: legacyDoc, ...options });
            try {
                expectMirrorsEqual(
                    bulk as never,
                    legacy as never,
                    `${label} init`,
                );

                // Snapshot-with-prevState parity (the checkStateConsistency /
                // rebuildBaseState path), including Ignore preservation.
                const prevState: Record<string, unknown> = {};
                for (const root of roots) {
                    if (root.kind === "ignore") {
                        prevState[root.name] = { keep: i, name: root.name };
                    }
                }
                const bulkSnap = (
                    bulk as unknown as MirrorInternals
                ).buildRootStateSnapshot(prevState);
                const legacySnap = (
                    legacy as unknown as MirrorInternals
                ).buildRootStateSnapshot(prevState);
                expect(
                    deepEqual(bulkSnap, legacySnap),
                    `${label}: snapshot with prevState`,
                ).toBe(true);
                expect(
                    cidsEqual(bulkSnap, legacySnap),
                    `${label}: snapshot $cid with prevState`,
                ).toBe(true);

                // setState round trips exercise checkStateConsistency (bulk on
                // one mirror, legacy on the other) and must keep parity.
                if (checkStateConsistency && updatableStringFields.length > 0) {
                    const target =
                        updatableStringFields[
                            randInt(rng, updatableStringFields.length)
                        ];
                    const update = (state: Record<string, unknown>) => {
                        const rootObj = state[target.root] as Record<
                            string,
                            unknown
                        >;
                        rootObj[target.key] = `updated-${i}`;
                    };
                    bulk.setState(update as never);
                    legacy.setState(update as never);
                    expectMirrorsEqual(
                        bulk as never,
                        legacy as never,
                        `${label} after setState`,
                    );
                }
            } finally {
                bulk.dispose();
                legacy.dispose();
            }
        }
    });
});
