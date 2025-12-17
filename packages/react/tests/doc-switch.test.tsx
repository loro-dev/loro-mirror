// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { Mirror, schema } from "loro-mirror";
import { createLoroContext, useLoroStore } from "../src/index.js";

const counterSchema = schema({
    data: schema.LoroMap({
        counter: schema.Number({ defaultValue: 0 }),
    }),
});

function seedDoc(doc: LoroDoc, counter: number) {
    const mirror = new Mirror({
        doc,
        schema: counterSchema,
        initialState: { data: { counter: 0 } },
    });
    mirror.setState((s) => {
        s.data.counter = counter;
    });
    mirror.dispose();
}

describe("React hooks - switching LoroDoc", () => {
    it("useLoroStore updates state when switching to a different doc", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();

        seedDoc(docA, 1);
        seedDoc(docB, 2);

        function CounterView({ doc }: { doc: LoroDoc }) {
            const { state } = useLoroStore({
                doc,
                schema: counterSchema,
                initialState: { data: { counter: 0 } },
            });

            return <div data-testid="counter">{state.data.counter}</div>;
        }

        const { rerender } = render(<CounterView doc={docA} />);
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("1"),
        );

        rerender(<CounterView doc={docB} />);
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("2"),
        );
    });

    it("createLoroContext hooks reflect the new doc state after provider doc changes", async () => {
        const docA = new LoroDoc();
        const docB = new LoroDoc();

        seedDoc(docA, 10);
        seedDoc(docB, 20);

        const { LoroProvider, useLoroState, useLoroSelector } =
            createLoroContext(counterSchema);

        function StateView() {
            const [state] = useLoroState();
            return <div data-testid="counter">{state.data.counter}</div>;
        }

        function SelectorView() {
            const counter = useLoroSelector((s) => s.data.counter);
            return <div data-testid="counter">{counter}</div>;
        }

        const stateView = render(
            <LoroProvider doc={docA} initialState={{ data: { counter: 0 } }}>
                <StateView />
            </LoroProvider>,
        );
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("10"),
        );

        stateView.rerender(
            <LoroProvider doc={docB} initialState={{ data: { counter: 0 } }}>
                <StateView />
            </LoroProvider>,
        );
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("20"),
        );
        stateView.unmount();

        const selectorView = render(
            <LoroProvider doc={docA} initialState={{ data: { counter: 0 } }}>
                <SelectorView />
            </LoroProvider>,
        );
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("10"),
        );

        selectorView.rerender(
            <LoroProvider doc={docB} initialState={{ data: { counter: 0 } }}>
                <SelectorView />
            </LoroProvider>,
        );
        await waitFor(() =>
            expect(screen.getByTestId("counter").textContent).toBe("20"),
        );
        selectorView.unmount();
    });
});
