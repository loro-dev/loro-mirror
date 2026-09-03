// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { isLazyList, Mirror, schema } from "loro-mirror";
import type { InferType } from "loro-mirror";
import { useLazyRange, useLoroStore } from "../src/index.js";

const listSchema = schema({
    items: schema.LoroList(
        schema.LoroMap({
            id: schema.String({ required: true }),
            title: schema.LoroText(),
            done: schema.Boolean({ defaultValue: false }),
        }),
        (it) => it.id,
        { lazy: { index: ["id", "done"] } },
    ),
});

type State = InferType<typeof listSchema>;
type LazyItems = State["items"];

interface ItemInput {
    id: string;
    title: string;
    done: boolean;
}

function seedDoc(doc: LoroDoc, count: number) {
    const mirror = new Mirror({ doc, schema: listSchema });
    const writer = mirror.list<ItemInput>("items");
    for (let i = 0; i < count; i++) {
        writer.insert(i, {
            id: `item-${i}`,
            title: `title ${i}`,
            done: false,
        });
    }
    mirror.dispose();
}

describe("useLazyRange", () => {
    it("hydrates the range and re-renders on in-range changes", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 10);

        let mirrorRef: Mirror<typeof listSchema> | null = null;
        let listRef: LazyItems | null = null;

        function RangeView() {
            const { store } = useLoroStore({ doc, schema: listSchema });
            mirrorRef = store;
            const list = isLazyList(store.getState().items)
                ? store.getState().items
                : null;
            listRef = list;
            const { items, version } = useLazyRange(list, 0, 3);
            return (
                <div>
                    <div data-testid="version">{version}</div>
                    <ul>
                        {items.map((item, i) => (
                            <li data-testid={`row-${i}`} key={i}>
                                {item ? item.title : "loading"}
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }

        render(<RangeView />);

        await waitFor(() => {
            expect(screen.getByTestId("row-0").textContent).toBe("title 0");
        });
        expect(screen.getByTestId("row-1").textContent).toBe("title 1");
        expect(screen.getByTestId("row-2").textContent).toBe("title 2");

        const mirror = mirrorRef as unknown as Mirror<typeof listSchema>;
        const list = listRef as unknown as LazyItems;
        const id = list.ids()[1];
        const versionBefore = Number(screen.getByTestId("version").textContent);
        mirror.list<ItemInput>("items").updateById(id, (draft) => {
            draft.done = true;
        });

        await waitFor(() => {
            expect(list.get(1)?.done).toBe(true);
            expect(
                Number(screen.getByTestId("version").textContent),
            ).toBeGreaterThan(versionBefore);
        });
    });

    it("releases the range on unmount", async () => {
        const doc = new LoroDoc();
        seedDoc(doc, 5);

        let listRef: LazyItems | null = null;

        function RangeView() {
            const { store } = useLoroStore({ doc, schema: listSchema });
            const list = isLazyList(store.getState().items)
                ? store.getState().items
                : null;
            listRef = list;
            const { items } = useLazyRange(list, 0, 2);
            return (
                <div data-testid="first">
                    {items[0] ? items[0].title : "loading"}
                </div>
            );
        }

        const view = render(<RangeView />);
        await waitFor(() => {
            expect(screen.getByTestId("first").textContent).toBe("title 0");
        });
        const list = listRef as unknown as LazyItems;
        expect(list.isHydrated(0)).toBe(true);

        view.unmount();
        expect(list.isHydrated(0)).toBe(false);
        expect(list.isHydrated(1)).toBe(false);
    });
});
