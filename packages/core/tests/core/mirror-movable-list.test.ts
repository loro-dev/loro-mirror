import { Mirror } from "../../src/core/mirror";
import { LoroDoc } from "loro-crdt";
import { schema } from "../../src/schema";
import { describe, expect, it } from "vitest";
import { valueIsContainerOfType } from "../../src/core/utils";

// Utility function to wait for sync to complete (three microtasks for better reliability)
const waitForSync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe("MovableList", () => {
    async function initTestMirror() {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const schema_ = schema({
            list: schema.LoroMovableList(
                schema.LoroMap({
                    id: schema.String(),
                    text: schema.LoroText(),
                }),
                (item) => item.id,
            ),
        });

        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        });

        await waitForSync();

        return { mirror, doc };
    }

    it("movable list properly initializes containers", async () => {
        const { doc } = await initTestMirror();
        let serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.list, ":MovableList"),
            "list field should be a LoroMovableList Container",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(serialized.list.value[0], ":Map"),
            "list item should be a LoroMap Container",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(
                serialized.list.value[0].value.text,
                ":Text",
            ),
            "list item text should be a LoroText Container",
        ).toBeTruthy();
    });

    it("movable list items retain container ids on insert + move", async () => {
        const { mirror, doc } = await initTestMirror();

        const initialSerialized = doc.getDeepValueWithID();

        // Id of the container for the first item in the original list
        const initialId = initialSerialized.list.value[0].cid;

        mirror.setState({
            list: [
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        });

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        // The second item should have the same id as the first item
        // Since all we did was move the item, the id should be the same
        expect(serialized.list.value[1].cid).toBe(initialId);
    });

    it("movable list handles insertion of items correctly", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value.length,
            "list should have three items",
        ).toBe(3);
    });

    it("movable list handles shuffling of many items at once correctly", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        await waitForSync();

        const initialSerialized = doc.getDeepValueWithID();

        const initialIdOfFirstItem = initialSerialized.list.value[0].cid;
        const initialIdOfSecondItem = initialSerialized.list.value[1].cid;
        const initialIdOfThirdItem = initialSerialized.list.value[2].cid;

        const deriredState = {
            list: [
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        };

        mirror.setState(deriredState);

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].cid,
            "first item should have the same id as the second item",
        ).toBe(initialIdOfSecondItem);

        expect(
            serialized.list.value[1].cid,
            "second item should have the same id as the third item",
        ).toBe(initialIdOfThirdItem);

        expect(
            serialized.list.value[2].cid,
            "third item should have the same id as the first item",
        ).toBe(initialIdOfFirstItem);

        expect(serialized.list.value[0].value.id).toBe("2");
        expect(serialized.list.value[1].value.id).toBe("3");
        expect(serialized.list.value[2].value.id).toBe("1");

        expect(mirror.getState()).toEqual(deriredState);
    });

    it("movable list shuffle with updates should shuffle and update", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        await waitForSync();

        const desiredState = {
            list: [
                {
                    id: "2",
                    text: "Hello World Updated 2",
                },
                {
                    id: "3",
                    text: "Hello World Updated 3",
                },
                {
                    id: "1",
                    text: "Hello World Updated 1",
                },
            ],
        };

        mirror.setState(desiredState);

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].value.id,
            "first item should have the right id",
        ).toBe("2");

        expect(
            serialized.list.value[1].value.id,
            "second item should have the right id",
        ).toBe("3");

        expect(
            serialized.list.value[2].value.id,
            "third item should have the right id",
        ).toBe("1");

        expect(
            serialized.list.value[0].value.text.value,
            "first item should have the right text",
        ).toBe("Hello World Updated 2");

        expect(
            serialized.list.value[1].value.text.value,
            "second item should have the right text",
        ).toBe("Hello World Updated 3");

        expect(
            serialized.list.value[2].value.text.value,
            "third item should have the right text",
        ).toBe("Hello World Updated 1");

        expect(mirror.getState()).toEqual(desiredState);
    });

    it("movable list handles basic insert", async () => {
        const { mirror, doc } = await initTestMirror();

        const desiredState = {
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
            ],
        };

        mirror.setState(desiredState);

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(serialized.list.value.length, "list should have two items").toBe(
            2,
        );

        expect(mirror.getState()).toEqual(desiredState);
    });

    it("movable list handles basic delete", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [],
        });

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(serialized.list.value.length, "list should have one item").toBe(
            0,
        );
    });

    it("movable list handles basic update", async () => {
        const { mirror, doc } = await initTestMirror();

        const desiredState = {
            list: [
                {
                    id: "1",
                    text: "Hello World 4",
                },
            ],
        };

        mirror.setState(desiredState);

        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].value.text.value,
            "text should be updated",
        ).toBe("Hello World 4");

        expect(mirror.getState()).toEqual(desiredState);
    });

    it("movable list handles basic moves", async () => {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const schema_ = schema({
            list: schema.LoroMovableList(
                schema.LoroMap({
                    id: schema.String(),
                    text: schema.LoroText(),
                }),
                (item) => item.id,
            ),
        });

        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            list: [
                { id: "0", text: "" },
                { id: "1", text: "" },
                { id: "2", text: "" },
                { id: "3", text: "" },
            ],
        });
        expect(doc.frontiers()[0].counter).toBe(11);
        mirror.setState({
            list: [
                { id: "1", text: "" },
                { id: "0", text: "" },
                { id: "2", text: "" },
                { id: "3", text: "" },
            ],
        });
        expect(doc.frontiers()[0].counter).toBe(12);
        mirror.setState({
            list: [
                { id: "0", text: "" },
                { id: "1", text: "" },
                { id: "3", text: "" },
                { id: "2", text: "" },
            ],
        });
        expect(doc.frontiers()[0].counter).toBe(14);
        expect(doc.toJSON()).toStrictEqual({
            list: [
                { id: "0", text: "" },
                { id: "1", text: "" },
                { id: "3", text: "" },
                { id: "2", text: "" },
            ],
        });
    });

    it("movable list handles basic sets", async () => {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const schema_ = schema({
            list: schema.LoroMovableList(
                schema.String(),
                (item) => item.split(":")[0],
            ),
        });

        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            list: ["1:a", "2:b"],
        });
        expect(doc.toJSON()).toStrictEqual({
            list: ["1:a", "2:b"],
        });
        expect(doc.frontiers()[0].counter).toBe(1);
        mirror.setState({
            list: ["1:a", "2:bc"],
        });
        expect(doc.frontiers()[0].counter).toBe(2);
        expect(doc.exportJsonUpdates()).toMatchSnapshot();
    });

    it("movable list handles delete + reorder without index errors", async () => {
        const { mirror, doc } = await initTestMirror();

        // Set to four items first
        mirror.setState({
            list: [
                { id: "A", text: "tA" },
                { id: "B", text: "tB" },
                { id: "C", text: "tC" },
                { id: "D", text: "tD" },
            ],
        });
        await waitForSync();

        const initial = doc.getDeepValueWithID();
        const idToCid = new Map(
            initial.list.value.map((x: any) => [x.value.id, x.cid]),
        );

        const desired = {
            list: [
                { id: "D", text: "tD" },
                { id: "C", text: "tC" },
                { id: "B", text: "tB" },
            ],
        };
        mirror.setState(desired);
        await waitForSync();

        const after = doc.getDeepValueWithID();
        expect(after.list.value.map((x: any) => x.value.id)).toEqual([
            "D",
            "C",
            "B",
        ]);
        // Container IDs preserved for remaining items
        expect(after.list.value[0].cid).toBe(idToCid.get("D"));
        expect(after.list.value[1].cid).toBe(idToCid.get("C"));
        expect(after.list.value[2].cid).toBe(idToCid.get("B"));

        // Ensure state mirrors correctly
        expect(mirror.getState()).toEqual(desired);
    });

    it("movable list handles insert + delete + reorder mix", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                { id: "A", text: "tA" },
                { id: "B", text: "tB" },
                { id: "C", text: "tC" },
            ],
        });
        await waitForSync();

        const initial = doc.getDeepValueWithID();
        const idToCid = new Map(
            initial.list.value.map((x: any) => [x.value.id, x.cid]),
        );

        const desired = {
            list: [
                { id: "C", text: "tc" },
                { id: "E", text: "te" },
                { id: "B", text: "tb" },
            ],
        };
        mirror.setState(desired);
        await waitForSync();

        const after = doc.getDeepValueWithID();
        expect(after.list.value.map((x: any) => x.value.id)).toEqual([
            "C",
            "E",
            "B",
        ]);
        // C and B preserve container ids; E is new
        expect(after.list.value[0].cid).toBe(idToCid.get("C"));
        expect(after.list.value[2].cid).toBe(idToCid.get("B"));
        expect(after.list.value[1].cid).not.toBe(idToCid.get("A"));
        expect(after.list.value[1].cid).not.toBe(idToCid.get("B"));
        expect(after.list.value[1].cid).not.toBe(idToCid.get("C"));

        // Texts updated accordingly
        expect(after.list.value[0].value.text.value).toBe("tc");
        expect(after.list.value[2].value.text.value).toBe("tb");
        expect(after.list.value[1].value.text.value).toBe("te");

        expect(mirror.getState()).toEqual(desired);
    });

    it("movable list throws on missing item id", async () => {
        const { mirror } = await initTestMirror();
        expect(() =>
            mirror.setState({
                list: [
                    // missing id
                    // @ts-expect-error testing runtime validation
                    { text: "no id" },
                ],
            }),
        ).toThrow();
    });

    it("movable list throws on duplicate ids in new state", async () => {
        const { mirror } = await initTestMirror();
        expect(() =>
            mirror.setState({
                list: [
                    { id: "X", text: "1" },
                    { id: "X", text: "2" },
                ],
            }),
        ).toThrow();
    });

    it("movable list fuzz: large shuffles preserve container ids and text", async () => {
        const { mirror, doc } = await initTestMirror();

        // Deterministic RNG
        let seed = 0x12345678;
        const rand = () => {
            seed = (1664525 * seed + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        const shuffle = <T>(arr: T[]): T[] => {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        };

        const N = 80;
        const ROUNDS = 25;

        const makeItem = (i: number) => ({
            id: String(i + 1),
            text: `T${i + 1}`,
        });
        let current = Array.from({ length: N }, (_, i) => makeItem(i));

        mirror.setState({ list: current });
        await waitForSync();

        const initial = doc.getDeepValueWithID();
        const initialCidById = new Map(
            initial.list.value.map((x: any) => [x.value.id, x.cid]),
        );

        for (let r = 0; r < ROUNDS; r++) {
            // Shuffle order
            let next = shuffle(current);

            // Randomly update a few items' text to exercise nested updates
            const updates = Math.floor(rand() * 5);
            for (let k = 0; k < updates; k++) {
                const idx = Math.floor(rand() * next.length);
                const id = next[idx].id;
                next[idx] = { id, text: `T${id}-r${r}` } as any;
            }

            mirror.setState({ list: next });
            await waitForSync();

            const after = doc.getDeepValueWithID();
            // Verify order and IDs
            const ids = after.list.value.map((x: any) => x.value.id);
            expect(ids).toEqual(next.map((x) => x.id));
            // Verify container IDs preserved
            after.list.value.forEach((x: any, i: number) => {
                expect(x.cid).toBe(initialCidById.get(next[i].id));
                expect(x.value.text.value).toBe(next[i].text);
            });

            // Mirror state reflects next
            expect(mirror.getState()).toEqual({ list: next });

            current = next;
        }
    });
});
