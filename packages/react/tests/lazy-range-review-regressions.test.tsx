// @vitest-environment jsdom
import React from "react";
import { it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror, schema } from "loro-mirror";
import { useLazyRange } from "../src/index.js";

it.each([1, 200])(
    "keeps a changing window hydrated with cache limit %s",
    async (maxHydrated) => {
        const doc = new LoroDoc();
        const raw = doc.getList("items");
        for (let i = 0; i < 4; i++) {
            const m = raw.pushContainer(new LoroMap());
            m.set("id", String(i));
        }
        doc.commit();
        const mirror = new Mirror({
            doc,
            schema: schema({
                items: schema.LoroList(
                    schema.LoroMap({ id: schema.String() }),
                    (x) => x.id,
                    { lazy: { index: ["id"], maxHydrated, tailKeep: 0 } },
                ),
            }),
        });
        const list = mirror.getState().items;
        function View({ from }: { from: number }) {
            const { items } = useLazyRange(list, from, from + 2);
            return (
                <div data-testid="rows">
                    {items.map((x) => x?.id ?? "loading").join(",")}
                </div>
            );
        }
        const view = render(
            <React.StrictMode>
                <View from={0} />
            </React.StrictMode>,
        );
        await act(async () => {});
        expect(view.getByTestId("rows").textContent).toBe("0,1");
        await act(async () => {
            raw.delete(0, 1);
            doc.commit();
        });
        expect(view.getByTestId("rows").textContent).toBe("1,2");
        await act(async () => {
            const m = raw.insertContainer(0, new LoroMap());
            m.set("id", "new");
            doc.commit();
        });
        expect(view.getByTestId("rows").textContent).toBe("new,1");
        await act(async () => {
            view.rerender(
                <React.StrictMode>
                    <View from={2} />
                </React.StrictMode>,
            );
        });
        expect(view.getByTestId("rows").textContent).toBe("2,3");
        expect(list.isHydrated(0)).toBe(false);
        await act(async () => {
            view.unmount();
        });
        expect(list.isHydrated(2)).toBe(false);
        expect(list.isHydrated(3)).toBe(false);
        mirror.dispose();
    },
);
