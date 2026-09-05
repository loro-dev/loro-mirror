import { expect, it } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "../src/index.js";

it.each(["cid:root-other:Map", "idx:2, id:cid:root-other:Map"])(
    "preserves embedded wrapper-shaped values with cid %s",
    (cid) => {
        const doc = new LoroDoc();
        const value = { cid, value: { message: "kept" }, extra: 123 };
        doc.getMap("root").set("payload", value);
        doc.getList("list").push(value);
        doc.getMovableList("movable").push(value);
        doc.getMap("unknown").set("payload", value);
        const real = doc.getMap("root").setContainer("real", new LoroMap());
        real.set("message", "actual container");
        doc.commit();
        const mirror = new Mirror({
            doc,
            schema: schema({
                root: schema.LoroMap({
                    payload: schema.Any(),
                    real: schema.Any(),
                }),
                list: schema.LoroList(schema.Any()),
                movable: schema.LoroMovableList(schema.Any(), () => ""),
            }),
            ignoreUnknownProperties: true,
        });
        expect(mirror.getState().root.payload).toEqual(value);
        expect(mirror.getState().list[0]).toEqual(value);
        expect(mirror.getState().movable[0]).toEqual(value);
        expect(
            (mirror.getState() as unknown as { unknown: { payload: unknown } })
                .unknown.payload,
        ).toEqual(value);
        expect(mirror.getState().root.real).toEqual({
            message: "actual container",
        });
        expect(
            Object.getOwnPropertyDescriptor(
                mirror.getState().root.payload,
                "$cid",
            ),
        ).toBeUndefined();
        expect(() => {
            mirror.checkStateConsistency();
        }).not.toThrow();
        mirror.dispose();
    },
);
