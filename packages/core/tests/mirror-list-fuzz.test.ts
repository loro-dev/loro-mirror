/* eslint-disable unicorn/consistent-function-scoping */
import { describe, it, expect } from "vitest";
import { isContainer, LoroDoc } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema } from "../src/schema/index.js";
import type { InferInputType } from "../src/schema/index.js";

type Prng = () => number;

const makePrng = (seed: number): Prng => {
    let s = seed >>> 0;
    return () => {
        s = (1664525 * s + 1013904223) >>> 0;
        return s / 0x100000000;
    };
};

const int = (rand: Prng, maxExclusive: number): number =>
    Math.floor(rand() * maxExclusive);

const shuffle = <T>(arr: readonly T[], rand: Prng): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = int(rand, i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

const rotate = <T>(arr: readonly T[], by: number): T[] => {
    const n = arr.length;
    if (n === 0) return [];
    const k = ((by % n) + n) % n;
    return [...arr.slice(k), ...arr.slice(0, k)];
};

const lcsLength = <T>(a: readonly T[], b: readonly T[]): number => {
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
        new Array<number>(m + 1).fill(0),
    );

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp[n][m];
};

const getListItemContainerIdsById = (
    doc: LoroDoc,
    key: string,
    idsInOrder: readonly string[],
): Map<string, string> => {
    const list = doc.getList(key);
    if (list.length !== idsInOrder.length) {
        throw new Error(
            `List length mismatch: expected ${idsInOrder.length}, got ${list.length}`,
        );
    }

    const out = new Map<string, string>();
    for (let i = 0; i < idsInOrder.length; i++) {
        const v = list.get(i);
        if (!isContainer(v)) {
            throw new Error("Expected list items to be containers");
        }
        out.set(idsInOrder[i], v.id);
    }
    return out;
};

describe("Mirror list fuzz", () => {
    it("LoroList with idSelector preserves the LCS containers across reorders", async () => {
        const rand = makePrng(0xa11ce5ed);

        const s = schema({
            list: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    value: schema.Number({ required: true }),
                }),
                (item) => item.id,
            ),
        });
        type Root = InferInputType<typeof s>;
        type Item = NonNullable<Root["list"]>[number];

        const doc = new LoroDoc();
        doc.setPeerId(1);
        const mirror = new Mirror({ doc, schema: s });

        const tick = async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        };

        const poolIds = Array.from({ length: 80 }, (_, i) => `id:${i}`);
        const MAX_LEN = 30;
        const STEPS = 140;

        let current: Item[] = [];
        let prevCidById = new Map<string, string>();

        for (let step = 0; step < STEPS; step++) {
            const currentIds = current.map((x) => x.id);
            const currentValueById = new Map(current.map((x) => [x.id, x.value]));

            let nextIds = currentIds.slice();

            // Reorder: prefer patterns that often move elements to the end.
            if (nextIds.length > 1) {
                const mode = int(rand, 3);
                if (mode === 0) {
                    nextIds = shuffle(nextIds, rand);
                } else if (mode === 1) {
                    nextIds = rotate(nextIds, int(rand, nextIds.length));
                } else {
                    const from = int(rand, nextIds.length);
                    const [picked] = nextIds.splice(from, 1);
                    nextIds.push(picked);
                }
            }

            // Random deletions.
            if (nextIds.length > 0 && rand() < 0.45) {
                const count = Math.min(int(rand, 4) + 1, nextIds.length);
                for (let i = 0; i < count; i++) {
                    const idx = int(rand, nextIds.length);
                    nextIds.splice(idx, 1);
                }
            }

            // Random insertions.
            if (nextIds.length < MAX_LEN && rand() < 0.6) {
                const available = poolIds.filter((id) => !nextIds.includes(id));
                const count = Math.min(
                    int(rand, 4) + 1,
                    available.length,
                    MAX_LEN - nextIds.length,
                );
                for (let i = 0; i < count; i++) {
                    const id = available.splice(int(rand, available.length), 1)[0];
                    const idx = int(rand, nextIds.length + 1);
                    nextIds.splice(idx, 0, id);
                }
            }

            const next: Item[] = nextIds.map((id) => {
                const base =
                    currentValueById.get(id) ?? int(rand, 1_000_000);
                const value =
                    currentValueById.has(id) && rand() < 0.3
                        ? int(rand, 1_000_000)
                        : base;
                return { id, value };
            });

            const expectedKeep = lcsLength(currentIds, nextIds);

            mirror.setState({ list: next });
            await tick();

            expect(doc.toJSON()).toEqual({ list: next });

            const nextCidById = getListItemContainerIdsById(
                doc,
                "list",
                nextIds,
            );
            let preserved = 0;
            for (const [id, cid] of prevCidById) {
                if (nextCidById.get(id) === cid) preserved++;
            }
            expect(preserved).toBe(expectedKeep);

            current = next;
            prevCidById = nextCidById;
        }
    });
});
