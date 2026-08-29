import { describe, expect, it, vi } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema, toNormalizedJson } from "../src/index.js";

const INVALID_CID_STRING = "cid:not-a-container\nsecond line\nthird line";
const MISSING_CONTAINER_ID = "cid:root-missing:Map";

interface CidStringSnapshot {
    invalidText: string;
    validText: string;
    realText: string;
    strings: {
        invalid: string;
        valid: string;
        real: string;
        nested: { label: string; $cid: string };
        $cid: string;
    };
    list: Array<string | { label: string; $cid: string }>;
    movable: Array<string | { label: string; $cid: string }>;
    target: { payload: string; $cid: string };
}

function asCidStringSnapshot(value: unknown): CidStringSnapshot {
    return value as CidStringSnapshot;
}

function createDocWithCidStrings() {
    const doc = new LoroDoc();
    const strings = doc.getMap("strings");
    const nested = strings.setContainer("nested", new LoroMap());
    nested.set("label", "nested map");

    const list = doc.getList("list");
    const listMap = list.pushContainer(new LoroMap());
    listMap.set("label", "list map");

    const movable = doc.getMovableList("movable");
    const movableMap = movable.pushContainer(new LoroMap());
    movableMap.set("label", "movable map");

    const target = doc.getMap("target");
    target.set("payload", "must remain behind the real container id");
    const realContainerId = target.id;

    doc.getText("invalidText").insert(0, INVALID_CID_STRING);
    doc.getText("validText").insert(0, MISSING_CONTAINER_ID);
    doc.getText("realText").insert(0, realContainerId);

    strings.set("invalid", INVALID_CID_STRING);
    strings.set("valid", MISSING_CONTAINER_ID);
    strings.set("real", realContainerId);

    list.insert(0, INVALID_CID_STRING);
    list.insert(1, MISSING_CONTAINER_ID);
    list.insert(2, realContainerId);

    movable.insert(0, INVALID_CID_STRING);
    movable.insert(1, MISSING_CONTAINER_ID);
    movable.insert(2, realContainerId);
    doc.commit();

    return {
        doc,
        realContainerId,
        mapIds: [strings.id, nested.id, listMap.id, movableMap.id, target.id],
    };
}

function expectCidStrings(
    snapshot: CidStringSnapshot,
    realContainerId: string,
) {
    expect(snapshot.invalidText).toBe(INVALID_CID_STRING);
    expect(snapshot.validText).toBe(MISSING_CONTAINER_ID);
    expect(snapshot.realText).toBe(realContainerId);
    expect(snapshot.strings.invalid).toBe(INVALID_CID_STRING);
    expect(snapshot.strings.valid).toBe(MISSING_CONTAINER_ID);
    expect(snapshot.strings.real).toBe(realContainerId);
    expect(snapshot.list.slice(0, 3)).toEqual([
        INVALID_CID_STRING,
        MISSING_CONTAINER_ID,
        realContainerId,
    ]);
    expect(snapshot.movable.slice(0, 3)).toEqual([
        INVALID_CID_STRING,
        MISSING_CONTAINER_ID,
        realContainerId,
    ]);
}

describe("cid:-prefixed user strings", () => {
    it("normalizes Text, Map, List, and MovableList strings byte-for-byte", () => {
        const { doc, realContainerId } = createDocWithCidStrings();
        const replacerSpy = vi.spyOn(doc, "toJsonWithReplacer");

        const snapshot = asCidStringSnapshot(toNormalizedJson(doc));

        expectCidStrings(snapshot, realContainerId);
        expect(replacerSpy).not.toHaveBeenCalled();
    });

    it("opens a schema-less Mirror and preserves the strings incrementally", async () => {
        const { doc, realContainerId } = createDocWithCidStrings();

        const mirror = new Mirror({ doc });
        expectCidStrings(
            asCidStringSnapshot(mirror.getState()),
            realContainerId,
        );

        const incremental = "cid:incremental\nstill user text";
        doc.getMap("strings").set("invalid", incremental);
        doc.getList("list").insert(0, realContainerId);
        doc.commit();
        await Promise.resolve();

        const state = asCidStringSnapshot(mirror.getState());
        expect(state.strings.invalid).toBe(incremental);
        expect(state.list[0]).toBe(realContainerId);
    });

    it("preserves strings in unknown roots when a schema ignores them", () => {
        const { doc, realContainerId } = createDocWithCidStrings();
        const mirror = new Mirror({
            doc,
            schema: schema({
                target: schema.LoroMap({ payload: schema.String() }),
            }),
            ignoreUnknownProperties: true,
        });

        expectCidStrings(
            asCidStringSnapshot(mirror.getState()),
            realContainerId,
        );
    });

    it("does not replace a user string equal to a real container id", () => {
        const { doc, realContainerId } = createDocWithCidStrings();

        const snapshot = asCidStringSnapshot(toNormalizedJson(doc));

        expect(snapshot.realText).toBe(realContainerId);
        expect(snapshot.strings.real).toBe(realContainerId);
        expect(snapshot.list[2]).toBe(realContainerId);
        expect(snapshot.movable[2]).toBe(realContainerId);
        expect(snapshot.strings.real).not.toEqual(snapshot.target);
    });

    it("keeps $cid non-enumerable on every normalized Map", () => {
        const { doc, mapIds } = createDocWithCidStrings();
        const snapshot = asCidStringSnapshot(toNormalizedJson(doc));
        const maps = [
            snapshot.strings,
            snapshot.strings.nested,
            snapshot.list[3],
            snapshot.movable[3],
            snapshot.target,
        ];

        maps.forEach((map, index) => {
            expect(map).toBeTypeOf("object");
            expect(Object.getOwnPropertyDescriptor(map, "$cid")).toEqual({
                value: mapIds[index],
                writable: false,
                enumerable: false,
                configurable: false,
            });
        });
    });

    it("keeps the missing root container error", () => {
        const doc = new LoroDoc();
        const root = doc.getMap("root");
        vi.spyOn(doc, "getContainerById").mockReturnValue(undefined);

        expect(() => toNormalizedJson(doc)).toThrow(
            `ContainerID not found: ${root.id}`,
        );
    });
});
